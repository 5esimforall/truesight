// @ts-check
/** @typedef {import('../../../types/api-v1.d.ts').DeclareOptions} DeclareOptions */
/** @typedef {import('../../../types/api-v1.d.ts').LookupOptions} LookupOptions */
/** @typedef {import('../../../types/api-v1.d.ts').ParsedCitation} ParsedCitation */
/** @typedef {import('../../../types/api-v1.d.ts').PublicationInput} PublicationInput */
/** @typedef {import('../../../types/api-v1.d.ts').PublicationRecord} PublicationRecord */
/** @typedef {import('../../../types/api-v1.d.ts').RulesEdition} RulesEdition */
/** @typedef {import('../../../types/api-v1.d.ts').SourceEnvironment} SourceEnvironment */
import { PUBLICATIONS } from "../../data/publications.mjs";

/** @param {unknown} value */
const text = value => typeof value === "string" ? value.trim() : "";
/** @param {unknown} value */
export const publicationKey = value => text(value).normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** @param {unknown} value */
export const isVersionNumber = value => /^(?:v\s*)?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(text(value));
/** @param {any} collection @returns {any[]} */
const values = collection => collection?.values ? [...collection.values()] : Object.values(collection ?? {});
/** @param {unknown} value @returns {string[]} */
const array = value => Array.isArray(value) ? value.filter(v => typeof v === "string" && v.trim()) : [];

// Generate common abbreviation styles from a registered title, not arbitrary
// document text. Alias collisions stay sets and must be resolved, never first-win.
/**
 * @param {unknown} title
 * @returns {string[]}
 */
export function titleAliases(title) {
  const clean = text(title).replace(/['’‘]/g, "").replace(/\(\d{4}\)/g, "");
  const words = clean.match(/[A-Za-zÀ-ž]+/g) ?? [];
  if (words.length < 2 || /[\p{Script=Han}]/u.test(clean)) return [];
  /** @param {string[]} list */
  const initials = list => list.map(word => word[0]).join("");
  const withoutArticles = words.filter(word => !/^(a|an|the)$/i.test(word));
  const meaningful = words.filter(word => !/^(a|an|the|of|to|from|and|in)$/i.test(word));
  return [...new Set([initials(words), initials(withoutArticles), initials(meaningful)])].filter(alias => alias.length >= 2);
}

/** Pure catalog. Identifiers and aliases are data; parsing has no publisher,
 * pack, item-name, UUID, or special-case book branches. */
export class PublicationCatalog {
  /** @param {readonly PublicationInput[]} [records] */
  constructor(records = PUBLICATIONS) {
    /** @type {Map<string, PublicationRecord>} */
    this.records = new Map();
    /** @type {Map<string, Set<string>>} */
    this.aliases = new Map();
    /** @type {Map<string, Set<string>>} */
    this.externalCodes = new Map();
    /** @type {Map<string, Set<string>>} */
    this.families = new Map();
    /** @type {Map<string, Set<string>>} */
    this.searchTerms = new Map();
    /** @type {Set<string>} */
    this.declaredIdentities = new Set();
    for (const record of records) this.add(record);
  }
  /**
   * @param {unknown} alias
   * @param {string} id
   * @param {Map<string, Set<string>>} [target]
   */
  addAlias(alias, id, target = this.aliases) {
    const key = publicationKey(alias);
    if (!key || isVersionNumber(alias)) return;
    let aliasSet = target.get(key);
    if (!aliasSet) { aliasSet = new Set(); target.set(key, aliasSet); }
    aliasSet.add(id);
    let termSet = this.searchTerms.get(id);
    if (!termSet) { termSet = new Set(); this.searchTerms.set(id, termSet); }
    termSet.add(text(alias));
  }
  /**
   * @param {PublicationInput | null | undefined} input
   * @returns {PublicationRecord | null}
   */
  add(input) {
    if (!input || !text(input.id) || !text(input.title) || !text(input.label)
      || isVersionNumber(input.label) || isVersionNumber(input.title)) return null;
    const id = text(input.id), existing = this.records.get(id);
    // Providers may add aliases/titles to an identity; conflicting definitions
    // cannot silently replace its family or generation.
    if (existing && ((input.family && input.family !== existing.family)
      || (input.rules && existing.rules && input.rules !== existing.rules))) return null;
    const rules = input.rules === "2014" || input.rules === "2024" ? input.rules : null;
    const record = existing ?? Object.freeze({
      id, family: text(input.family) || id, familyLabel: text(input.familyLabel) || text(input.label),
      label: text(input.label), title: text(input.title), rules,
      strictRules: input.strictRules === true && rules !== null, year: Number.isInteger(input.year) ? /** @type {number} */ (input.year) : null,
      category: text(input.category) || "publication"
    });
    this.records.set(id, record);
    let familySet = this.families.get(record.family);
    if (!familySet) { familySet = new Set(); this.families.set(record.family, familySet); }
    familySet.add(id);
    // Edition-specific titles must not generate bare acronyms like PHB/DMG.
    const generated = input.family ? [] : titleAliases(input.title);
    for (const alias of [id, input.label, input.title, ...array(input.aliases), ...generated, ...array(input.familyAliases)]) this.addAlias(alias, id);
    for (const code of array(input.externalCodes)) this.addAlias(code, id, this.externalCodes);
    return record;
  }
  /**
   * @param {unknown} value
   * @param {LookupOptions} [options]
   * @returns {PublicationRecord[]}
   */
  lookup(value, { external = false } = {}) {
    const key = publicationKey(value);
    const ids = (external && this.externalCodes.get(key)) || this.aliases.get(key) || new Set();
    return [...ids].map(id => this.records.get(id)).filter(/** @returns {record is PublicationRecord} */ record => Boolean(record));
  }
  /** @param {string} id @returns {string[]} */
  termsFor(id) { return [...this.searchTerms.get(id) ?? []]; }
  /**
   * @param {unknown} code
   * @param {unknown} [title]
   * @param {DeclareOptions} [options]
   */
  declare(code, title, { external = false, abbreviation, year } = {}) {
    if (typeof code !== "string" || !text(code) || isVersionNumber(code)) return;
    // Known provider codes are a stronger signal than localized display titles.
    const candidates = this.lookup(code, { external });
    const abbreviated = this.lookup(abbreviation);
    const titled = this.lookup(title);
    const match = candidates.length === 1 ? candidates : abbreviated.length === 1 ? abbreviated : titled;
    if (match.length === 1) {
      let record = match[0];
      // Unknown provider abbreviations are not globally unique identifiers.
      // Two declarations with incompatible titles become an alias collision,
      // rather than merging publications merely because both chose "ABC".
      if (this.declaredIdentities.has(record.id) && typeof title === "string" && text(title) && publicationKey(title) !== publicationKey(code)
        && publicationKey(record.title) !== publicationKey(title) && !titled.some(book => book.id === record.id)) {
        if (publicationKey(record.title) === publicationKey(code)) {
          record = Object.freeze({ ...record, title: text(title) });
          this.records.set(record.id, record);
        } else {
          const id = `${publicationKey(code)}:${publicationKey(title)}`;
          this.add({ id, label: text(abbreviation) || code, title, year, aliases: [code], externalCodes: external ? [code] : [] });
          this.declaredIdentities.add(id);
          return;
        }
      }
      // Generic core codes must remain edition-ambiguous for native documents.
      if (!candidates.length || candidates.every(x => x.family !== record.family)) this.addAlias(code, record.id);
      if (typeof title === "string" && text(title) && !/^[A-Z][\w-]*\.[\w.]+$/.test(title)) this.addAlias(title, record.id);
      if (abbreviation) this.addAlias(abbreviation, record.id);
      if (external) this.addAlias(code, record.id, this.externalCodes);
      return;
    }
    // Do not create another identity for an ambiguous existing family.
    if (candidates.length || titled.length || abbreviated.length) return;
    const id = publicationKey(code);
    this.add({ id, label: text(abbreviation) || code, title: text(title) || code, year,
      aliases: [code], externalCodes: external ? [code] : [] });
    this.declaredIdentities.add(id);
  }
}

/** Read-only metadata adapter. Nothing here loads documents or changes Foundry
 * data. A provider is optional; a missing importer never disables the catalog. */
/**
 * @param {SourceEnvironment} [environment]
 * @returns {PublicationCatalog}
 */
export function buildPublicationCatalog(environment = {}) {
  const catalog = new PublicationCatalog(environment.publications ?? PUBLICATIONS);
  /** @param {unknown} value */
  const localize = value => typeof value === "string" ? text(environment.localize?.(value)) || text(value) : "";
  /** @param {Record<string, unknown> | null | undefined} map */
  const declareMap = map => {
    for (const [key, value] of Object.entries(map ?? {})) {
      const localized = localize(value);
      catalog.declare(key, localized === value && typeof value === "string" && /^[A-Za-z][\w-]*\.[\w.]+$/.test(value) ? key : localized);
    }
  };
  const packages = [environment.system, environment.world, ...values(environment.modules).filter(pkg => pkg.active !== false)].filter(Boolean);
  for (const pkg of packages) {
    declareMap(pkg.flags?.dnd5e?.sourceBooks);
    const publications = pkg.flags?.truesight?.publications;
    if (Array.isArray(publications)) for (const record of publications) catalog.add(record);
  }
  declareMap(environment.sourceBooks);
  for (const pack of values(environment.packs)) {
    const code = pack.metadata?.flags?.dnd5e?.sourceBook;
    if (typeof code === "string") catalog.declare(code, code);
  }
  // Adapter for the current 5etools-style published source catalog protocol.
  // Codes such as PHB are exact editions ONLY in this external-provider context.
  const external = environment.externalPublications;
  for (const [code, title] of Object.entries(external?.titles ?? {})) catalog.declare(code, title, {
    external: true, abbreviation: external?.abbreviations?.[code], year: Number(String(external?.dates?.[code] ?? "").slice(0, 4)) || undefined
  });
  for (const records of values(environment.publicationProviders)) if (Array.isArray(records)) for (const record of records) catalog.add(record);
  return catalog;
}

export const DEFAULT_PUBLICATION_CATALOG = new PublicationCatalog();

/** Split bibliography punctuation only when it introduces a new non-numeric
 * citation. Commas/semicolons between page numbers stay with their book. */
/**
 * @param {unknown} value
 * @param {import('../../../types/api-v1.d.ts').PublicationCatalogInstance} [catalog]
 * @param {LookupOptions} [options]
 * @returns {ParsedCitation[]}
 */
export function parseCitations(value, catalog = DEFAULT_PUBLICATION_CATALOG, options = {}) {
  const raw = text(value);
  if (!raw) return [];
  const direct = catalog.lookup(raw, options);
  if (direct.length) return [{ raw, text: raw, page: "", candidates: direct }];
  // Strip Chinese trailing page notation before splitting on its comma.
  const chinese = raw.match(/[,，\s]*第\s*([\d\s,，;；\-–—]+)\s*页\s*$/u);
  const body = chinese ? raw.slice(0, chinese.index).trim() : raw;
  const pieces = body.split(/\s*[/;,，；]\s*(?=[^\d\s])/u);
  return pieces.map((piece, index) => {
    const pageMatch = piece.match(/\s*(?:\b(?:pg\.?|pp?\.?|pages?)\s*)\s*([\d][\d\s,，;；\-–—]*)\s*$/iu);
    const name = (pageMatch ? piece.slice(0, pageMatch.index) : piece).trim().replace(/[.,，;；]+$/, "").trim();
    return { raw: piece, text: name, page: pageMatch?.[1]?.trim() || (index === pieces.length - 1 ? chinese?.[1]?.trim() || "" : ""), candidates: catalog.lookup(name, options) };
  });
}
