import {describeGroupingIndex, buildDescribedGroupingCatalog, calculateDescribedGrouping, canonicalUuid, groupingDiff, GROUP_RULE_VERSION} from './identity.mjs';
import {identifySource, prepareSourceEnvironment} from './source-resolution.mjs';
import {emptyReview, readReview, mergeReviewSnapshot} from './state.mjs';
import {ALL_CHANGES, affects} from '../changes.mjs';

export class CatalogError extends Error {
  constructor(code, message = code) { super(message); this.name = 'CatalogError'; this.code = code; this.source = 'truesight'; }
}
const stable = snapshot => JSON.stringify({
  records: Object.entries(snapshot.records).sort(([a], [b]) => a.localeCompare(b)),
  groups: Object.entries(snapshot.groups).sort(([a], [b]) => a.localeCompare(b))
});

/** World review with permission-filtered client projections. Dependencies are injected so the algorithm can be
 * tested without Foundry, Quick Insert, a search panel or any name resolver. */
export class CatalogService {
  constructor({index, indexStatus = () => ({status: 'ready'}), environment, load, save, notify = () => {}, canManage = () => true, publication = () => ({canPublish: true}), legacy = () => null}) {
    Object.assign(this, {index, indexStatus, environment, load, save, notify, canManage, publication, legacy});
    this.generation = 0;
    this.revisions = {index: 0, sources: 0, names: 0, access: 0, review: 0};
    this.previews = new Map();
    this.waiters = new Set();
    this.serial = 0;
    try { this.state = readReview(load()); }
    catch (error) { this.state = emptyReview(); this.failure = new CatalogError('invalid-review', error.message); }
  }

  getStatus() {
    if (this.disposed) return {apiVersion: 1, status: 'unavailable', reason: 'stopped'};
    const meta = {apiVersion: 1, ruleVersion: GROUP_RULE_VERSION, revision: this.state.revision,
      generation: this.generation, revisions: {...this.revisions}, scope: 'world', reviewed: Boolean(this.state.active),
      canManage: this.canManage(), ...(this.canManage() ? {...this.publication(), canUndo: Boolean(this.state.previous), includeRisk: this.state.active?.includeRisk === true, legacyAvailable: this.state.revision === 0 && this.legacy() != null} : {})};
    if (this.failure) return {...meta, status: 'failed', reason: this.failure.code, message: this.failure.message};
    try {
      const index = this.indexStatus();
      if (index.status !== 'ready') return {...meta, status: index.status, reason: index.reason};
      return {...meta, status: this.state.active ? 'ready' : 'unreviewed'};
    } catch (error) { return {...meta, status: 'failed', reason: 'index-error', message: String(error)}; }
  }

  assertManager() {
    if (!this.canManage()) throw new CatalogError('review-forbidden');
  }

  assertPublisher() {
    this.assertManager();
    const status = this.publication();
    if (!status.canPublish) throw new CatalogError(status.publishReason ?? 'review-forbidden');
  }

  receive(value, reason = 'review') {
    let next;
    try { next = readReview(value); }
    catch (error) {this.failure = new CatalogError('invalid-review', error.message); this.invalidate('review', ['review']); return;}
    if (next.revision < this.state.revision) return;
    if (JSON.stringify(next) === JSON.stringify(this.state) && !this.failure) return;
    if (next.revision === this.state.revision && next.revision > 0) {
      this.failure = new CatalogError('review-conflict'); this.invalidate('review', ['review']); return;
    }
    this.state = next; this.failure = null;
    this.invalidate(reason, ['review']);
  }

  assertReadable() {
    const status = this.getStatus();
    if (!['ready', 'unreviewed'].includes(status.status)) throw new CatalogError(status.reason ?? status.status, status.message ?? status.reason ?? status.status);
    return status;
  }

  whenReady({timeout = 60000} = {}) {
    const status = this.getStatus();
    if (['ready', 'unreviewed'].includes(status.status)) return Promise.resolve(status);
    if (status.status !== 'not-ready') return Promise.reject(new CatalogError(status.reason ?? status.status, status.message));
    return new Promise((resolve, reject) => {
      const check = () => {
        const next = this.getStatus();
        if (next.status === 'not-ready') return;
        clearTimeout(timer); this.waiters.delete(check);
        if (['ready', 'unreviewed'].includes(next.status)) resolve(next);
        else reject(new CatalogError(next.reason ?? next.status, next.message));
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new CatalogError('index-timeout', 'Quick Insert index did not become ready'));
      }, timeout);
      check.cancel = () => { clearTimeout(timer); reject(new CatalogError('stopped')); };
      this.waiters.add(check);
    });
  }

  invalidate(reason = 'index', changes = ALL_CHANGES, {defer = false} = {}) {
    if (this.disposed || !changes.length) return;
    const domains = new Set(changes);
    // Names corroborate identity in risk previews, including candidates which
    // have not yet joined any applied group. Ordinary renames keep previews.
    if (domains.has('names') && (this.state.active && Object.values(this.state.active.groups).some(g => g.risk) || [...this.previews.values()].some(p => p.options.includeRisk || p.legacy?.active?.includeRisk))) domains.add('identity');
    if (domains.has('sources')) domains.add('identity');
    if (['identity', 'access', 'review'].some(key => domains.has(key))) domains.add('names');
    this.generation++;
    for (const domain of ['sources', 'names', 'access', 'review']) if (changes.includes(domain)) this.revisions[domain]++;
    const indexChanged = ['identity', 'names', 'access', 'display'].some(domain => changes.includes(domain));
    if (indexChanged) this.revisions.index++;
    this.currentCache = null;
    if (affects({changes: [...domains]}, ['identity', 'access', 'review'])) this.previews.clear();
    const pending = this.pendingChange ?? {changes: new Set()};
    for (const domain of domains) pending.changes.add(domain);
    pending.reason = reason;
    pending.deferred ||= defer;
    pending.indexChanged ||= indexChanged;
    this.pendingChange = pending;
    clearTimeout(this.changeTimer);
    if (defer) this.changeTimer = setTimeout(() => this.publishChange(), 0);
    else this.publishChange();
  }

  publishChange() {
    const pending = this.pendingChange;
    if (!pending) return;
    this.pendingChange = null;
    // QI document hooks may run after ours. Drop any index captured during hook
    // dispatch once more before notifying consumers at the settled boundary.
    if (pending.deferred && pending.indexChanged) this.revisions.index++;
    for (const check of this.waiters) check();
    // Events contain no UUIDs, names, source evidence or cached members.
    this.notify({...this.getStatus(), reason: pending.reason, changes: [...pending.changes]});
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.changeTimer); this.pendingChange = null;
    for (const check of this.waiters) check.cancel();
    this.waiters.clear(); this.previews.clear(); this.metadataCache = this.currentCache = null;
  }

  current({fresh = false} = {}) {
    const status = this.assertReadable();
    const index = this.index({fresh});
    const metadata = this.metadataCache;
    // Injected sources without a revision are deliberately uncached. Runtime
    // revisions change on metadata, index replacement and visible projection.
    if (!metadata || index.revision === undefined || metadata.key !== index.revision || metadata.sources !== this.revisions.sources) {
      const environment = prepareSourceEnvironment(this.environment());
      this.metadataCache = {key: index.revision, sources: this.revisions.sources, environment,
        described: describeGroupingIndex(index.results, environment)};
      this.currentCache = null;
    }
    const {environment, described} = this.metadataCache;
    if (!this.currentCache || this.currentCache.revision !== this.state.revision) {
      this.currentCache = {revision: this.state.revision,
        data: buildDescribedGroupingCatalog(described, this.state.active, {excluded: this.state.excluded})};
    }
    return {status, results: index.results, environment, described, data: this.currentCache.data};
  }

  read(uuids) {
    const {status, environment, data} = this.current();
    const wanted = uuids ? new Set(uuids.map(uuid => canonicalUuid(uuid))) : null;
    const entries = new Map(), groups = new Map();
    // Construct a public DTO, never return a Quick Insert item, document,
    // search-result wrapper or the underlying persisted snapshot.
    for (const entry of data.entries.values()) {
      if (wanted && !wanted.has(entry.uuid)) continue;
      const group = entry.key && this.state.active?.groups[entry.key];
      entries.set(entry.uuid, {
        uuid: entry.uuid, key: entry.key, type: entry.result.item.subType,
        img: typeof entry.result.item.img === 'string' ? entry.result.item.img : null,
        kind: entry.kind, rules: entry.rules, warning: entry.warning, risk: entry.risk,
        status: entry.key ? 'member' : entry.warning === 'identity' ? 'invalidated'
          : entry.warning ? 'conflict' : this.state.active?.records[entry.uuid] ? 'independent' : 'pending',
        names: [...entry.names], tags: [...entry.tags], srd: entry.srd,
        reason: group?.reason ?? null,
        evidence: {identifier: entry.id, level: entry.level, school: entry.school,
          source: identifySource(entry.result.item, environment)}
      });
      if (entry.key && !groups.has(entry.key)) groups.set(entry.key, {
        key: entry.key, kind: entry.kind, rules: entry.rules, reason: group.reason,
        risk: entry.risk, members: data.groups.get(entry.key).map(member => member.uuid)
      });
    }
    // Callers may query visible non-indexed items. These stay independent;
    // absence is not an index/API failure and never implies an approved link.
    for (const uuid of wanted ?? []) if (!entries.has(uuid)) entries.set(uuid,
      {uuid, key: null, status: 'not-indexed', warning: null, reason: 'outside-index'});
    return structuredClone({...status, changed: data.changed, ...(this.canManage() ? {excludedCount: this.state.excluded.filter(id => data.entries.has(id)).length} : {}), entries, groups});
  }

  getMember(uuid) { return this.read([uuid]).entries.get(canonicalUuid(uuid)); }

  makeSnapshot({includeRisk = false} = {}, {fresh = false} = {}) {
    const {described} = this.current({fresh});
    return mergeReviewSnapshot(this.state.active, calculateDescribedGrouping(described, {excluded: this.state.excluded}, {includeRisk}));
  }

  preview(options = {}) {
    this.assertManager();
    const importing = options.importLegacy === true;
    if (importing && this.state.revision !== 0) throw new CatalogError('legacy-already-initialized');
    const legacy = importing ? readReview(this.legacy()) : null;
    if (importing && !legacy?.active) throw new CatalogError('legacy-unavailable');
    const snapshot = importing ? legacy.active : this.makeSnapshot(options);
    const id = String(++this.serial);
    // Only a bounded set of open previews lives in memory.
    if (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(id, {snapshot, options: structuredClone(options), revision: this.state.revision, legacy, evidence: importing ? stable(this.makeSnapshot({includeRisk: legacy.active.includeRisk})) : null});
    const names = new Map(this.current().results.map(({item}) => [canonicalUuid(item), item.name]));
    return {id, ...this.getStatus(), importLegacy: importing, legacyExcluded: legacy?.excluded.length ?? 0, retained: Object.keys(snapshot.records).filter(uuid => !names.has(uuid)).length, diff: groupingDiff(this.state.active, snapshot),
      groups: Object.entries(snapshot.groups).map(([key, group]) => ({key, ...group, members: group.members.map(uuid => ({uuid, name: names.get(uuid)}))})),
      independent: Object.entries(snapshot.records).filter(([, record]) => !record.key)
        .map(([uuid, record]) => ({uuid, name: names.get(uuid), reason: record.warning ?? 'no-match'}))};
  }

  async commit(active, excluded, previous = {active: this.state.active, excluded: this.state.excluded}, reason = 'review') {
    this.assertPublisher();
    if (this.saving) throw new CatalogError('save-in-progress');
    this.saving = true;
    try {
      const revision = this.state.revision;
      const next = readReview({schemaVersion: 1, revision: revision + 1, active,
        excluded: [...new Set(excluded)], previous});
      const saved = await this.save(structuredClone(next), {revision, reason});
      // Runtime onChange may already have installed the committed value.
      // Never restore a stale asynchronous completion over a later revision.
      if (this.state.revision <= next.revision) this.receive(saved ?? next, reason);
      return this.getStatus();
    } finally { this.saving = false; }
  }

  async apply(id) {
    this.assertPublisher();
    this.assertReadable();
    const preview = this.previews.get(id);
    if (!preview || preview.revision !== this.state.revision || (preview.legacy ? (JSON.stringify(readReview(this.legacy())) !== JSON.stringify(preview.legacy) || stable(this.makeSnapshot({includeRisk: preview.legacy.active.includeRisk}, {fresh: true})) !== preview.evidence) : stable(this.makeSnapshot(preview.options, {fresh: true})) !== stable(preview.snapshot))) {
      throw new CatalogError('preview-stale', 'The index or review changed; preview again');
    }
    return this.commit(preview.snapshot, preview.legacy?.excluded ?? this.state.excluded, undefined, 'apply');
  }

  async undo() {
    this.assertPublisher();
    this.assertReadable();
    if (!this.state.previous) return this.getStatus();
    return this.commit(this.state.previous.active, this.state.previous.excluded, null, 'undo');
  }

  async exclude(uuid) {
    this.assertPublisher();
    uuid = canonicalUuid(uuid);
    const current = this.read([uuid]).entries.get(uuid);
    if (!current?.key) throw new CatalogError('not-a-member');
    return this.commit(this.state.active, [...new Set([...this.state.excluded, uuid])], undefined, 'exclude');
  }

  async restoreExcluded() { this.assertPublisher(); this.assertReadable(); return this.commit(this.state.active, [], undefined, 'restore'); }
}
