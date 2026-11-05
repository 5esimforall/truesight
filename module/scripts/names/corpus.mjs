import {GROUP_FIELDS, loadGrouping} from './groups.mjs';
import {TRANSLATION_MODULE} from './translations.mjs';

export function sourceError(error, source = error?.source ?? null) {
  return {status: 'source-error', source, detail: String(error?.cause ?? error)};
}

export async function readCorpus({packs, loadTitleIndex, loadGrouping, localItems = [], fields = []}) {
  let catalogFor;
  try {
    catalogFor = await loadGrouping();
  } catch (cause) {
    throw Object.assign(new Error('Grouping unavailable', {cause}), {source: 'truesight'});
  }
  const indexes = new Map();
  const visible = [...packs.entries()].filter(([, pack]) => pack.visible && pack.documentName === 'Item');
  const requested = [...new Set([...GROUP_FIELDS, 'flags.babele.originalName', ...fields])];
  // Bound concurrency and read each visible pack only once in this snapshot.
  for (let i = 0; i < visible.length; i += 8) {
    await Promise.all(visible.slice(i, i + 8).map(async ([id, pack]) => {
      try {
        const index = await pack.getIndex({fields: requested});
        if (!index || typeof index.values !== 'function') throw new TypeError('Expected a pack index');
        indexes.set(id, index);
      } catch (cause) {
        throw Object.assign(new Error('Index unavailable', {cause}), {source: id});
      }
    }));
  }
  // Translation ID recovery must use this snapshot, never a stale pack.index.
  const sources = new Map([...packs].map(([id, pack]) => [id, {
    visible: pack.visible, documentName: pack.documentName, index: indexes.get(id)
  }]));
  return {indexes, sources, titleIndex: await loadTitleIndex(), catalogFor, localItems: [...localItems]};
}

function* visibleLocalItems(game) {
  for (const item of game.items?.values() ?? []) if (item.visible) yield item;
  for (const actor of game.actors?.values() ?? []) {
    if (actor.testUserPermission(game.user, 'OBSERVER')) yield* actor.items.values();
  }
}

export function loadCorpus({fields = []} = {}) {
  return readCorpus({packs: game.packs, loadGrouping, fields, localItems: visibleLocalItems(game),
    loadTitleIndex: async () => {
      if (!game.modules.get(TRANSLATION_MODULE)?.active) return null;
      const path = 'modules/' + TRANSLATION_MODULE + '/translation/cn/titles.json';
      const response = await fetch(foundry.utils.getRoute(path));
      if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), {source: TRANSLATION_MODULE});
      return response.json();
    }
  });
}
