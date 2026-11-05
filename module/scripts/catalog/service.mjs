import {describeGroupingIndex, buildDescribedGroupingCatalog, calculateDescribedGrouping, canonicalUuid, groupingDiff, GROUP_RULE_VERSION} from './identity.mjs';
import {prepareSourceEnvironment} from './source-resolution.mjs';
import {emptyReview, readReview, mergeReviewSnapshot} from './state.mjs';
import {buildNameSets, nameSetPairs, decisionEvidence, decisionCurrent, comparePair, compareRelationship, applyNameDecisions, comparisonFields} from './name-review.mjs';
import {readRuleEvidence} from './rule-evidence.mjs';
import {ALL_CHANGES, affects} from '../changes.mjs';

export class CatalogError extends Error {
  constructor(code, message = code) { super(message); this.name = 'CatalogError'; this.code = code; this.source = 'truesight'; }
}
const stable = snapshot => JSON.stringify({
  records: Object.entries(snapshot.records).sort(([a], [b]) => a.localeCompare(b)),
  groups: Object.entries(snapshot.groups).sort(([a], [b]) => a.localeCompare(b)),
  decisions: snapshot.decisions
});

/** World review with permission-filtered client projections. Dependencies are injected so the algorithm can be
 * tested without Foundry, Quick Insert, a search panel or any name resolver. */
export class CatalogService {
  constructor({index, indexStatus = () => ({status: 'ready'}), environment, load, save, notify = () => {}, canManage = () => true, publication = () => ({canPublish: true})}) {
    Object.assign(this, {index, indexStatus, environment, load, save, notify, canManage, publication});
    this.generation = 0;
    this.revisions = {index: 0, sources: 0, names: 0, access: 0, review: 0};
    this.previews = new Map();
    this.waiters = new Set();
    this.serial = 0;
    const value=load();
    try { this.state = readReview(value); }
    catch (error) { this.rejectReview(value, error); }
  }

  getStatus() {
    if (this.disposed) return {apiVersion: 1, status: 'unavailable', reason: 'stopped'};
    const meta = {apiVersion: 1, ruleVersion: GROUP_RULE_VERSION, revision: this.state.revision,
      generation: this.generation, revisions: {...this.revisions}, scope: 'world', reviewed: Boolean(this.state.active),
      canManage: this.canManage(), ...(this.canManage() ? {...this.publication(), canUndo: Boolean(this.state.previous), includeRisk: this.state.active?.includeRisk === true} : {})};
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
    catch (error) {this.rejectReview(value,error); this.invalidate('invalid-review', ['identity','names','review']); return;}
    if (next.revision < this.state.revision) return;
    if (JSON.stringify(next) === JSON.stringify(this.state) && !this.failure) return;
    if (next.revision === this.state.revision && next.revision > 0) {
      this.rejectReview(value,new CatalogError('review-conflict'),'review-conflict');
      this.invalidate('review-conflict', ['identity','names','review']); return;
    }
    this.state = next; this.failure = null; this.rejectedReview = undefined;
    this.invalidate(reason, ['review']);
  }

  rejectReview(value, error, code = 'invalid-review') {
    this.state = emptyReview();
    this.state.revision = Number.isSafeInteger(value?.revision) && value.revision >= 0
      && value.revision < Number.MAX_SAFE_INTEGER ? value.revision : 0;
    this.failure = new CatalogError(code, error.message);
    // Retain only the compare-before-write token; never consume rejected members.
    this.rejectedReview = JSON.stringify(value);
    this.previews.clear(); this.metadataCache = this.currentCache = this.nameReviewCache = null;
  }

  async discardInvalidReview() {
    this.assertManager();
    this.assertPublisher();
    if (!['invalid-review','review-conflict'].includes(this.failure?.code)) return this.getStatus();
    if (this.saving) throw new CatalogError('save-in-progress');
    this.saving = true;
    const expectedReview = this.rejectedReview, revision = this.state.revision;
    const next = {...emptyReview(), revision: revision + 1};
    try {
      const saved = await this.save(structuredClone(next), {revision, reason: 'review-reset', expectedReview});
      if (this.rejectedReview === expectedReview && this.state.revision <= next.revision) this.receive(saved ?? next, 'review-reset');
      return this.getStatus();
    } finally { this.saving = false; }
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
    if (domains.has('names') && (this.state.active && (Object.values(this.state.active.groups).some(g => g.risk)||this.state.active.decisions.length>0) || [...this.previews.values()].some(p => p.options.includeRisk||p.decision))) domains.add('identity');
    if (domains.has('sources')) domains.add('identity');
    if (['identity', 'access', 'review'].some(key => domains.has(key))) domains.add('names');
    this.generation++;
    for (const domain of ['sources', 'names', 'access', 'review']) if (changes.includes(domain)) this.revisions[domain]++;
    const indexChanged = ['identity', 'names', 'access', 'display'].some(domain => changes.includes(domain));
    if (indexChanged) this.revisions.index++;
    this.currentCache = this.nameReviewCache = null;
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
    this.waiters.clear(); this.previews.clear(); this.metadataCache = this.currentCache = this.nameReviewCache = null;
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
    const {status, data} = this.current();
    const wanted = uuids ? new Set(uuids.map(uuid => canonicalUuid(uuid))) : null;
    const entries = new Map(), groups = new Map();
    // Construct a public DTO, never return a Quick Insert item, document,
    // search-result wrapper or the underlying persisted snapshot.
    for (const entry of data.entries.values()) {
      if (wanted && !wanted.has(entry.uuid)) continue;
      const group = entry.key && this.state.active?.groups[entry.key];
      entries.set(entry.uuid, {
        uuid: entry.uuid, documentType: entry.documentType, key: entry.key, type: entry.result.item.subType,
        img: typeof entry.result.item.img === 'string' ? entry.result.item.img : null,
        kind: entry.kind, rules: entry.rules, warning: entry.warning, risk: entry.risk,
        status: entry.key ? 'member' : entry.warning === 'identity' ? 'invalidated'
          : ['edition','source','spell','context-conflict'].includes(entry.warning) ? 'conflict'
          : entry.reason==='awaiting-review' ? 'pending' : 'independent',
        names: [...entry.names], tags: [...entry.tags], srd: entry.srd,
        reason: group?.reason ?? entry.reason,
        evidence: {identifier: entry.id, level: entry.level, school: entry.school,
          context: structuredClone(entry.context), source: entry.source, provider: structuredClone(entry.trace??null)}
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

  nameReviewContext(previewId) {
    this.assertManager();
    const current=this.current();
    const preview=previewId==null?null:this.previews.get(previewId);
    if(previewId!=null&&(!preview||preview.revision!==this.state.revision))throw new CatalogError('preview-stale');
    const snapshot=preview?.snapshot??this.state.active;
    const data=preview?buildDescribedGroupingCatalog(current.described,snapshot,{excluded:this.state.excluded}):current.data;
    const keys=new Map([...data.entries].map(([id,entry])=>[id,entry.key]));
    const decisions=snapshot?.decisions??[];
    const cache=this.nameReviewCache;
    if(!cache||cache.described!==current.described||cache.snapshot!==snapshot||cache.generation!==this.generation) {
      this.nameReviewCache={described:current.described,snapshot,generation:this.generation,
        sets:buildNameSets(current.described,keys,decisions)};
    }
    return {...current,keys,decisions,sets:this.nameReviewCache.sets};
  }

  readNameReview({previewId}={}) {
    const {sets}=this.nameReviewContext(previewId);
    return structuredClone({sets,count:sets.length,entries:new Set(sets.flatMap(set=>set.members)).size,previewId:previewId??null});
  }

  readNameSet(key,{previewId,offset=0,limit=25}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new CatalogError('invalid-options');
    const {sets,described,keys,decisions}=this.nameReviewContext(previewId),set=sets.find(s=>s.key===key);
    if(!set)throw new CatalogError('name-set-unavailable');
    return structuredClone({...set,...nameSetPairs(set,described,keys,decisions,{offset,limit}),
      evidence:Object.fromEntries(set.members.map(id=>{const e=described.get(id);return [id,{names:e.nameEvidence,fields:comparisonFields(e),warning:e.warning}];}))});
  }

  async loadRuleEvidence(uuids) {
    this.assertManager();
    if(!Array.isArray(uuids)||!uuids.length||uuids.length>50||uuids.some(id=>typeof id!=='string'))throw new CatalogError('invalid-options');
    const ids=[...new Set(uuids.map(canonicalUuid))],before=this.current(),generation=this.generation;
    if(ids.some(id=>!before.described.has(id)))throw new CatalogError('name-set-unavailable');
    const results=await Promise.all(ids.map(async id=>{
      try{return await readRuleEvidence(before.described.get(id),before.environment,before.described);}
      catch{return {uuid:id,status:'unavailable'};}
    }));
    this.assertManager();
    const after=this.current();
    const evidenceIds=new Set([...ids,...results.flatMap(result=>(result.progressions??[]).map(p=>p.uuid))]);
    if(generation!==this.generation||[...evidenceIds].some(id=>!after.described.has(id)||after.described.get(id).fingerprint!==before.described.get(id).fingerprint))throw new CatalogError('preview-stale');
    return structuredClone(results);
  }

  readNameDecisions() {
    this.assertManager();
    const {described}=this.current();
    return (this.state.active?.decisions??[]).filter(d=>d.members.every(id=>described.has(id)))
      .map(d=>({key:d.key,kind:d.kind,reason:d.reason,members:[...d.members],sides:structuredClone(d.sides),current:decisionCurrent(d,described)}));
  }

  makeNameRevocation(request,{fresh=false}={}) {
    if(Object.keys(request).some(k=>!['kind','key'].includes(k))||typeof request.key!=='string')throw new CatalogError('invalid-decision');
    const {described}=this.current({fresh}),snapshot=structuredClone(this.state.active);
    const decision=snapshot?.decisions.find(d=>d.key===request.key);
    if(!decision||decision.members.some(id=>!described.has(id)))throw new CatalogError('name-set-unavailable');
    snapshot.decisions=snapshot.decisions.filter(d=>d.key!==request.key);
    const group=snapshot.groups[request.key];
    if(group){for(const id of group.members){snapshot.records[id].key=null;snapshot.records[id].reason=snapshot.records[id].warning??'awaiting-review';}delete snapshot.groups[request.key];}
    return snapshot;
  }

  makeNameDecision(request,{fresh=false}={}) {
    this.assertManager();
    if(request?.kind==='revoke')return this.makeNameRevocation(request,{fresh});
    if(!request||typeof request!=='object'||Object.keys(request).some(k=>!['left','right','kind','reason'].includes(k))
      ||!['same','different'].includes(request.kind)||typeof request.left!=='string'||typeof request.right!=='string'||request.left===request.right
      ||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>1000)throw new CatalogError('invalid-decision');
    const {described,data}=this.current({fresh});
    const left=described.get(request.left),right=described.get(request.right);
    if(!left||!right||!left.nameEvidence.some(a=>right.nameEvidence.some(b=>a.key===b.key)))throw new CatalogError('name-set-unavailable');
    if(data.entries.get(left.uuid).key&&data.entries.get(left.uuid).key===data.entries.get(right.uuid).key)throw new CatalogError('already-grouped');
    const decisions=(this.state.active?.decisions??[]).filter(d=>decisionCurrent(d,described));
    const expand=id=>{
      const key=data.entries.get(id).key,group=key&&this.state.active?.groups[key];
      if(group){if(group.members.some(uuid=>!described.has(uuid)||data.entries.get(uuid).key!==key))throw new CatalogError('incomplete-group');return [...group.members].sort();}
      return [id];
    };
    const sides=[expand(left.uuid),expand(right.uuid)],members=[...new Set(sides.flat())].sort();
    if(members.length>500)throw new CatalogError('decision-size');
    if(request.kind==='same') {
      if(members.some(id=>this.state.excluded.includes(id)))throw new CatalogError('excluded-decision');
      for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++) {
        const pair=compareRelationship(described.get(members[i]),described.get(members[j]),{decisions});
        if(pair.status==='separate')throw new CatalogError('separation-conflict');
      }
    }
    const evidence=Object.fromEntries(members.map(id=>[id,decisionEvidence(described.get(id))]));
    if(Object.values(evidence).some(value=>value.length>12000))throw new CatalogError('decision-size');
    let snapshot;
    if(this.state.active)snapshot=structuredClone(this.state.active);
    else {
      snapshot=calculateDescribedGrouping(described,{excluded:this.state.excluded});snapshot.groups=Object.create(null);
      for(const record of Object.values(snapshot.records)){record.key=null;record.reason=record.warning??'awaiting-review';}
    }
    for(const id of members){const entry=described.get(id);if(!snapshot.records[id])snapshot.records[id]={fingerprint:entry.fingerprint,nameFingerprint:null,key:null,warning:entry.warning,reason:entry.warning??'awaiting-review'};}
    // Preserve unobserved decisions, replace only the exact pair or same-group
    // decisions wholly absorbed by this explicitly previewed merge.
    const kept=(snapshot.decisions??[]).filter(d=>{
      if(request.kind!==d.kind)return true;
      if(d.kind==='same')return !d.members.every(id=>members.includes(id));
      const covered=reverse=>d.sides.every((side,index)=>side.every(id=>sides[reverse?1-index:index].includes(id)));
      return !covered(false)&&!covered(true);
    });
    const decision={key:`reviewed-name:${this.state.revision+1}`,kind:request.kind,members,sides:request.kind==='different'?sides:null,evidence,reason:request.reason.trim()};
    if(kept.length>=10000)throw new CatalogError('decision-size');
    return applyNameDecisions(snapshot,described,[...kept,decision],this.state.excluded);
  }

  previewNameDecision(request) {
    const snapshot=this.makeNameDecision(request),decision=request.kind==='revoke'?this.state.active.decisions.find(d=>d.key===request.key):snapshot.decisions.at(-1);
    const {described}=this.current();
    const [left,right]=request.kind==='revoke'?decision.members:[request.left,request.right];
    const clues=[{left,right,...comparePair(described.get(left),described.get(right))}];
    const entries=decision.members.map(uuid=>({uuid,fields:comparisonFields(described.get(uuid)),warning:described.get(uuid).warning}));
    const fields=Object.keys(entries[0].fields).filter(field=>new Set(entries.map(e=>JSON.stringify(e.fields[field]))).size>1);
    return this.storePreview(snapshot,{}, {request:structuredClone(request),members:decision.members,sides:structuredClone(decision.sides),
      reason:decision.reason,clues,comparison:{fields,entries}});
  }

  makeSnapshot({includeRisk = false} = {}, {fresh = false} = {}) {
    const {described} = this.current({fresh});
    const snapshot=mergeReviewSnapshot(this.state.active, calculateDescribedGrouping(described, {excluded: this.state.excluded}, {includeRisk}));
    return applyNameDecisions(snapshot,described,this.state.active?.decisions??[],this.state.excluded);
  }

  preview(options = {}) {
    this.assertManager();
    if (!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='includeRisk')
      || (options.includeRisk!==undefined&&typeof options.includeRisk!=='boolean')) throw new CatalogError('invalid-options');
    const snapshot = this.makeSnapshot(options);
    return this.storePreview(snapshot,options);
  }

  storePreview(snapshot,options,decision=null) {
    const id = String(++this.serial);
    // Only a bounded set of open previews lives in memory.
    if (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(id, {snapshot, options: structuredClone(options), revision: this.state.revision,decision});
    const names = new Map(this.current().results.map(({item}) => [canonicalUuid(item), item.name]));
    return {id, ...this.getStatus(), decision:structuredClone(decision), retained: Object.keys(snapshot.records).filter(uuid => !names.has(uuid)).length, diff: groupingDiff(this.state.active, snapshot),
      groups: Object.entries(snapshot.groups).map(([key, group]) => ({key, ...group, members: group.members.map(uuid => ({uuid, name: names.get(uuid)}))})),
      independent: Object.entries(snapshot.records).filter(([, record]) => !record.key)
        .map(([uuid, record]) => ({uuid, name: names.get(uuid), reason: record.reason}))};
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
    let expected;
    if(preview&&preview.revision===this.state.revision) {
      try {expected=preview.decision?this.makeNameDecision(preview.decision.request,{fresh:true}):this.makeSnapshot(preview.options,{fresh:true});}
      catch(error) {if(!preview.decision||!(error instanceof CatalogError))throw error;throw new CatalogError('preview-stale');}
    }
    if (!preview || preview.revision !== this.state.revision || stable(expected) !== stable(preview.snapshot)) {
      throw new CatalogError('preview-stale', 'The index or review changed; preview again');
    }
    return this.commit(preview.snapshot, this.state.excluded, undefined, 'apply');
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
