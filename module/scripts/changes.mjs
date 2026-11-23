import {DOCUMENT_TYPES} from './catalog/item-identity.mjs';

/** Public notifications describe affected domains, never changed document IDs. */
export const ALL_CHANGES = Object.freeze(['identity', 'names', 'access', 'sources', 'review', 'display']);
export const INDEXED_DOCUMENT_TYPES = Object.freeze(['Item', ...DOCUMENT_TYPES]);
const INDEXED_SET = new Set(INDEXED_DOCUMENT_TYPES);
const HAN = /\p{Script=Han}/u;
const OWNER_ITEM_TYPES = new Set(['class', 'subclass', 'race', 'background']);

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
const eventDocumentType = event => {
  const match = event.match(/^(?:create|update|delete)(.+)$/);
  return match ? match[1] : null;
};
const isOwnerItem = document => OWNER_ITEM_TYPES.has(document?.type);
const hasHanName = item => typeof item?.name === 'string' && HAN.test(item.name);

function actorHasHanItems(actor) {
  if (actor?.items == null) return null;
  const items = typeof actor.items.values === 'function' ? actor.items.values()
    : Array.isArray(actor.items) ? actor.items : null;
  if (!items) return null;
  for (const item of items) if (hasHanName(item)) return true;
  return false;
}

export function isTokenDocument(document) {
  if (!document || typeof document !== 'object') return false;
  if (document.isToken === true || document.parent?.isToken === true
    || document.parent?.documentName === 'Token' || document.parent?.parent?.documentName === 'Token') return true;
  return typeof document.uuid === 'string' && /^Scene\.[^.]+\.Token\./.test(document.uuid);
}

export function isEmbeddedActorItem(event, document) {
  if (!/^(?:create|update|delete)Item$/.test(event)) return false;
  if (!document || typeof document !== 'object' || document.pack || document.parent?.pack) return false;
  if (typeof document.uuid === 'string' && /^Actor\.[^.]+\.Item\./.test(document.uuid)) return true;
  return Boolean(document.parent && (document.parent.documentName === 'Actor'
    || document.parent.items !== undefined
    || (typeof document.parent.uuid === 'string' && document.parent.uuid.startsWith('Actor.'))));
}

function isEmbeddedJournalPage(event, document) {
  return /^(?:create|update|delete)JournalEntryPage$/.test(event) && !document?.pack && !document?.parent?.pack;
}

export function isLocalDocumentChange(event, document, {indexedTypes} = {}) {
  const type = eventDocumentType(event);
  if (!type || (!INDEXED_SET.has(type) && !indexedTypes?.has(type))) return false;
  if (!document || typeof document !== 'object' || document.pack) return false;
  if (typeof document.uuid === 'string' && document.uuid.startsWith('Compendium.')) return false;
  if (document.parent?.pack) return false;
  return Boolean(document.id || document._id || document.parent || typeof document.uuid === 'string');
}

/** Accept Foundry's nested, dotted and deletion updates. Missing deltas are
 * conservatively relevant; known unrelated fields never invalidate evidence. */
export function classifyChange(event, document, delta, {userId, embeddedIndexing = false, indexedTypes} = {}) {
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
  const special = /^(?:create|update|delete)(?:Compendium|Folder)$/.test(event) || event === 'updateUser';
  if (!special) {
    const type = eventDocumentType(event);
    if (!type || (!INDEXED_SET.has(type) && !indexedTypes?.has(type))) return [];
    if (isTokenDocument(document)) return [];
    if (isEmbeddedJournalPage(event, document) && !embeddedIndexing) return [];
    if (isEmbeddedActorItem(event, document) && !embeddedIndexing) {
      if (!event.startsWith('update')) {
        return typeof document.name === 'string' && !HAN.test(document.name) ? [] : ['names'];
      }
      if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return ['names'];
      const fields = paths(delta).filter(path => path && path !== '_id');
      const has = (...keys) => fields.some(path => keys.some(key => overlaps(path, key)));
      if (!has('name', 'originalName', 'flags.babele', 'flags.chris-premades.info', 'flags.gambits-premades.gpsUuid',
        'type', 'system.identifier', 'system.source', 'system.type')) return [];
      if (!has('name') && typeof document.name === 'string' && !HAN.test(document.name)) return [];
      return ['names'];
    }
  }
  if (!event.startsWith('update')) {
    if (event === 'createCompendium' || event === 'deleteCompendium') return ['identity', 'names', 'access'];
    if (event === 'createFolder' || event === 'deleteFolder') return ['names', 'access'];
    if (event === 'createItem' || event === 'deleteItem') {
      if (isLocalDocumentChange(event, document, {indexedTypes}) && typeof document?.name === 'string'
        && !HAN.test(document.name) && !isOwnerItem(document)) return ['identity'];
      return ['identity', 'names'];
    }
    if (event === 'createActor' || event === 'deleteActor') {
      return actorHasHanItems(document) === false ? ['identity'] : ['identity', 'names'];
    }
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
  if (event === 'updateItem' && isOwnerItem(document)
    && has('name', 'originalName', 'flags.babele')) result.add('identity');
  if (has('name', 'originalName', 'flags.babele', 'flags.chris-premades.info', 'flags.gambits-premades.gpsUuid', 'folderId')) {
    result.add(event === 'updateActor' && !has('items') ? 'display' : 'names');
  }
  if (has('system.description', 'system.uses.max', 'system.uses.recovery')) result.add('display');
  if (has('img')) result.add('display');
  return [...result];
}
