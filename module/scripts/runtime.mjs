import {createRefreshQueue} from './names/refresh.mjs';
import {createPlutoniumCnProvider} from './providers/plutonium-cn.mjs';
import {createPublisher} from './catalog/publisher.mjs';
import {CatalogService, CatalogError} from './catalog/service.mjs';
import {GROUP_INDEX_FIELDS, canonicalUuid} from './catalog/identity.mjs';
import {classifyChange, isLocalDocumentChange, isEmbeddedActorItem, isTokenDocument, isNonCharacterActor, INDEXED_DOCUMENT_TYPES} from './changes.mjs';

export const MODULE_ID = 'truesight';
export const CHANGED = 'truesightChanged';
export const ITEM_FIELDS = [...GROUP_INDEX_FIELDS, 'system.identifier', 'system.source', 'system.level', 'system.school'];

function compendiumPackId(item) {
  if (item?.package) return item.package;
  const uuid = item?.uuid;
  if (typeof uuid !== 'string' || !uuid.startsWith('Compendium.')) return undefined;
  const firstDot = uuid.indexOf('.', 11);
  if (firstDot < 0) return undefined;
  const secondDot = uuid.indexOf('.', firstDot + 1);
  return secondDot > firstDot + 1 ? uuid.slice(11, secondDot) : undefined;
}

/** QI defines index scope; Foundry permissions are checked again before any
 * persisted relation is materialized. Never load documents to resolve access. */
export function permitted(item, game) {
  const uuid = item?.uuid ?? '';
  const packId = compendiumPackId(item);
  if (packId) return game.packs.get(packId)?.visible === true;
  const parts = uuid.split('.');
  if (parts[0] === 'Item') return game.items?.get(parts[1])?.visible === true;
  if (parts[0] === 'Actor') {
    const actor = game.actors?.get(parts[1]);
    return parts.length > 2 ? actor?.testUserPermission(game.user, 'OBSERVER') === true : actor?.visible === true;
  }
  const collection=game.collections?.get(parts[0]);
  if (collection) return collection.get(parts[1])?.visible === true;
  // Importer records are already limited by QI; missing identity metadata
  // keeps them independent with a specific diagnostic.
  return uuid.startsWith('@');
}

export function createRuntime({game, hooks, config, quickInsert = () => globalThis.QuickInsert, parser = () => globalThis.Parser, publisher: injectedPublisher, reportError, providerCapabilities = () => ({loader:globalThis.DataLoader,data:globalThis.DataUtil,urls:globalThis.UrlUtil})}) {
  const key = 'review';
  let service, publisherStatus, started = false, resetPromise, attemptedReset, reportedInvalid;
  const report = reportError ?? ((code, error) => {
    console.error('Truesight | ' + code, error);
    globalThis.ui?.notifications?.error(game.i18n.localize('TRUESIGHT.Error.' + code), {permanent: true});
  });
  const maintainReviewCache = () => {
    if (!started || service?.disposed) return;
    if (!['invalid-review','review-conflict'].includes(service?.failure?.code)) {attemptedReset=reportedInvalid=undefined;return;}
    const token=service.rejectedReview;
    if (reportedInvalid!==token) {reportedInvalid=token;report(service.failure.code,service.failure);}
    if (resetPromise || attemptedReset===token || !service.publication().canPublish) return;
    attemptedReset=token;
    resetPromise=Promise.resolve().then(()=>service.discardInvalidReview()).catch(error=>report('cache-reset-failed',error)).finally(()=>{
      resetPromise=null;
      if (service.rejectedReview!==token) maintainReviewCache();
    });
  };
  const publisher = injectedPublisher ?? createPublisher({game, hooks, changed: () => {
    const status = JSON.stringify(publisher.status());
    if (!service || status === publisherStatus) return;
    publisherStatus = status; service.previews.clear(); service.invalidate('publication', ['publication']);
  }});
  const external = createPlutoniumCnProvider({module:()=>game.modules.get('plutonium-cn'),capabilities:providerCapabilities});
  const providerQueue=createRefreshQueue({
    invalidate:()=>{external.invalidate();service.invalidate('provider-loading',['identity','names']);},
    build:async isCurrent=>{
      if(service.disposed||!quickInsert()?.hasIndex)return;
      // Never pass records outside this client's visible index to a provider.
      const rows=quickInsert().search('',()=>true,Number.MAX_SAFE_INTEGER).filter(({item})=>permitted(item,game));
      const changed=await external.refresh(rows.map(row=>row.item));
      if(changed&&isCurrent()&&!service.disposed)service.invalidate('provider-ready',['identity','names']);
    }
  });
  const hydrate=()=>{
    if(service?.disposed||!quickInsert()?.hasIndex||(!game.modules.get('plutonium-cn')?.active&&!external.records.size))return Promise.resolve();
    return providerQueue.request();
  };
  const providers = new Map();
  let indexing = false, failure = null;
  const subscriptions = [];
  const documentTypes = [...new Set([
    ...INDEXED_DOCUMENT_TYPES,
    ...Object.keys(game.system.documentTypes ?? {}).filter(type => Array.isArray(config[type]?.compendiumIndexFields))
  ])];
  const indexedTypes = new Set(documentTypes);
  const embeddedIndexingEnabled = () => {
    try { return Boolean(game.settings?.get?.('quick-insert', 'embeddedIndexing')); }
    catch { return false; }
  };
  const documentUuid = (event, document) => {
    const type = event.replace(/^(?:create|update|delete)/, '');
    if (typeof document?.uuid === 'string' && document.uuid.trim()) {
      return canonicalUuid({uuid: document.uuid, documentType: type});
    }
    const id = document?.id ?? document?._id;
    if (typeof id === 'string' && id.trim() && !document.pack && !document.parent) return `${type}.${id.trim()}`;
    return null;
  };
  game.settings.register(MODULE_ID, key, {scope: 'world', config: false, type: Object, default: null,
    onChange: value => service?.receive(value, value?.operation ?? 'review')});
  for (const [type, fields] of documentTypes.map(type => [type, type==='Item'?ITEM_FIELDS:['system.source', '_stats.compendiumSource']])) {
    if (!config[type]?.compendiumIndexFields) continue;
    for (const field of fields) if (!config[type].compendiumIndexFields.includes(field)) config[type].compendiumIndexFields.push(field);
  }
  let indexed, visible, indexRevision = -1, indexIdentity, dirtyUuids = null, lastDirty = null;
  const indexStatus = () => {
    if (!game.modules.get('quick-insert')?.active) return {status: 'unavailable', reason: 'quick-insert-inactive'};
    if (!game.user.isGM && game.settings.get('quick-insert', 'gmOnly')) return {status: 'unavailable', reason: 'quick-insert-gm-only'};
    if (failure) return {status: 'failed', reason: failure};
    const qi = quickInsert();
    if (!game.ready || indexing || !qi?.hasIndex) return {status: 'not-ready', reason: 'index-loading'};
    if (typeof qi.search !== 'function') return {status: 'failed', reason: 'unsupported-quick-insert'};
    return {status: 'ready'};
  };
  service = new CatalogService({
    canManage: () => game.user?.isGM === true,
    publication: () => publisher.status(),
    indexStatus,
    index: ({fresh = false} = {}) => {
      const status = indexStatus();
      if (status.status !== 'ready') throw new Error(status.reason);
      const qi = quickInsert(), identity = qi.searchLib?.index ?? qi;
      if (fresh || !indexed || indexRevision !== service.revisions.index || indexIdentity !== identity) {
        if (fresh || !indexed || indexIdentity !== identity) dirtyUuids = null;
        indexed = qi.search('', () => true, Number.MAX_SAFE_INTEGER);
        indexRevision = service.revisions.index; indexIdentity = identity; visible = null;
        lastDirty = dirtyUuids;
        dirtyUuids = new Set();
      } else {
        lastDirty = new Set();
      }
      // A cached index never substitutes for current permission checks. A
      // permission change without a completion hook still changes the cache key.
      const next = indexed.filter(({item}) => permitted(item, game));
      if (!visible || visible.length !== next.length || visible.some((row, i) => row !== next[i])) visible = next;
      return {status: 'ready', results: visible, revision: visible, dirty: lastDirty, full: lastDirty === null};
    },
    environment: () => ({packs: game.packs, collections: game.collections, items: game.items, actors: game.actors, modules: game.modules, system: game.system, world: game.world,
      externalIdentities: external.records, lang: game.i18n.lang, localize: name => game.i18n.localize(name), sourceBooks: config.DND5E?.sourceBooks,
      publications: game.system.id === 'dnd5e' ? undefined : [], publicationProviders: providers,
      externalPublications: {titles: parser()?.SOURCE_JSON_TO_FULL, abbreviations: parser()?.SOURCE_JSON_TO_ABV, dates: parser()?.SOURCE_JSON_TO_DATE}}),
    load: () => game.settings.get(MODULE_ID, key),
    save: async (state, {revision, reason, expectedReview}) => {
      publisher.begin();
      try {
        const current = game.settings.get(MODULE_ID, key);
        if (expectedReview!==undefined ? JSON.stringify(current)!==expectedReview : (current?.revision ?? 0)!==revision) {
          service.receive(current);
          throw new CatalogError('preview-stale');
        }
        const status = publisher.status();
        if (!status.canPublish) throw new CatalogError(status.publishReason);
        const next = {...state, publisherId: game.user.id, publishedAt: Date.now(), operation: reason};
        await game.settings.set(MODULE_ID, key, next);
        return next;
      } finally { publisher.end(); }
    },
    notify: status => {
      hooks.callAll(CHANGED, status);
      maintainReviewCache();
      if (status.reason==='review-reset') {
        globalThis.ui?.notifications?.warn(game.i18n.localize('TRUESIGHT.UI.CacheCleared'), {permanent: true});
        if (started && indexStatus().status==='not-ready' && !indexing) void service.start();
      }
    }
  });
  service.registerPublications = (id, records) => {
    if (typeof id !== 'string' || !id.trim() || !Array.isArray(records)) throw new TypeError('Expected a publication provider id and records');
    const registered = structuredClone(records);
    providers.set(id, registered); service.invalidate('sources', ['sources']);
    return () => providers.get(id) === registered && service.unregisterPublications(id);
  };
  service.unregisterPublications = id => {
    const removed = providers.delete(id);
    if (removed) service.invalidate('sources', ['sources']);
    return removed;
  };
  const on = (name, callback) => subscriptions.push([name, hooks.on(name, callback)]);
  const invalidate = (reason, changes, options = {}) => {
    if (options.index !== false && (!changes || changes.some(d => ['identity', 'names', 'access', 'display'].includes(d)))) {
      if (typeof options.uuid === 'string' && !options.full && dirtyUuids !== null && dirtyUuids.size < 100) {
        dirtyUuids.add(options.uuid);
      } else {
        dirtyUuids = null;
      }
    }
    const access = changes?.includes('access');
    const incremental = Boolean(typeof options.uuid === 'string' && !options.full);
    service.invalidate(reason, changes, {...options, incremental, defer: !access});
    // Retract immediately, then refresh once after QI's remaining document
    // hooks. Otherwise a cache filled during revocation/grant dispatch could
    // retain the pre-update index indefinitely (incremental QI updates have no
    // IndexCompleted event).
    if (access) service.invalidate(reason, changes, {...options, incremental: false, defer: true});
  };
  for (const event of ['babele.ready', 'babele.dataLoaded', 'babele.reinitialized']) on(event, () => invalidate(event, ['names', 'identity'], {full: true}));
  on('QuickInsert:IndexCompleted', () => { indexing = false; failure = null; void hydrate(); invalidate('index', undefined, {full: true}); });
  on('srd5e.configUpdate',()=>{void hydrate();});
  for (const event of [...documentTypes.flatMap(type => ['create', 'update', 'delete'].map(action => action + type)),
    'createCompendium', 'updateCompendium', 'deleteCompendium', 'createFolder', 'updateFolder', 'deleteFolder', 'updateUser', 'updateSetting']) {
    on(event, (document, delta) => {
      if (isTokenDocument(document)) return;
      const embeddedIndexing = embeddedIndexingEnabled();
      const changes = classifyChange(event, document, delta, {userId: game.user?.id, embeddedIndexing, indexedTypes});
      if (!changes.length) return;
      const local = isLocalDocumentChange(event, document, {indexedTypes});
      const embeddedActorItem = isEmbeddedActorItem(event, document) && !embeddedIndexing;
      const embeddedNpcItem = isEmbeddedActorItem(event, document) && document?.type !== 'class' && isNonCharacterActor(document.parent);
      const isItem = /^(?:create|update|delete)Item$/.test(event);
      const isCompendiumOrFolder = /^(?:create|update|delete)(?:Compendium|Folder)$/.test(event);
      const affectsNames = changes.includes('names') || changes.includes('access')
        || isCompendiumOrFolder
        || (isItem && !embeddedNpcItem && (!local || ['class', 'subclass', 'race', 'background'].includes(document?.type) || typeof document?.name !== 'string'));
      const uuid = !changes.includes('access') && !isCompendiumOrFolder && event !== 'updateUser' && event !== 'updateSetting'
        && !(embeddedIndexing && event === 'updateActor')
        ? documentUuid(event, document) : null;
      invalidate(event, changes, {
        packs: !local,
        index: !embeddedActorItem,
        affectsNames,
        uuid,
        full: uuid === null
      });
      if (changes.includes('access') && external.records.size) void hydrate();
    });
  }
  service.start = async () => {
    started=true;publisher.start();maintainReviewCache();
    await hydrate();
    if (service.getStatus().status !== 'not-ready') { service.invalidate('ready'); return; }
    // A hidden/disabled Slow Insert panel is not responsible for starting QI.
    // Yield past other ready callbacks before requesting its public index API.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (service.disposed) return;
    if (quickInsert()?.hasIndex) { service.invalidate('ready'); return; }
    if (indexing) return;
    indexing = true;
    try {
      if (typeof quickInsert()?.forceIndex !== 'function') throw Error('unsupported-quick-insert');
      await quickInsert().forceIndex();
      // QI may return while another build runs. Its completion hook owns ready.
    } catch (error) { indexing = false; failure = String(error); service.invalidate('index-failed'); }
  };
  service.destroy = () => { providerQueue.stop(); external.stop(); publisher.destroy(); service.dispose(); indexed = visible = null; for (const [name, id] of subscriptions) hooks.off(name, id); };
  return service;
}
