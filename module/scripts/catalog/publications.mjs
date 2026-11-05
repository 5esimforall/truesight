import { PUBLICATIONS } from "../../data/publications.mjs";

const text = value => typeof value === "string" ? value.trim() : "";
export const publicationKey = value => text(value).normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const isVersionNumber = value => /^(?:v\s*)?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(text(value));
const values = collection => collection?.values ? [...collection.values()] : Object.values(collection ?? {});
const array = value => Array.isArray(value) ? value.filter(v => typeof v === "string" && v.trim()) : [];

// Generate common abbreviation styles from a registered title, not arbitrary
// document text. Alias collisions stay sets and must be resolved, never first-win.
export function titleAliases(title) {
  const clean = text(title).replace(/['’‘]/g, "").replace(/\(\d{4}\)/g, "");
  const words = clean.match(/[A-Za-zÀ-ž]+/g) ?? [];
  if (words.length < 2 || /[\p{Script=Han}]/u.test(clean)) return [];
  const initials = list => list.map(word => word[0]).join("");
  const withoutArticles = words.filter(word => !/^(a|an|the)$/i.test(word));
  const meaningful = words.filter(word => !/^(a|an|the|of|to|from|and|in)$/i.test(word));
  return [...new Set([initials(words), initials(withoutArticles), initials(meaningful)])].filter(alias => alias.length >= 2);
}

/** Pure catalog. Identifiers and aliases are data; parsing has no publisher,
 * pack, item-name, UUID, or special-case book branches. */
export class PublicationCatalog {
  constructor(records = PUBLICATIONS) {
    this.records = new Map();
    this.aliases = new Map();
    this.externalCodes = new Map();
    this.families = new Map();
    this.searchTerms = new Map();
    this.declaredIdentities = new Set();
    for (const record of records) this.add(record);
  }
  addAlias(alias, id, target = this.aliases) {
    const key = publicationKey(alias);
    if (!key || isVersionNumber(alias)) return;
    if (!target.has(key)) target.set(key, new Set());
    target.get(key).add(id);
    if (!this.searchTerms.has(id)) this.searchTerms.set(id, new Set());
    this.searchTerms.get(id).add(text(alias));
  }
  add(input) {
    if (!input || !text(input.id) || !text(input.title) || !text(input.label)
      || isVersionNumber(input.label) || isVersionNumber(input.title)) return null;
    const id = text(input.id), existing = this.records.get(id);
    // Providers may add aliases/titles to an identity; conflicting definitions
    // cannot silently replace its family or generation.
    if (existing && ((input.family && input.family !== existing.family)
      || (input.rules && existing.rules && input.rules !== existing.rules))) return null;
    const record = existing ?? Object.freeze({
      id, family: text(input.family) || id, familyLabel: text(input.familyLabel) || text(input.label),
      label: text(input.label), title: text(input.title), rules: ["2014", "2024"].includes(input.rules) ? input.rules : null,
      strictRules: input.strictRules === true && ["2014", "2024"].includes(input.rules), year: Number.isInteger(input.year) ? input.year : null,
      category: text(input.category) || "publication"
    });
    this.records.set(id, record);
    if (!this.families.has(record.family)) this.families.set(record.family, new Set());
    this.families.get(record.family).add(id);
    // Edition-specific titles must not generate bare acronyms like PHB/DMG.
    const generated = input.family ? [] : titleAliases(input.title);
    for (const alias of [id, input.label, input.title, ...array(input.aliases), ...generated, ...array(input.familyAliases)]) this.addAlias(alias, id);
    for (const code of array(input.externalCodes)) this.addAlias(code, id, this.externalCodes);
    return record;
  }
  lookup(value, { external = false } = {}) {
    const key = publicationKey(value);
    const ids = (external && this.externalCodes.get(key)) || this.aliases.get(key) || new Set();
    return [...ids].map(id => this.records.get(id)).filter(Boolean);
  }
  termsFor(id) { return [...this.searchTerms.get(id) ?? []]; }
  declare(code, title, { external = false, abbreviation, year } = {}) {
    if (!text(code) || isVersionNumber(code)) return;
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
      if (this.declaredIdentities.has(record.id) && text(title) && publicationKey(title) !== publicationKey(code)
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
      if (text(title) && !/^[A-Z][\w-]*\.[\w.]+$/.test(title)) this.addAlias(title, record.id);
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
export function buildPublicationCatalog(environment = {}) {
  const catalog = new PublicationCatalog(environment.publications ?? PUBLICATIONS);
  const localize = value => typeof value === "string" ? text(environment.localize?.(value)) || text(value) : "";
  const declareMap = map => {
    for (const [key, value] of Object.entries(map ?? {})) {
      const localized = localize(value);
      catalog.declare(key, localized === value && /^[A-Za-z][\w-]*\.[\w.]+$/.test(value) ? key : localized);
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
    external: true, abbreviation: external.abbreviations?.[code], year: Number(String(external.dates?.[code] ?? "").slice(0, 4)) || undefined
  });
  for (const records of values(environment.publicationProviders)) if (Array.isArray(records)) for (const record of records) catalog.add(record);
  return catalog;
}

export const DEFAULT_PUBLICATION_CATALOG = new PublicationCatalog();

/** Split bibliography punctuation only when it introduces a new non-numeric
 * citation. Commas/semicolons between page numbers stay with their book. */
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
