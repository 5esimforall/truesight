import {catalog} from '../catalog/api.mjs';
import {GROUP_FIELDS, loadGrouping} from './groups.mjs';
import {TRANSLATION_MODULE} from './translations.mjs';

export function sourceError(error, source = error?.source ?? null) {
  return {status: 'source-error', source, detail: String(error?.cause ?? error)};
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
    target[keys.at(-1)] = structuredClone(value);
  }
  return result;
}

export async function readCorpus({packs, loadTitleIndex, loadGrouping, localItems = [], fields = []}) {
  let catalogFor;
  try {
    catalogFor = await loadGrouping();
  } catch (cause) {
    throw Object.assign(new Error('Grouping unavailable', {cause}), {source: 'truesight'});
  }
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
  const titleIndex = await loadTitleIndex();
  if (visible.some(([, pack]) => !pack.visible)) throw Object.assign(new Error('Permissions changed while reading indexes'), {source: 'truesight'});
  return {indexes, sources, titleIndex, catalogFor, localItems: [...localItems].map(row => metadata(row, requested))};
}

function* visibleLocalItems(game) {
  for (const item of game.items?.values() ?? []) if (item.visible) yield item;
  for (const actor of game.actors?.values() ?? []) {
    if (actor.testUserPermission(game.user, 'OBSERVER')) yield* actor.items.values();
  }
}

/** Single-client evidence cache. A late result never enters the cache; a new
 * field requirement waits behind the current read rather than starting another.
 * Failed reads are retryable, and only one revision is retained. */
export function createCorpusLoader({key, read}) {
  const fields = new Set();
  let cached, running;
  const evidenceKey = () => JSON.stringify(key());
  const token = () => JSON.stringify([evidenceKey(), [...fields].sort()]);
  return async ({fields: requested = []} = {}) => {
    for (const field of requested) fields.add(field);
    while (true) {
      const current = token();
      if (cached?.token === current) {
        const {catalogFor, ...data} = cached.data, evidence = evidenceKey();
        return {...structuredClone(data), catalogFor, isCurrent: () => evidenceKey() === evidence};
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
function contextKey(game) {
  const status = catalog.getStatus();
  // Check access on every request/completion, even if no hook was received.
  // Review changes alter catalogFor's live projection, not pack metadata.
  return [['ready', 'unreviewed'].includes(status.status) ? 'readable' : status.status, status.revisions?.index, status.revisions?.names, status.revisions?.sources, status.revisions?.access,
    game.world?.id, game.user?.id, game.user?.role, game.user?.isGM, game.i18n?.lang,
    Boolean(game.modules.get(TRANSLATION_MODULE)?.active),
    [...game.packs.entries()].map(([id, pack]) => [id, pack.visible, pack.documentName]),
    [...visibleLocalItems(game)].map(item => item.uuid)];
}
export function loadCorpus(options = {}) {
  const client = globalThis.game;
  let load = loaders.get(client);
  if (!load) {
    load = createCorpusLoader({key: () => contextKey(client), read: ({fields}) => readCorpus({
      packs: client.packs, loadGrouping, fields, localItems: visibleLocalItems(client),
      loadTitleIndex: async () => {
        if (!client.modules.get(TRANSLATION_MODULE)?.active) return null;
        const path = 'modules/' + TRANSLATION_MODULE + '/translation/cn/titles.json';
        const response = await fetch(foundry.utils.getRoute(path));
        if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), {source: TRANSLATION_MODULE});
        return response.json();
      }
    })});
    loaders.set(client, load);
  }
  return load(options);
}
