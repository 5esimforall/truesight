/** Public notifications describe affected domains, never changed document IDs. */
export const ALL_CHANGES = Object.freeze(['identity', 'names', 'access', 'sources', 'review', 'display']);
export function affects(change, domains) {
  if (!Array.isArray(change?.changes)) throw new TypeError('Expected a domain-tagged change notification');
  return domains.some(domain => change.changes.includes(domain));
}

function paths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  const entries = Object.entries(value);
  if (!entries.length) return [prefix];
  return entries.flatMap(([key, child]) => paths(child, [prefix, key.replace(/(^|\.)-=/g, '$1')].filter(Boolean).join('.')));
}
const overlaps = (a, b) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.');

export function isLocalDocumentChange(event, document) {
  if (!/^(?:create|update|delete)(?:Item|Actor|JournalEntry|JournalEntryPage|Macro|Scene|RollTable|Playlist|Cards)$/.test(event)) return false;
  if (!document || typeof document !== 'object' || document.pack) return false;
  if (typeof document.uuid === 'string' && document.uuid.startsWith('Compendium.')) return false;
  if (document.parent?.pack) return false;
  return Boolean(document.id || document._id || document.parent || typeof document.uuid === 'string');
}

/** Accept Foundry's nested, dotted and deletion updates. Missing deltas are
 * conservatively relevant; known unrelated fields never invalidate evidence. */
export function classifyChange(event, document, delta, {userId} = {}) {
  if (event === 'updateSetting') {
    const key = document?.key ?? delta?.key;
    if (!key) return [...ALL_CHANGES];
    if (/^quick-insert\.(gmOnly|indexingDisabled|embeddedIndexing)$/.test(key)
      || /^core\.(permissions|compendiumConfiguration|moduleConfiguration)$/.test(key)) return ['access'];
    if (key === 'core.language') return ['sources', 'names'];
    if (/^chris-premades\.(thirdParty|additionalCompendiums|gambitPremades|miscPremades)$/.test(key)
      || /^(babele|dnd-simplified-chinese-babele-patch)\./.test(key)) return ['names'];
    return [];
  }
  if (!event.startsWith('update')) {
    if (event === 'createCompendium' || event === 'deleteCompendium') return ['identity', 'names', 'access'];
    if (event === 'createFolder' || event === 'deleteFolder') return ['names', 'access'];
    if (/^(?:create|delete)(?:Item|Actor)$/.test(event)) return ['identity', 'names'];
    return ['identity'];
  }
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return [...ALL_CHANGES];
  const fields = paths(delta).filter(path => path && path !== '_id');
  const has = (...keys) => fields.some(path => keys.some(key => overlaps(path, key)));
  if (event === 'updateUser') {
    return (!document?.id || !userId || document.id === userId) && has('role', 'permissions') ? ['access'] : [];
  }
  if (event === 'updateCompendium') return [...ALL_CHANGES];
  const result = new Set();
  if (has('ownership', 'permission', 'folder', 'visible')) result.add('access');
  if (event === 'updateFolder') {
    if (has('name', 'type', 'sorting')) result.add('names');
    return [...result];
  }
  if (has('type', 'system.identifier', 'system.source', 'system.level', 'system.school', 'system.type', 'system.classIdentifier', 'system.requirements', 'system.prerequisites',
    'system.advancement', 'system.rarity', 'system.magicalBonus', '_stats.compendiumSource', 'items')) result.add('identity');
  if (event === 'updateItem' && ['class', 'subclass', 'race', 'background'].includes(document?.type)
    && has('name', 'originalName', 'flags.babele')) result.add('identity');
  if (has('name', 'originalName', 'flags.babele', 'flags.chris-premades.info', 'flags.gambits-premades.gpsUuid', 'folderId')) {
    result.add(event === 'updateActor' && !has('items') ? 'display' : 'names');
  }
  if (has('system.description', 'system.uses.max', 'system.uses.recovery')) result.add('display');
  if (has('img')) result.add('display');
  return [...result];
}
