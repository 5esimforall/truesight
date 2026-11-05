import { buildPublicationCatalog, DEFAULT_PUBLICATION_CATALOG, parseCitations, isVersionNumber, publicationKey } from "./publications.mjs";

const text = value => typeof value === "string" ? value.trim() : "";
const unique = values => [...new Set(values)];
const known = citations => citations.filter(citation => citation.candidates.length);
const families = citations => new Set(citations.flatMap(citation => citation.candidates.map(book => book.family)));
const generation = value => ["2014", "2024"].includes(value) ? value : null;
const pageText = value => typeof value === "number" && Number.isFinite(value) ? String(value) : text(value);

/** Construct once per permitted index / provider revision, not per keystroke.
 * The cache contains only derived display data and never mutates index entries. */
export function prepareSourceEnvironment(environment = {}) {
  if (environment.sourceCatalog && environment.sourceCache) return environment;
  const hasProviders = environment.packs || environment.modules || environment.system || environment.sourceBooks
    || environment.externalPublications || environment.publicationProviders || environment.publications;
  return { ...environment,
    sourceCatalog: environment.sourceCatalog ?? (hasProviders ? buildPublicationCatalog(environment) : DEFAULT_PUBLICATION_CATALOG),
    sourceCache: environment.sourceCache ?? new WeakMap()
  };
}

export function sourceContext(item, environment = {}) {
  const external = /^@[\w]+\[/.test(item.uuid ?? "");
  const packId = item.package || item.uuid?.match(/^Compendium\.([^.]+\.[^.]+)\./)?.[1];
  const pack = environment.packs?.get(packId), metadata = pack?.metadata;
  const pkg = metadata?.packageType === "system" ? environment.system : metadata?.packageType === "world" ? environment.world
    : environment.modules?.get(metadata?.packageName);
  const source = item.system?.source;
  const data = source && typeof source === "object" ? source : {};
  const books = Object.keys(pkg?.flags?.dnd5e?.sourceBooks ?? {});
  return {
    external, origin: external ? "external" : packId ? "compendium" : "world", packId,
    location: text(pack?.title) || text(metadata?.label) || text(item.packageName),
    packageName: text(pkg?.title) || text(metadata?.packageName),
    book: text(data.book), custom: text(data.custom),
    externalSource: external ? text(item.source) : "", rules: generation(text(data.rules)),
    page: pageText(data.page),
    packBook: text(metadata?.flags?.dnd5e?.sourceBook), packageBook: books.length === 1 ? books[0] : ""
  };
}

/** Resolve independent citation evidence. Raw free text is not a new book.
 * Explicit conflicting evidence is retained, not silently won by a priority
 * order. Containers only supply missing metadata / disambiguate the same family.
 */
export function identifySource(item, environment = {}) {
  const cached = environment.sourceCache?.get(item);
  if (cached) return cached;
  const prepared = prepareSourceEnvironment(environment), catalog = prepared.sourceCatalog;
  const context = sourceContext(item, prepared);
  const { external, rules, page } = context;
  const parse = value => parseCitations(value, catalog, { external });
  const book = parse(context.book), custom = parse(context.custom);
  const pack = parse(context.packBook), pkg = parse(context.packageBook);
  const bookKnown = known(book), customKnown = known(custom);
  let citations = [], unresolved = [], basis = "document", conflict = null;

  if (external) {
    citations = parse(context.externalSource);
    basis = "external";
  } else if (customKnown.length) {
    citations = custom;
    if (bookKnown.length) {
      const customFamilies = families(customKnown), bookFamilies = families(bookKnown);
      if ([...bookFamilies].some(family => !customFamilies.has(family))) conflict = "source-conflict";
      // A generic PHB citation and explicit PHB 2024 field corroborate each
      // other; PHB 2014 vs PHB 2024 is a conflict, not an arbitrary override.
      citations = citations.map(citation => {
        const related = bookKnown.flatMap(entry => entry.candidates).filter(candidate => citation.candidates.some(b => b.family === candidate.family));
        if (!related.length) return citation;
        const intersection = citation.candidates.filter(candidate => related.some(b => b.id === candidate.id));
        if (!intersection.length) { conflict = "edition-conflict"; return citation; }
        return { ...citation, candidates: intersection };
      });
    }
  } else if (bookKnown.length) {
    // Custom text often records the automation version or a credit. It stays
    // in the tooltip but does not hide a valid structured source.book.
    citations = book;
  } else {
    const explicit = context.book || context.custom;
    const implementation = isVersionNumber(explicit) || /^(?:[\p{L}\s_-]+\s*)?v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(explicit)
      || [context.location, context.packageName, context.packId].some(value => value && publicationKey(value) === publicationKey(explicit));
    if (!explicit || implementation) {
      if (known(pack).length) { citations = pack; basis = "pack"; }
      else if (known(pkg).length) { citations = pkg; basis = "package"; }
    }
    if (!citations.length && explicit) unresolved = [explicit];
  }

  const references = [];
  const fallback = known(pack).length ? known(pack) : known(pkg);
  for (const citation of citations) {
    let candidates = citation.candidates;
    if (!candidates.length) { unresolved.push(citation.raw); continue; }
    let confidence = candidates.length === 1 ? basis : "ambiguous";
    // Only contextual metadata for the SAME book family can disambiguate it.
    if (candidates.length > 1 && !external) {
      const sameFamily = fallback.flatMap(entry => entry.candidates).filter(book => candidates.some(b => b.family === book.family));
      if (sameFamily.length === 1) {
        const selected = candidates.filter(book => book.id === sameFamily[0].id);
        if (selected.length) { candidates = selected; confidence = "container"; }
      }
    }
    if (candidates.length > 1 && rules) {
      const selected = candidates.filter(book => book.rules === rules);
      if (selected.length === 1) { candidates = selected; confidence = "rules"; }
    }
    const record = candidates.length === 1 ? candidates[0] : null;
    if (record?.strictRules && rules && record.rules !== rules) conflict = "edition-conflict";
    references.push({ record, candidates, page: citation.page || (citations.length === 1 ? page : ""), raw: citation.raw, confidence });
  }
  // Two explicit generations in one citation must not leak into either edition
  // filter as a confirmed implementation.
  const editions = unique(references.flatMap(ref => ref.record?.strictRules ? [ref.record.rules] : []).filter(Boolean));
  if (editions.length > 1) conflict = "edition-conflict";
  const ambiguous = references.filter(ref => !ref.record);
  const ambiguousStatus = ambiguous.some(ref => new Set(ref.candidates.map(book => book.family)).size > 1) ? "ambiguous" : "edition-unknown";
  const status = conflict || (!references.length ? "unknown" : ambiguous.length ? ambiguousStatus : unresolved.length ? "partial" : "confirmed");
  const result = {
    ...context, status, references, unresolved: unique(unresolved),
    rules: conflict === "edition-conflict" ? null : rules || (editions.length === 1 ? editions[0] : null),
    documentRules: rules,
    raw: [
      ["book", context.book], ["custom", context.custom],
      ["external", context.externalSource], ["pack", context.packBook], ["package", context.packageBook]
    ].filter(([, value]) => value).map(([field, value]) => ({ field, value }))
  };
  prepared.sourceCache.set(item, result);
  return result;
}
