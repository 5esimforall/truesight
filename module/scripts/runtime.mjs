import {CatalogService} from './catalog/service.mjs';
import {reviewSettingKey} from './catalog/state.mjs';
import {GROUP_INDEX_FIELDS} from './catalog/identity.mjs';

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

export function createRuntime({game, hooks, config, quickInsert = () => globalThis.QuickInsert, parser = () => globalThis.Parser}) {
  const key = reviewSettingKey(game.world, game.user?.id ?? game.userId);
  const providers = new Map();
  let indexing = false, failure = null, timer;
  const subscriptions = [];
  game.settings.register(MODULE_ID, key, {scope: 'client', config: false, type: Object, default: null});
  for (const [type, fields] of [['Item', ITEM_FIELDS], ['Actor', ['system.source']]]) {
    for (const field of fields) if (!config[type].compendiumIndexFields.includes(field)) config[type].compendiumIndexFields.push(field);
  }
  const service = new CatalogService({
    index: () => {
      if (!game.modules.get('quick-insert')?.active) return {status: 'unavailable', reason: 'quick-insert-inactive'};
      if (!game.user.isGM && game.settings.get('quick-insert', 'gmOnly')) return {status: 'unavailable', reason: 'quick-insert-gm-only'};
      if (failure) return {status: 'failed', reason: failure};
      const qi = quickInsert();
      if (!game.ready || indexing || !qi?.hasIndex) return {status: 'not-ready', reason: 'index-loading'};
      if (typeof qi.search !== 'function') return {status: 'failed', reason: 'unsupported-quick-insert'};
      return {status: 'ready', results: qi.search('', () => true, Number.MAX_SAFE_INTEGER).filter(({item}) => permitted(item, game))};
    },
    environment: () => ({packs: game.packs, modules: game.modules, system: game.system, world: game.world,
      lang: game.i18n.lang, localize: name => game.i18n.localize(name), sourceBooks: config.DND5E?.sourceBooks,
      publications: game.system.id === 'dnd5e' ? undefined : [], publicationProviders: providers,
      externalPublications: {titles: parser()?.SOURCE_JSON_TO_FULL, abbreviations: parser()?.SOURCE_JSON_TO_ABV, dates: parser()?.SOURCE_JSON_TO_DATE}}),
    load: () => game.settings.get(MODULE_ID, key),
    save: state => game.settings.set(MODULE_ID, key, state),
    notify: status => hooks.callAll(CHANGED, status)
  });
  service.registerPublications = (id, records) => {
    if (typeof id !== 'string' || !id.trim() || !Array.isArray(records)) throw new TypeError('Expected a publication provider id and records');
    const registered = structuredClone(records);
    providers.set(id, registered); service.invalidate('sources');
    return () => providers.get(id) === registered && service.unregisterPublications(id);
  };
  service.unregisterPublications = id => {
    const removed = providers.delete(id);
    if (removed) service.invalidate('sources');
    return removed;
  };
  const on = (name, callback) => subscriptions.push([name, hooks.on(name, callback)]);
  const invalidate = reason => {
    clearTimeout(timer);
    timer = setTimeout(() => service.invalidate(reason), 0);
  };
  on('QuickInsert:IndexCompleted', () => { indexing = false; failure = null; invalidate('index'); });
  for (const event of ['createItem', 'updateItem', 'deleteItem', 'createActor', 'updateActor', 'deleteActor',
    'updateCompendium', 'deleteCompendium', 'updateUser', 'updateSetting']) on(event, () => invalidate(event));
  service.start = async () => {
    if (service.getStatus().status !== 'not-ready') { service.invalidate('ready'); return; }
    // A hidden/disabled Slow Insert panel is not responsible for starting QI.
    // Yield past other ready callbacks before requesting its public index API.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (quickInsert()?.hasIndex) { service.invalidate('ready'); return; }
    indexing = true;
    try {
      if (typeof quickInsert()?.forceIndex !== 'function') throw Error('unsupported-quick-insert');
      await quickInsert().forceIndex();
      // QI may return while another build runs. Its completion hook owns ready.
    } catch (error) { indexing = false; failure = String(error); service.invalidate('index-failed'); }
  };
  service.destroy = () => { clearTimeout(timer); for (const [name, id] of subscriptions) hooks.off(name, id); };
  return service;
}
