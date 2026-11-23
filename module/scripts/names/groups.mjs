import {catalog, readMembership} from '../catalog/api.mjs';

// Membership is owned by Truesight; consumers never supply an applied snapshot.
export async function loadGrouping() {
  await catalog.whenReady();
  return items => {
    const result = readMembership(items.map(item => item.uuid));
    if (result.apiVersion !== 1 || !['ready', 'unreviewed'].includes(result.status)) throw new Error('Incompatible or unavailable Truesight catalog');
    return result.entries;
  };
}

export const GROUP_FIELDS = ['system.identifier', 'system.source', 'system.school', 'system.level', 'system.type', '_stats.modifiedTime'];
export function nameEvidence(row, source, extraEvidence = () => []) {
  const category = row?.type === 'feat' && typeof row.system?.type?.value === 'string' && row.system.type.value.trim()
    ? row.system.type.value.trim() : undefined;
  const identifier = typeof row?.system?.identifier === 'string' && row.system.identifier.trim()
    ? row.system.identifier.trim() : undefined;
  const actorType = typeof row?.actorType === 'string' && row.actorType ? row.actorType : undefined;
  return {displayName: row.name, source, type: row.type, rules: row.system?.source?.rules,
    ...(category ? {category} : {}), ...(identifier ? {identifier} : {}), ...(actorType ? {actorType} : {}),
    originalName: row.flags?.babele?.originalName ?? row.originalName, lookupNames: extraEvidence(row)};
}

export function itemGroups(indexes, catalogFor, localItems = [], extraEvidence = () => []) {
  const items = [], rows = new Map();
  for (const [packId, index] of indexes) {
    for (const row of index.values()) {
      if (!row._id || !row.name) continue;
      const uuid = 'Compendium.' + packId + '.Item.' + row._id;
      items.push({uuid, documentType: 'Item', subType: row.type, name: row.name, package: packId, system: row.system});
      rows.set(uuid, row);
    }
  }
  const catalog = catalogFor(items), groups = new Map();
  if (!(catalog instanceof Map)) throw new TypeError('Expected Truesight catalog entries');
  function add(key, member) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(member);
  }
  for (const item of items) {
    const entry = catalog.get(item.uuid);
    if (!entry || !(entry.key === null || typeof entry.key === 'string')) {
      throw new Error('Invalid Truesight catalog entry: ' + item.uuid);
    }
    const key = entry.key;
    if (key || /\p{Script=Han}/u.test(item.name)) {
      add(key ?? item.uuid, {...nameEvidence(rows.get(item.uuid), item.uuid, extraEvidence), rules: entry.rules ?? rows.get(item.uuid).system?.source?.rules});
    }
  }
  for (const item of localItems) {
    if (item.uuid && /\p{Script=Han}/u.test(item.name)) {
      add(item.uuid, nameEvidence(item, item.uuid, extraEvidence));
    }
  }
  return groups;
}
