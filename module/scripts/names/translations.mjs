export const TRANSLATION_MODULE = 'dnd-simplified-chinese-babele-patch';

// Reviewed Item dictionaries, not Actor names, journal titles or nested text.
// Equipment also provides negative evidence when its translation collides with a spell.
export const BASE_ITEM_PACKS = Object.freeze([
  'dnd5e.spells', 'dnd5e.spells24', 'dnd5e.classfeatures', 'dnd5e.classes24',
  'dnd5e.races', 'dnd5e.origins24', 'dnd5e.feats24', 'dnd5e.items', 'dnd5e.equipment24',
  'dnd-players-handbook.spells', 'dnd-players-handbook.classes', 'dnd-players-handbook.feats',
  'dnd-players-handbook.origins', 'dnd-players-handbook.equipment'
]);

const han = /\p{Script=Han}/u;
const english = value => typeof value === 'string' && /[A-Za-z]/.test(value) && !han.test(value);

function originalName(key, index, knownNames) {
  const row = index?.get?.(key);
  if (row) {
    const original = row.flags?.babele?.originalName ?? row.originalName ?? row.name;
    return english(original) ? original : null;
  }
  // Babele permits IDs as keys. An unresolved ID is not an English name.
  // Actual 16-letter names such as Prestidigitation can be known to the provider.
  if (/^[A-Za-z0-9]{16}$/.test(key) && !knownNames.has(key)) return null;
  return english(key) ? key : null;
}

export function readNamePairs(packId, titles, index, knownNames) {
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) {
    throw Object.assign(new TypeError('Expected a Babele titles object'), {source: packId});
  }
  const byOriginal = new Map();
  for (const row of index?.values() ?? []) {
    const original = row.flags?.babele?.originalName ?? row.originalName ?? row.name;
    if (!byOriginal.has(original)) byOriginal.set(original, []);
    byOriginal.get(original).push(row);
  }
  const pairs = [];
  for (const [key, translatedName] of Object.entries(titles)) {
    if (typeof translatedName !== 'string' || !han.test(translatedName)) continue;
    const englishName = originalName(key, index, knownNames);
    const rows = index?.get?.(key) ? [index.get(key)] : byOriginal.get(key) ?? [null];
    for (const row of rows) pairs.push({translatedName, englishName, source: packId + '#' + key,
      type: row?.type, rules: row?.system?.source?.rules});
  }
  return pairs;
}

export function collectNamePairs(packs, titleIndex, knownNames, extraPackIds = []) {
  // Missing optional translator is distinct from a failed/incomplete dictionary.
  // Independent indexed originals and bilingual names remain usable.
  if (titleIndex === null) return [];
  // The base sources supply the same reference corpus even without optional
  // compendiums installed. Additional sources must be visible Item packs.
  const sources = new Set([...BASE_ITEM_PACKS, ...extraPackIds]);
  for (const packId of Object.keys(titleIndex)) {
    const pack = packs.get(packId);
    if (pack?.visible && pack.documentName === 'Item') sources.add(packId);
  }
  const pairs = [];
  for (const packId of sources) {
    const pack = packs.get(packId);
    const index = pack?.visible ? pack.index : null;
    for (const pair of readNamePairs(packId, titleIndex[packId]?.titles, index, knownNames)) pairs.push(pair);
  }
  return pairs;
}
