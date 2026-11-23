import {catalog} from '../catalog/api.mjs';
import {GROUP_FIELDS, loadGrouping} from './groups.mjs';
import {TRANSLATION_MODULE} from './translations.mjs';

export function sourceError(error, source = error?.source ?? null) {
  return {status: 'source-error', source, detail: String(error?.cause ?? error)};
}

function rowActorType(row) {
  if (typeof row?.actorType === 'string' && row.actorType) return row.actorType;
  const actor = row?.actor ?? (row?.parent?.items ? row.parent : null);
  if (!actor || typeof actor !== 'object') return undefined;
  const items = typeof actor.items?.values === 'function' ? actor.items.values()
    : Array.isArray(actor.items) ? actor.items : [];
  for (const entry of items) if (entry?.type === 'class') return 'character';
  return typeof actor.type === 'string' && actor.type ? actor.type : undefined;
}

const HAN = /\p{Script=Han}/u;

function clonePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clonePlain(value[i]);
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    for (const [k, v] of value) out.set(k, clonePlain(v));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    for (const v of value) out.add(clonePlain(v));
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return structuredClone(value);
  const out = {};
  for (const key in value) if (Object.hasOwn(value, key)) out[key] = clonePlain(value[key]);
  return out;
}

function cloneCorpusData(data) {
  if (!data || typeof data !== 'object' || !(data.indexes instanceof Map) || !(data.sources instanceof Map)) {
    return clonePlain(data);
  }
  const indexes = new Map();
  for (const [packId, index] of data.indexes) {
    if (index instanceof Map) {
      const copy = new Map();
      for (const [id, row] of index) copy.set(id, clonePlain(row));
      indexes.set(packId, copy);
    } else {
      indexes.set(packId, clonePlain(index));
    }
  }
  const sources = new Map();
  for (const [packId, src] of data.sources) {
    if (!src || typeof src !== 'object') { sources.set(packId, clonePlain(src)); continue; }
    const copy = {};
    for (const key in src) {
      if (!Object.hasOwn(src, key)) continue;
      if (key === 'index' && src.index === data.indexes.get(packId)) copy.index = indexes.get(packId);
      else copy[key] = clonePlain(src[key]);
    }
    sources.set(packId, copy);
  }
  const out = {};
  for (const key in data) {
    if (!Object.hasOwn(data, key) || key === 'catalogFor') continue;
    if (key === 'indexes') out.indexes = indexes;
    else if (key === 'sources') out.sources = sources;
    else out[key] = clonePlain(data[key]);
  }
  return out;
}

// Copy only requested metadata, never retain live Documents or mutable pack
// indexes. Each consumer receives its own copy, including nested flags.
function metadata(row, fields) {
  const result = {};
  for (const path of new Set(['_id', 'uuid', 'name', 'type', 'originalName', ...fields])) {
    const keys = path.split('.');
    if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new TypeError('Invalid metadata field');
    const value = keys.reduce((current, key) => current?.[key], row);
    if (value === undefined) continue;
    let target = result;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = typeof value === 'object' && value !== null ? clonePlain(value) : value;
  }
  const actorType = rowActorType(row);
  if (actorType) result.actorType = actorType;
  return result;
}

async function readPackIndexes(packs, fields = []) {
  const indexes = new Map();
  // Foundry Collection iterates values by default, unlike Map. Keep one
  // explicit entry snapshot for both index reads and translation sources.
  const entries = [...packs.entries()];
  const visible = entries.filter(([, pack]) => pack.visible && pack.documentName === 'Item');
  const requested = [...new Set([...GROUP_FIELDS, 'flags.babele.originalName', ...fields])];
  // Bound concurrency and read each visible pack only once in this snapshot.
  for (let i = 0; i < visible.length; i += 8) {
    const batch = await Promise.allSettled(visible.slice(i, i + 8).map(async ([id, pack]) => {
      try {
        if (!pack.visible) throw new Error('Pack access revoked');
        const index = await pack.getIndex({fields: requested});
        if (!index || typeof index.values !== 'function') throw new TypeError('Expected a pack index');
        indexes.set(id, new Map([...index.values()].map((row, i) => [row._id ?? i, metadata(row, requested)])));
      } catch (cause) {
        throw Object.assign(new Error('Index unavailable', {cause}), {source: id});
      }
    }));
    const failed = batch.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  // Translation ID recovery must use this snapshot, never a stale pack.index.
  const sources = new Map(entries.map(([id, pack]) => [id, {
    visible: pack.visible, documentName: pack.documentName, index: indexes.get(id)
  }]));
  return {indexes, sources, visibleIds: visible.map(([id]) => id), requested};
}

export async function readCorpus({packs, loadTitleIndex, loadGrouping, localItems = [], fields = []}) {
  let catalogFor;
  try {
    catalogFor = await loadGrouping();
  } catch (cause) {
    throw Object.assign(new Error('Grouping unavailable', {cause}), {source: 'truesight'});
  }
  const {indexes, sources, visibleIds, requested} = await readPackIndexes(packs, fields);
  const titleIndex = await loadTitleIndex();
  if (visibleIds.some(id => !packs.get(id)?.visible)) throw Object.assign(new Error('Permissions changed while reading indexes'), {source: 'truesight'});
  return {indexes, sources, titleIndex, catalogFor, localItems: [...localItems].map(row => metadata(row, requested))};
}

function* visibleLocalItems(game) {
  for (const item of game.items?.values() ?? []) {
    if (item.visible && typeof item.name === 'string' && HAN.test(item.name)) yield item;
  }
  for (const actor of game.actors?.values() ?? []) {
    if (actor.testUserPermission(game.user, 'OBSERVER')) {
      for (const item of actor.items?.values?.() ?? []) {
        if (typeof item.name === 'string' && HAN.test(item.name)) yield item;
      }
    }
  }
}

/** Single-client evidence cache. A late result never enters the cache; a new
 * field requirement waits behind the current read rather than starting another.
 * Failed reads are retryable, and only one revision is retained. */
export function createCorpusLoader({key, accessKey, read}) {
  const fields = new Set();
  let cached, running;
  const evidenceKey = () => JSON.stringify(key());
  const accessToken = () => JSON.stringify((accessKey ?? key)());
  const token = () => JSON.stringify([evidenceKey(), [...fields].sort()]);
  return async ({fields: requested = []} = {}) => {
    for (const field of requested) fields.add(field);
    while (true) {
      const current = token();
      if (cached?.token === current) {
        const {catalogFor, ...data} = cached.data, evidence = evidenceKey(), access = accessToken();
        return {
          ...cloneCorpusData(data), catalogFor,
          isCurrent: () => evidenceKey() === evidence,
          isAccessCurrent: () => accessToken() === access
        };
      }
      if (!running) {
        running = Promise.resolve().then(async () => {
          const started = token();
          try {
            const data = await read({fields: [...fields].sort()});
            if (token() === started) cached = {token: started, data};
          } catch (error) {
            if (token() === started) throw error;
          } finally { running = null; }
        });
      }
      await running;
    }
  };
}

const loaders = new WeakMap();
function accessContextKey(game) {
  const status = catalog.getStatus();
  return [
    ['ready', 'unreviewed'].includes(status.status) ? 'readable' : status.status,
    status.revisions?.access,
    game.world?.id, game.user?.id, game.user?.role, game.user?.isGM,
    [...game.packs.entries()].map(([id, pack]) => [id, pack.visible, pack.documentName])
  ];
}
function packSnapshotKey(game, fields) {
  const status = catalog.getStatus();
  return JSON.stringify([
    ['ready', 'unreviewed'].includes(status.status) ? 'readable' : status.status,
    status.revisions?.packs, status.revisions?.sources,
    game.world?.id, game.user?.id, game.user?.role, game.user?.isGM,
    game.i18n?.lang,
    Boolean(game.modules.get(TRANSLATION_MODULE)?.active),
    [...game.packs.entries()].map(([id, pack]) => [id, pack.visible, pack.documentName]),
    [...fields].sort()
  ]);
}
function titleSnapshotKey(game) {
  const status = catalog.getStatus();
  return JSON.stringify([
    status.revisions?.packs,
    game.i18n?.lang,
    Boolean(game.modules.get(TRANSLATION_MODULE)?.active)
  ]);
}
function contextKey(game) {
  const status = catalog.getStatus();
  // Check access on every request/completion, even if no hook was received.
  // Review changes alter catalogFor's live projection, not pack metadata.
  return [
    ...accessContextKey(game),
    status.revisions?.review, status.revisions?.names, status.revisions?.sources, status.revisions?.packs,
    game.i18n?.lang,
    Boolean(game.modules.get(TRANSLATION_MODULE)?.active),
    [...visibleLocalItems(game)].map(item => [
      item.uuid, item.name, item.flags?.babele?.originalName ?? item.originalName ?? null,
      item.system?.identifier ?? null, item.system?.type?.value ?? null
    ])
  ];
}
async function fetchTitleIndex(client) {
  if (!client.modules.get(TRANSLATION_MODULE)?.active) return null;
  const path = 'modules/' + TRANSLATION_MODULE + '/translation/cn/titles.json';
  const response = await fetch(foundry.utils.getRoute(path));
  if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), {source: TRANSLATION_MODULE});
  return response.json();
}
export function loadCorpus(options = {}) {
  const client = globalThis.game;
  let load = loaders.get(client);
  if (!load) {
    let cachedPacks = null, cachedTitles = null;
    load = createCorpusLoader({
      key: () => contextKey(client),
      accessKey: () => accessContextKey(client),
      read: async ({fields}) => {
        let catalogFor;
        try {
          catalogFor = await loadGrouping();
        } catch (cause) {
          throw Object.assign(new Error('Grouping unavailable', {cause}), {source: 'truesight'});
        }
        const nextPackKey = packSnapshotKey(client, fields);
        let packData = cachedPacks?.key === nextPackKey
          && !cachedPacks.visibleIds.some(id => client.packs.get(id)?.visible !== true)
          ? cachedPacks.data : null;
        if (!packData) {
          cachedPacks = null;
          packData = await readPackIndexes(client.packs, fields);
          if (packSnapshotKey(client, fields) === nextPackKey) cachedPacks = {key: nextPackKey, visibleIds: packData.visibleIds, data: packData};
        }
        const nextTitleKey = titleSnapshotKey(client);
        let titleIndex;
        if (cachedTitles?.key === nextTitleKey) {
          titleIndex = cachedTitles.data;
        } else {
          cachedTitles = null;
          titleIndex = await fetchTitleIndex(client);
          if (titleSnapshotKey(client) === nextTitleKey) cachedTitles = {key: nextTitleKey, data: titleIndex};
        }
        if (packData.visibleIds.some(id => client.packs.get(id)?.visible !== true)
          || [...client.packs.entries()].some(([id, pack]) => pack.visible && pack.documentName === 'Item' && !packData.indexes.has(id))) {
          throw Object.assign(new Error('Permissions changed while reading indexes'), {source: 'truesight'});
        }
        return {
          indexes: packData.indexes,
          sources: packData.sources,
          titleIndex,
          catalogFor,
          localItems: [...visibleLocalItems(client)].map(row => metadata(row, packData.requested))
        };
      }
    });
    loaders.set(client, load);
  }
  return load(options);
}
