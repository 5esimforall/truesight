/** Identity metadata, not display names or automation provider identifiers. */
export const ITEM_TYPES = Object.freeze(['weapon', 'equipment', 'consumable', 'tool', 'loot', 'race',
  'background', 'class', 'subclass', 'spell', 'feat', 'container', 'backpack', 'facility']);
export const DOCUMENT_TYPES = Object.freeze(['Actor', 'JournalEntry', 'JournalEntryPage', 'Macro', 'Scene',
  'RollTable', 'Playlist', 'Cards']);
export const IDENTITY_FIELDS = Object.freeze(['system.type', 'system.classIdentifier', 'system.requirements',
  'system.prerequisites', 'system.advancement', 'system.rarity', 'system.magicalBonus', '_stats.compendiumSource']);
const text = value => typeof value === 'string' ? value.trim() : '';
const nameKey = value => text(value).normalize('NFKC').toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
export const validIdentifier = value => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(text(value))
  && !['none', 'unknown', 'undefined', 'null', 'spell', 'item'].includes(text(value)) ? text(value) : null;
const sorted = values => [...new Set(values)].sort();
const level = value => Number.isInteger(value) && value >= 0 && value <= 20 ? value : null;
const ownerKinds = new Set(['class', 'subclass', 'race', 'background']);
const physical = new Set(['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container', 'backpack']);
const categorical = new Set(['weapon', 'equipment', 'consumable', 'tool', 'loot', 'feat', 'facility']);
function add(map, key, value) { if (!map.has(key)) map.set(key, []); map.get(key).push(value); }

function owner(entry) {
  const {type, id, rules, system} = entry;
  if (entry.documentType !== 'Item' || !ownerKinds.has(type) || !id || !rules || entry.sourceConflict) return null;
  if (type === 'subclass' && !validIdentifier(system.classIdentifier)) return null;
  return {key: JSON.stringify([type, id, type === 'subclass' ? system.classIdentifier : null]),
    kind: type, id, rules};
}

/** Only explicit ItemGrant relationships establish ownership. Offering an
 * ItemChoice does not make every optional feat a feature of that class. */
export function prepareOwners(entries) {
  const aliases = new Map(), grants = new Map(), identifiers = new Map();
  for (const entry of entries.values()) {
    const identity = owner(entry);
    if (!identity) continue;
    add(identifiers, `${identity.rules}:${identity.kind}:${identity.id}`, identity);
    const names = [...entry.names, identity.id];
    for (const name of entry.names) {
      const bilingual = name.match(/^([\p{Script=Han}\s·，、：:（）()《》“”「」『』—-]+)\s+([A-Za-z][A-Za-z0-9\s'’:,()&.!+/-]*)$/u);
      if (bilingual && nameKey(bilingual[2]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === identity.id) names.push(bilingual[1], bilingual[2]);
    }
    for (const name of sorted(names.map(nameKey).filter(Boolean))) add(aliases, `${identity.rules}:${name}`, identity);
    for (const advancement of Array.isArray(entry.system.advancement) ? entry.system.advancement : []) {
      if (advancement?.type !== 'ItemGrant' || !Array.isArray(advancement.configuration?.items)) continue;
      for (const item of advancement.configuration.items) {
        const uuid = text(typeof item === 'string' ? item : item?.uuid);
        if (/^Compendium\.[^.]+\.[^.]+\.Item\.[^.]+$/.test(uuid)) add(grants, uuid, {...identity, level: level(advancement.level)});
      }
    }
  }
  return {aliases, grants, identifiers};
}

function featureContext(entry, owners, category) {
  const {system, rules, uuid} = entry;
  const expected = category === 'class' ? ['class', 'subclass'] : category === 'race' ? ['race']
    : category === 'background' ? ['background'] : [];
  if ((system.requirements != null && typeof system.requirements !== 'string')
    || (system.prerequisites != null && (typeof system.prerequisites !== 'object' || Array.isArray(system.prerequisites)))) return {warning: 'type-context'};
  const requirements = text(system.requirements);
  const parsed = requirements.match(/^(.+?)\s+(\d{1,2})(?:级)?$/u);
  const requiredName = parsed ? parsed[1] : requirements;
  const suppliedLevel = system.prerequisites?.level;
  const levels = [suppliedLevel, parsed ? Number(parsed[2]) : null].filter(v => v != null);
  if (levels.some(v => level(v) === null) || new Set(levels).size > 1) return {warning: 'context-conflict'};
  const evidence = [];
  const matching = identities => identities.filter(o => expected.includes(o.kind) && o.rules === rules);
  const grantOwners = matching(owners.grants.get(uuid) ?? []);
  if (grantOwners.length) evidence.push(sorted(grantOwners.map(o => o.key)));
  if (requiredName && expected.length) {
    const matches = sorted(matching(owners.aliases.get(`${rules}:${nameKey(requiredName)}`) ?? []).map(o => o.key));
    if (matches.length !== 1) return {warning: matches.length ? 'context-conflict' : 'owner-context'};
    evidence.push(matches);
  }
  if (system.classIdentifier && category === 'class') {
    const matches = sorted((owners.identifiers.get(`${rules}:class:${system.classIdentifier}`) ?? []).map(o => o.key));
    if (matches.length !== 1) return {warning: 'owner-context'};
    evidence.push(matches);
  }
  // Prerequisite identifiers can be class ownership evidence, but unrelated
  // feat prerequisites are constraints, not an owner inference.
  const items = system.prerequisites?.items;
  if (items != null && !(Array.isArray(items) || items instanceof Set)) return {warning: 'type-context'};
  if ([...(items ?? [])].some(value => typeof value !== 'string')) return {warning: 'type-context'};
  const prerequisites = sorted([...(items ?? [])].map(text).filter(Boolean));
  for (const prerequisite of prerequisites) {
    const match = prerequisite.match(/^(class|subclass|race|background):([a-z][a-z0-9-]*)$/);
    if (match && expected.includes(match[1])) {
      const matches = sorted((owners.identifiers.get(`${rules}:${match[1]}:${match[2]}`) ?? []).map(o => o.key));
      if (matches.length !== 1) return {warning: 'owner-context'};
      evidence.push(matches);
    }
  }
  let ownerKeys = evidence[0] ?? [];
  for (const value of evidence.slice(1)) {
    if (JSON.stringify(value) === JSON.stringify(ownerKeys)) continue;
    // A class requirement corroborates its subclass grant without erasing the
    // more specific subclass identity. Multiple unrelated owners never bridge.
    const candidates = ownerKeys.length === 1 && value.length === 1 ? [JSON.parse(ownerKeys[0]), JSON.parse(value[0])] : [];
    const child = candidates.find(v => v[0] === 'subclass'), parent = candidates.find(v => v[0] === 'class');
    if (!child || !parent || child[2] !== parent[1]) return {warning: 'context-conflict'};
    ownerKeys = [JSON.stringify(child)];
  }
  if (expected.length && !ownerKeys.length) return {warning: 'owner-context'};
  // Monster-specific features need a creature identity; a generic slug such
  // as "bite" cannot establish it. Explicit provenance is handled separately.
  if (category === 'monster') return {warning: 'owner-context'};
  const grantLevels = sorted(grantOwners.map(o => o.level).filter(v => v != null));
  if (levels.length && grantLevels.length && !grantLevels.includes(levels[0])) return {warning: 'context-conflict'};
  return {context: {owners: ownerKeys.map(key => {const [type, identifier, classIdentifier] = JSON.parse(key);
      return {type, identifier, classIdentifier};}), level: levels[0] ?? (grantLevels.length === 1 ? grantLevels[0] : null),
    prerequisites: prerequisites.filter(p => !expected.includes(p.split(':')[0]) || !/^(class|subclass|race|background):[a-z][a-z0-9-]*$/.test(p)),
    requirements: expected.length ? null : nameKey(requirements)}};
}

/** All registered dnd5e Item types use the identity policy; type-specific
 * constraints extend it rather than excluding whole known types. */
export function itemContext(entry, owners, environment) {
  const {type, system} = entry;
  const declared = environment.system?.documentTypes?.Item;
  if (!ITEM_TYPES.includes(type) && !(declared && Object.hasOwn(declared, type))) return {warning: 'unknown-type'};
  const data = system.type;
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) return {warning: 'type-context'};
  if (['value','subtype','baseItem'].some(key => data?.[key] != null && typeof data[key] !== 'string')) return {warning: 'type-context'};
  const category = text(data?.value), subtype = text(data?.subtype), baseItem = text(data?.baseItem);
  if (categorical.has(type) && !category) return {warning: 'type-context'};
  const context = {category, subtype, baseItem};
  if (type === 'subclass') {
    if (!validIdentifier(system.classIdentifier)) return {warning: 'owner-context'};
    context.classIdentifier = system.classIdentifier;
  }
  if (type === 'feat') {
    const feature = featureContext(entry, owners, category);
    if (feature.warning) return feature;
    Object.assign(context, feature.context);
  }
  if (physical.has(type)) {
    if ((system.rarity != null && typeof system.rarity !== 'string')
      || (system.magicalBonus != null && (!Number.isFinite(system.magicalBonus) || system.magicalBonus < 0))) return {warning: 'type-context'};
    context.rarity = text(system.rarity);
    context.magicalBonus = Number.isFinite(system.magicalBonus) ? system.magicalBonus : null;
  }
  return {context};
}
