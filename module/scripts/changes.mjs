// @ts-check
/** @typedef {import('../../types/api-v1.d.ts').ChangeDomain} ChangeDomain */
/** @typedef {import('../../types/api-v1.d.ts').DomainChangeEvent} DomainChangeEvent */
import {DOCUMENT_TYPES} from './catalog/item-identity.mjs';

/** Public notifications describe affected domains, never changed document IDs. */
/** @type {readonly ChangeDomain[]} */
export const ALL_CHANGES = Object.freeze(['identity', 'names', 'access', 'sources', 'review', 'display']);
/** @type {readonly string[]} */
export const INDEXED_DOCUMENT_TYPES = Object.freeze(['Item', ...DOCUMENT_TYPES]);
const INDEXED_SET = new Set(INDEXED_DOCUMENT_TYPES);
const HAN = /\p{Script=Han}/u;
const OWNER_ITEM_TYPES = new Set(['class', 'subclass', 'race', 'background']);

/**
 * @param {DomainChangeEvent | null | undefined} change
 * @param {readonly ChangeDomain[]} domains
 * @returns {boolean}
 */
export function affects(change, domains) {
  if (!Array.isArray(change?.changes)) throw new TypeError('Expected a domain-tagged change notification');
  const present = change.changes;
  return domains.some(domain => present.includes(domain));
}

/**
 * @param {unknown} value
 * @param {string} [prefix]
 * @returns {string[]}
 */
function paths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  const entries = Object.entries(value);
  if (!entries.length) return [prefix];
  return entries.flatMap(([key, child]) => paths(child, [prefix, key.replace(/(^|\.)-=/g, '$1')].filter(Boolean).join('.')));
}
/** @type {(a: string, b: string) => boolean} */
const overlaps = (a, b) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.');
/** @param {string} event */
const eventDocumentType = event => {
  const match = event.match(/^(?:create|update|delete)(.+)$/);
  return match ? match[1] : null;
};
/** @param {any} document */
const isOwnerItem = document => OWNER_ITEM_TYPES.has(document?.type);
/** @param {any} item */
const hasHanName = item => typeof item?.name === 'string' && HAN.test(item.name);

/**
 * @param {any} actor
 * @returns {string | null}
 */
export function effectiveActorType(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const items = typeof actor.items?.values === 'function' ? actor.items.values()
    : Array.isArray(actor.items) ? actor.items : null;
  if (items) {
    for (const entry of items) if (entry?.type === 'class') return 'character';
  }
  return typeof actor.type === 'string' && actor.type ? actor.type : null;
}

/**
 * @param {any} actor
 * @returns {boolean}
 */
export function isNonCharacterActor(actor) {
  const type = effectiveActorType(actor);
  return type !== null && type !== 'character';
}

/** @param {any} document */
function isWorldSidebarFolder(document) {
  return Boolean(document && typeof document === 'object' && !document.pack
    && typeof document.type === 'string' && document.type !== 'Compendium' && INDEXED_SET.has(document.type));
}
/** @param {any} document */
function isCompendiumItemFolder(document) {
  return Boolean(document?.pack && document?.type === 'Item');
}
/** @param {any} document */
function isNonItemCompendiumFolder(document) {
  return Boolean(document?.pack && typeof document?.type === 'string'
    && document.type !== 'Item' && document.type !== 'Compendium');
}

/**
 * @param {any} actor
 * @returns {boolean | null}
 */
function actorHasHanItems(actor) {
  if (actor?.items == null) return null;
  const items = typeof actor.items.values === 'function' ? actor.items.values()
    : Array.isArray(actor.items) ? actor.items : null;
  if (!items) return null;
  for (const item of items) if (hasHanName(item)) return true;
  return false;
}

/**
 * @param {any} document
 * @returns {boolean}
 */
export function isTokenDocument(document) {
  if (!document || typeof document !== 'object') return false;
  if (document.isToken === true || document.parent?.isToken === true
    || document.parent?.documentName === 'Token' || document.parent?.parent?.documentName === 'Token') return true;
  return typeof document.uuid === 'string' && /^Scene\.[^.]+\.Token\./.test(document.uuid);
}

/**
 * @param {string} event
 * @param {any} document
 * @returns {boolean}
 */
export function isEmbeddedActorItem(event, document) {
  if (!/^(?:create|update|delete)Item$/.test(event)) return false;
  if (!document || typeof document !== 'object' || document.pack || document.parent?.pack) return false;
  if (typeof document.uuid === 'string' && /^Actor\.[^.]+\.Item\./.test(document.uuid)) return true;
  return Boolean(document.parent && (document.parent.documentName === 'Actor'
    || document.parent.items !== undefined
    || (typeof document.parent.uuid === 'string' && document.parent.uuid.startsWith('Actor.'))));
}

/**
 * @param {string} event
 * @param {any} document
 * @returns {boolean}
 */
function isEmbeddedJournalPage(event, document) {
  return /^(?:create|update|delete)JournalEntryPage$/.test(event) && !document?.pack && !document?.parent?.pack;
}

/**
 * @param {string} event
 * @param {any} document
 * @param {{ indexedTypes?: Set<string> }} [options]
 * @returns {boolean}
 */
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
/**
 * @param {string} event
 * @param {any} document
 * @param {any} delta
 * @param {{ userId?: string, embeddedIndexing?: boolean, indexedTypes?: Set<string> }} [options]
 * @returns {ChangeDomain[]}
 */
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
  if (/^(?:create|update|delete)Folder$/.test(event)) {
    if (isWorldSidebarFolder(document) || isNonItemCompendiumFolder(document)) return [];
    if (isCompendiumItemFolder(document)) {
      if (!event.startsWith('update')) return ['names'];
      if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return ['names'];
      const fields = paths(delta).filter(path => path && path !== '_id');
      return fields.some(path => ['name', 'type', 'sorting'].some(key => overlaps(path, key))) ? ['names'] : [];
    }
    if (!event.startsWith('update')) return ['names', 'access'];
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return [...ALL_CHANGES];
    const fields = paths(delta).filter(path => path && path !== '_id');
    /** @param {...string} keys */
    const has = (...keys) => fields.some(path => keys.some(key => overlaps(path, key)));
    /** @type {Set<ChangeDomain>} */
    const result = new Set();
    if (has('ownership', 'permission', 'visible')) result.add('access');
    if (has('name', 'type', 'sorting')) result.add('names');
    return [...result];
  }
  const special = /^(?:create|update|delete)Compendium$/.test(event) || event === 'updateUser';
  const docType = eventDocumentType(event);
  const embeddedItem = isEmbeddedActorItem(event, document);
  const nonCharacterParent = embeddedItem && isNonCharacterActor(document.parent);
  const isClassItem = document?.type === 'class';
  if (!special) {
    if (!docType || (!INDEXED_SET.has(docType) && !indexedTypes?.has(docType))) return [];
    if (isTokenDocument(document)) return [];
    if (isEmbeddedJournalPage(event, document) && !embeddedIndexing) return [];
    if (embeddedItem && !embeddedIndexing) {
      if (nonCharacterParent && !isClassItem) return [];
      if (!event.startsWith('update')) {
        if (isClassItem) return hasHanName(document) || actorHasHanItems(document.parent) !== false ? ['names'] : [];
        return typeof document.name === 'string' && !HAN.test(document.name) ? [] : ['names'];
      }
      if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return ['names'];
      const fields = paths(delta).filter(path => path && path !== '_id');
      /** @param {...string} keys */
      const has = (...keys) => fields.some(path => keys.some(key => overlaps(path, key)));
      if (!has('name', 'originalName', 'flags.babele', 'flags.chris-premades.info', 'flags.gambits-premades.gpsUuid',
        'type', 'system.identifier', 'system.source', 'system.type')) return [];
      if (isClassItem || has('type')) return ['names'];
      if (!has('name') && typeof document.name === 'string' && !HAN.test(document.name)) return [];
      return ['names'];
    }
  }
  if (!event.startsWith('update')) {
    if (event === 'createCompendium' || event === 'deleteCompendium') return ['identity', 'names', 'access'];
    if (event === 'createItem' || event === 'deleteItem') {
      if (embeddedItem) {
        if (nonCharacterParent && !isClassItem) return ['identity'];
        if (isClassItem) return hasHanName(document) || actorHasHanItems(document.parent) !== false ? ['identity', 'names'] : ['identity'];
      }
      if (isLocalDocumentChange(event, document, {indexedTypes}) && typeof document?.name === 'string'
        && !HAN.test(document.name) && !isOwnerItem(document)) return ['identity'];
      return ['identity', 'names'];
    }
    if (event === 'createActor' || event === 'deleteActor') {
      if (isNonCharacterActor(document)) return ['identity'];
      return actorHasHanItems(document) === false ? ['identity'] : ['identity', 'names'];
    }
    return ['identity'];
  }
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    if (docType && docType !== 'Item' && docType !== 'Actor' && !special) return ['identity', 'access', 'display'];
    return [...ALL_CHANGES];
  }
  const fields = paths(delta).filter(path => path && path !== '_id');
  /** @param {...string} keys */
  const has = (...keys) => fields.some(path => keys.some(key => overlaps(path, key)));
  if (event === 'updateUser') {
    return (!document?.id || !userId || document.id === userId) && has('role', 'permissions') ? ['access'] : [];
  }
  if (event === 'updateCompendium') return [...ALL_CHANGES];
  const local = isLocalDocumentChange(event, document, {indexedTypes});
  /** @type {Set<ChangeDomain>} */
  const result = new Set();
  if (has('ownership', 'permission', 'visible')) result.add('access');
  if (event === 'updateItem' && !local && has('folder')) result.add('names');
  if (has('type', 'system.identifier', 'system.source', 'system.level', 'system.school', 'system.type', 'system.classIdentifier', 'system.requirements', 'system.prerequisites',
    'system.advancement', 'system.rarity', 'system.magicalBonus', '_stats.compendiumSource', 'items')) result.add('identity');
  if (event === 'updateActor' && has('type') && actorHasHanItems(document) !== false) result.add('names');
  if (event === 'updateActor' && has('items') && !isNonCharacterActor(document) && actorHasHanItems(document) !== false) result.add('names');
  if (event === 'updateItem' && isOwnerItem(document)
    && has('name', 'originalName', 'flags.babele')) result.add('identity');
  if (has('name', 'originalName', 'flags.babele', 'flags.chris-premades.info', 'flags.gambits-premades.gpsUuid', 'folderId')) {
    result.add(event === 'updateItem' && !(embeddedItem && nonCharacterParent && !isClassItem) ? 'names' : 'display');
  }
  if (has('system.description', 'system.uses.max', 'system.uses.recovery')) result.add('display');
  if (has('img')) result.add('display');
  return [...result];
}
