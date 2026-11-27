// @ts-check
/** @typedef {import('../../../types/api-v1.d.ts').CatalogMembershipLookup} CatalogMembershipLookup */
/** @typedef {import('../../../types/api-v1.d.ts').CorpusItemMetadata} CorpusItemMetadata */
/** @typedef {import('../../../types/api-v1.d.ts').CorpusItemRow} CorpusItemRow */
/** @typedef {import('../../../types/api-v1.d.ts').ExtraEvidenceFn} ExtraEvidenceFn */
/** @typedef {import('../../../types/api-v1.d.ts').NameEvidenceEntry} NameEvidenceEntry */
/** @typedef {import('../../../types/api-v1.d.ts').PackIndexLike} PackIndexLike */
import {catalog, readMembership} from '../catalog/api.mjs';

// Membership is owned by Truesight; consumers never supply an applied snapshot.
/** @returns {Promise<CatalogMembershipLookup>} */
export async function loadGrouping() {
  await catalog.whenReady();
  return items => {
    const result = readMembership(items.map(item => item.uuid));
    if (result.apiVersion !== 1 || !['ready', 'unreviewed'].includes(result.status)) throw new Error('Incompatible or unavailable Truesight catalog');
    return result.entries;
  };
}

/** @type {readonly string[]} */
export const GROUP_FIELDS = ['system.identifier', 'system.source', 'system.school', 'system.level', 'system.type', '_stats.modifiedTime'];
/**
 * @param {CorpusItemRow} row
 * @param {string} source
 * @param {ExtraEvidenceFn} [extraEvidence]
 * @returns {NameEvidenceEntry}
 */
export function nameEvidence(row, source, extraEvidence = () => []) {
  const category = row?.type === 'feat' && typeof row.system?.type?.value === 'string' && row.system.type.value.trim()
    ? row.system.type.value.trim() : undefined;
  const identifier = typeof row?.system?.identifier === 'string' && row.system.identifier.trim()
    ? row.system.identifier.trim() : undefined;
  const actorType = typeof row?.actorType === 'string' && row.actorType ? row.actorType : undefined;
  return {displayName: /** @type {string} */ (row.name), source, type: row.type, rules: row.system?.source?.rules,
    ...(category ? {category} : {}), ...(identifier ? {identifier} : {}), ...(actorType ? {actorType} : {}),
    originalName: row.flags?.babele?.originalName ?? row.originalName, lookupNames: extraEvidence(row)};
}

/**
 * @param {Map<string, PackIndexLike>} indexes
 * @param {CatalogMembershipLookup} catalogFor
 * @param {readonly CorpusItemMetadata[]} [localItems]
 * @param {ExtraEvidenceFn} [extraEvidence]
 * @returns {Map<string, NameEvidenceEntry[]>}
 */
export function itemGroups(indexes, catalogFor, localItems = [], extraEvidence = () => []) {
  /** @type {CorpusItemRow[]} */
  const items = [];
  /** @type {Map<string, CorpusItemRow>} */
  const rows = new Map();
  for (const [packId, index] of indexes) {
    for (const row of index.values()) {
      if (!row._id || !row.name) continue;
      const uuid = 'Compendium.' + packId + '.Item.' + row._id;
      items.push({uuid, documentType: 'Item', subType: row.type, name: row.name, package: packId, system: row.system});
      rows.set(uuid, row);
    }
  }
  const entries = catalogFor(items);
  /** @type {Map<string, NameEvidenceEntry[]>} */
  const groups = new Map();
  if (!(entries instanceof Map)) throw new TypeError('Expected Truesight catalog entries');
  /**
   * @param {string} key
   * @param {NameEvidenceEntry} member
   */
  function add(key, member) {
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(member);
  }
  for (const item of items) {
    const uuid = /** @type {string} */ (item.uuid);
    const entry = entries.get(uuid);
    if (!entry || !(entry.key === null || typeof entry.key === 'string')) {
      throw new Error('Invalid Truesight catalog entry: ' + uuid);
    }
    const key = entry.key;
    if (key || /\p{Script=Han}/u.test(/** @type {string} */ (item.name))) {
      const row = /** @type {CorpusItemRow} */ (rows.get(uuid));
      add(key ?? uuid, {...nameEvidence(row, uuid, extraEvidence), rules: entry.rules ?? row.system?.source?.rules});
    }
  }
  for (const item of localItems) {
    if (item.uuid && typeof item.name === 'string' && /\p{Script=Han}/u.test(item.name)) {
      add(item.uuid, nameEvidence(item, item.uuid, extraEvidence));
    }
  }
  return groups;
}
