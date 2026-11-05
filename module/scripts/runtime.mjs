import {createPublisher} from './catalog/publisher.mjs';
import {CatalogService, CatalogError} from './catalog/service.mjs';
import {reviewSettingKey} from './catalog/state.mjs';
import {GROUP_INDEX_FIELDS} from './catalog/identity.mjs';
import {classifyChange} from './changes.mjs';

export const MODULE_ID = 'truesight';
export const CHANGED = 'truesightChanged';
export const ITEM_FIELDS = [...GROUP_INDEX_FIELDS, 'system.identifier', 'system.source', 'system.level', 'system.school'];

/** QI defines index scope; Foundry permissions are checked again before any
 * persisted relation is materialized. Never load documents to resolve access. */
export function permitted(item, game) {
  const uuid = item?.uuid ?? '';
  const packId = item?.package || uuid.match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1];
  if (packId) return game.packs.get(packId)?.visible === true;
  const parts = uuid.split('.');
  if (parts[0] === 'Item') return game.items?.get(parts[1])?.visible === true;
  if (parts[0] === 'Actor') {
    const actor = game.actors?.get(parts[1]);
    return parts.length > 2 ? actor?.testUserPermission(game.user, 'OBSERVER') === true : actor?.visible === true;
  }
  // Importer records are already limited by QI; without complete spell
  // metadata they remain independent under the existing identity rules.
  return uuid.startsWith('@');
}

export function createRuntime({game, hooks, config, quickInsert = () => globalThis.QuickInsert, parser = () => globalThis.Parser, publisher: injectedPublisher}) {
  const legacyKey = reviewSettingKey(game.world, game.user?.id ?? game.userId), key = 'review';
  let service, publisherStatus;
  const publisher = injectedPublisher ?? createPublisher({game, hooks, changed: () => {
    const status = JSON.stringify(publisher.status());
    if (!service || status === publisherStatus) return;
    publisherStatus = status; service.previews.clear(); service.invalidate('publication', ['publication']);
  }});
  const providers = new Map();
  let indexing = false, failure = null;
  const subscriptions = [];
  game.settings.register(MODULE_ID, legacyKey, {scope: 'client', config: false, type: Object, default: null});
  game.settings.register(MODULE_ID, key, {scope: 'world', config: false, type: Object, default: null,
    onChange: value => service?.receive(value, value?.operation ?? 'review')});
  for (const [type, fields] of [['Item', ITEM_FIELDS], ['Actor', ['system.source']]]) {
    for (const field of fields) if (!config[type].compendiumIndexFields.includes(field)) config[type].compendiumIndexFields.push(field);
  }
  let indexed, visible, indexRevision = -1, indexIdentity;
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
    legacy: () => game.settings.get(MODULE_ID, legacyKey),
    indexStatus,
    index: ({fresh = false} = {}) => {
      const status = indexStatus();
      if (status.status !== 'ready') throw new Error(status.reason);
      const qi = quickInsert(), identity = qi.searchLib?.index ?? qi;
      if (fresh || !indexed || indexRevision !== service.revisions.index || indexIdentity !== identity) {
        indexed = qi.search('', () => true, Number.MAX_SAFE_INTEGER);
        indexRevision = service.revisions.index; indexIdentity = identity; visible = null;
      }
      // A cached index never substitutes for current permission checks. A
      // permission change without a completion hook still changes the cache key.
      const next = indexed.filter(({item}) => permitted(item, game));
      if (!visible || visible.length !== next.length || visible.some((row, i) => row !== next[i])) visible = next;
      return {status: 'ready', results: visible, revision: visible};
    },
    environment: () => ({packs: game.packs, modules: game.modules, system: game.system, world: game.world,
      lang: game.i18n.lang, localize: name => game.i18n.localize(name), sourceBooks: config.DND5E?.sourceBooks,
      publications: game.system.id === 'dnd5e' ? undefined : [], publicationProviders: providers,
      externalPublications: {titles: parser()?.SOURCE_JSON_TO_FULL, abbreviations: parser()?.SOURCE_JSON_TO_ABV, dates: parser()?.SOURCE_JSON_TO_DATE}}),
    load: () => game.settings.get(MODULE_ID, key),
    save: async (state, {revision, reason}) => {
      publisher.begin();
      try {
        const current = game.settings.get(MODULE_ID, key);
        if ((current?.revision ?? 0) !== revision) {
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
    notify: status => hooks.callAll(CHANGED, status)
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
  const invalidate = (reason, changes) => {
    const access = changes?.includes('access');
    service.invalidate(reason, changes, {defer: !access});
    // Retract immediately, then refresh once after QI's remaining document
    // hooks. Otherwise a cache filled during revocation/grant dispatch could
    // retain the pre-update index indefinitely (incremental QI updates have no
    // IndexCompleted event).
    if (access) service.invalidate(reason, changes, {defer: true});
  };
  for (const event of ['babele.ready', 'babele.dataLoaded', 'babele.reinitialized']) on(event, () => invalidate(event, ['names']));
  on('QuickInsert:IndexCompleted', () => { indexing = false; failure = null; invalidate('index'); });
  for (const event of ['createItem', 'updateItem', 'deleteItem', 'createActor', 'updateActor', 'deleteActor',
    'createCompendium', 'updateCompendium', 'deleteCompendium', 'createFolder', 'updateFolder', 'deleteFolder', 'updateUser', 'updateSetting']) {
    on(event, (document, delta) => invalidate(event, classifyChange(event, document, delta, {userId: game.user?.id})));
  }
  service.start = async () => {
    publisher.start();
    if (service.getStatus().status !== 'not-ready') { service.invalidate('ready'); return; }
    // A hidden/disabled Slow Insert panel is not responsible for starting QI.
    // Yield past other ready callbacks before requesting its public index API.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (service.disposed) return;
    if (quickInsert()?.hasIndex) { service.invalidate('ready'); return; }
    indexing = true;
    try {
      if (typeof quickInsert()?.forceIndex !== 'function') throw Error('unsupported-quick-insert');
      await quickInsert().forceIndex();
      // QI may return while another build runs. Its completion hook owns ready.
    } catch (error) { indexing = false; failure = String(error); service.invalidate('index-failed'); }
  };
  service.destroy = () => { publisher.destroy(); service.dispose(); indexed = visible = null; for (const [name, id] of subscriptions) hooks.off(name, id); };
  return service;
}
