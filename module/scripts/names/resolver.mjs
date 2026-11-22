import {inScope} from './scope.mjs';
import {canonicalUuid} from '../catalog/identity.mjs';
import {validIdentifier} from '../catalog/item-identity.mjs';

const han = /\p{Script=Han}/u;
const english = name => typeof name === 'string' && /[A-Za-z]/.test(name) && !han.test(name);
const fold = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const slug = value => fold(value).replace(/’/g, "'").replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Split only a complete English side, never search for known spell names as substrings.
function bilingualParts(name) {
  if (!han.test(name)) return null;
  const normalized = name.normalize('NFKC').trim();
  const parts = normalized.match(/^([^A-Za-z]+?)\s*\(([^()]+)\)$/u)
    ?? normalized.match(/^([^A-Za-z]+?)\s+([A-Za-z].*)$/u)
    ?? normalized.match(/^([^A-Za-z]*\p{Script=Han})([A-Za-z].*)$/u);
  if (parts && han.test(parts[1]) && english(parts[2])) return {chinese: parts[1].trim(), english: parts[2]};
  const reversed = normalized.match(/^([^()]+?)\s*\(([^A-Za-z]+)\)$/u)
    ?? normalized.match(/^(.+?)\s+([^A-Za-z]+)$/u)
    ?? normalized.match(/^(.+?[A-Za-z])(\p{Script=Han}[^A-Za-z]*)$/u);
  return reversed && english(reversed[1]) && han.test(reversed[2])
    ? {chinese: reversed[2].trim(), english: reversed[1]} : null;
}

function record(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}
function merge(into, from) {
  for (const [name, sources] of from ?? []) for (const source of sources) record(into, name, source);
}
function describe(candidates) {
  return Array.from(candidates, ([englishName, sources]) => ({englishName, sources: [...sources].sort()}))
    .sort((a, b) => String(a.englishName).localeCompare(String(b.englishName)));
}

export function planAliases({pairs, lookupNames, existingAliases = {}, groups = new Map(), scope = null}) {
  const aliases = new Map();
  pairs = pairs.filter(pair => inScope(pair, scope));
  groups = new Map([...groups].map(([key, members]) => [key, members.filter(member => inScope(member, scope))])
    .filter(([, members]) => members.length));
  const spellings = new Map();
  for (const name of [...lookupNames, ...Object.keys(existingAliases)]) {
    if (english(name)) record(spellings, fold(name), name);
  }
  // Resolve against the provider snapshot, before publishing any aliases.
  function* lookupTargets(name) {
    if (!english(name)) return;
    for (const spelling of spellings.get(fold(name)) ?? [name]) {
      const target = Object.hasOwn(existingAliases, spelling) ? existingAliases[spelling] : spelling;
      yield typeof target === 'string' ? target : null;
    }
  }
  function recordOriginal(candidates, name, source) {
    for (const target of lookupTargets(name)) record(candidates, target, source);
  }
  function recordEmbedded(candidates, name, source) {
    for (const target of lookupTargets(name)) {
      if (lookupNames.has(target)) record(candidates, target, source);
    }
  }
  const evidence = new Map(), identifiers = new Map(), groupTargets = new Map(), disambiguationCandidates = new Map();
  function forName(displayName) {
    if (!evidence.has(displayName)) evidence.set(displayName, new Map());
    return evidence.get(displayName);
  }
  for (const {translatedName, englishName, source, identifier} of pairs) {
    const candidates = forName(translatedName);
    if (!englishName) { record(candidates, null, source); continue; }
    recordOriginal(candidates, englishName, source);
    const id = validIdentifier(identifier);
    if (id) for (const target of lookupTargets(englishName)) if (typeof target === 'string') record(identifiers, target, id);
    const parts = bilingualParts(translatedName);
    if (!parts) recordOriginal(forName(translatedName + ' ' + englishName), englishName, source);
    else {
      recordEmbedded(candidates, parts.english, source);
      if (fold(parts.english) === fold(englishName)) recordOriginal(forName(parts.chinese), englishName, source);
    }
  }

  // Collect from independent sources first. One cluster must never use another
  // cluster's guesses as input. Names remain exact keys in CPR's global table.
  const plans = [];
  for (const [group, members] of groups) {
    const candidates = new Map(), directCandidates = new Map();
    const displays = new Set();
    for (const {displayName, originalName, source, lookupNames: memberLookupNames, identifier} of members) {
      const memberDirect = new Map();
      if (han.test(displayName)) displays.add(displayName);
      merge(candidates, evidence.get(displayName));
      const parts = bilingualParts(displayName);
      if (parts) {
        const embedded = new Map();
        recordEmbedded(embedded, parts.english, source);
        merge(candidates, embedded);
        merge(memberDirect, embedded);
        const translated = evidence.get(parts.chinese);
        // A complete bilingual name may disambiguate a known translation,
        // but it must not contradict every known English original.
        if (embedded.size && translated && [...translated.keys()].some(name => name !== null)
          && ![...embedded.keys()].some(name => name !== null && translated.has(name))) {
          merge(candidates, translated);
          merge(memberDirect, translated);
        }
      } else {
        recordOriginal(candidates, displayName, source);
        recordOriginal(memberDirect, displayName, source);
      }
      recordOriginal(candidates, originalName, source);
      recordOriginal(memberDirect, originalName, source);
      for (const name of memberLookupNames ?? []) {
        recordOriginal(candidates, name, source);
        recordOriginal(memberDirect, name, source);
      }
      if (Object.hasOwn(existingAliases, displayName)) {
        const target = existingAliases[displayName];
        record(candidates, typeof target === 'string' ? target : null, 'existingAliases#' + displayName);
        record(memberDirect, typeof target === 'string' ? target : null, 'existingAliases#' + displayName);
      }
      merge(directCandidates, memberDirect);
      const id = validIdentifier(identifier);
      if (id) for (const target of memberDirect.keys()) if (typeof target === 'string') record(identifiers, target, id);
    }
    if (displays.size && directCandidates.size === 1 && !directCandidates.has(null)) {
      const [target] = directCandidates.keys();
      if (typeof target === 'string' && lookupNames.has(target)) {
        const displaySet = new Set(displays);
        for (const member of members) {
          const uuid = canonicalUuid({uuid: member.source, documentType: 'Item'});
          if (uuid) groupTargets.set(uuid, {target, displays: displaySet});
        }
      }
    }
    plans.push({group, members, candidates, displays});
  }
  // Every plan resolves one output scope. All groups sharing an exact key
  // within that scope must agree before either can publish it.
  const byDisplay = new Map();
  for (const plan of plans) for (const name of plan.displays) record(byDisplay, name, plan);
  const visited = new Set(), blocked = new Set();
  const report = {status: 'ready', planned: 0, existing: 0, unsupported: 0, conflicts: [], clusterErrors: []};
  for (const seed of plans) {
    if (visited.has(seed)) continue;
    const component = [seed], combined = new Map(), displays = new Set();
    visited.add(seed);
    for (const plan of component) {
      merge(combined, plan.candidates);
      for (const name of plan.displays) {
        if (displays.has(name)) continue;
        displays.add(name);
        for (const shared of byDisplay.get(name)) {
          if (!visited.has(shared)) { visited.add(shared); component.push(shared); }
        }
      }
    }
    if (combined.size > 1 || combined.has(null)) {
      for (const name of displays) {
        blocked.add(name);
        for (const candidate of combined.keys()) record(disambiguationCandidates, name, candidate);
      }
      const originals = [...combined.keys()].filter(name => name !== null);
      const reason = originals.filter(name => lookupNames.has(name)).length > 1 ? 'multiple-lookup-targets'
        : originals.length > 1 ? 'conflicting-originals' : 'unknown-original';
      report.clusterErrors.push({reason, groups: component.map(p => p.group).sort(),
        members: component.flatMap(p => p.members).sort((a, b) => a.source.localeCompare(b.source)),
        candidates: describe(combined)});
      continue;
    }
    for (const plan of component) for (const name of plan.displays) merge(forName(name), plan.candidates);
  }
  if (report.clusterErrors.length) report.status = 'cluster-conflict';
  for (const [displayName, candidates] of evidence) {
    if (candidates.size > 1 || candidates.has(null)) {
      for (const candidate of candidates.keys()) record(disambiguationCandidates, displayName, candidate);
      report.conflicts.push({displayName, reason: candidates.has(null) ? 'unknown-original' : 'ambiguous-name',
        candidates: describe(candidates)});
      continue;
    }
    if (blocked.has(displayName)) continue;
    if (displayName in existingAliases || lookupNames.has(displayName)) { report.existing++; continue; }
    const [lookupName] = candidates.keys();
    if (!lookupNames.has(lookupName)) { report.unsupported++; continue; }
    aliases.set(displayName, lookupName);
    report.planned++;
  }
  return {
    aliases,
    report: {...report, scope},
    disambiguation: {
      identifiers,
      groupTargets,
      candidates: disambiguationCandidates,
      lookupNames: new Set(lookupNames),
      existingAliases: Object.assign(Object.create(null), existingAliases)
    }
  };
}

export function resolveItemAlias(plan, item) {
  if (!plan || !item || typeof item.name !== 'string') return null;
  if (plan.aliases?.has(item.name)) return plan.aliases.get(item.name);
  const info = plan.disambiguation;
  if (!info || !han.test(item.name)) return null;
  if (Object.hasOwn(info.existingAliases, item.name) || info.lookupNames.has(item.name)) return null;
  const eligible = target => typeof target === 'string' && info.lookupNames.has(target) ? target : null;

  for (const raw of [item.uuid, item._stats?.compendiumSource]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const match = info.groupTargets.get(canonicalUuid({uuid: raw, documentType: 'Item'}));
    if (match?.displays.has(item.name)) return eligible(match.target);
  }

  const parts = bilingualParts(item.name);
  const candidates = info.candidates.get(item.name) ?? (parts ? info.candidates.get(parts.chinese) : null);
  const known = [...(candidates ?? [])].filter(name => typeof name === 'string');
  if (!known.length) return null;

  const original = [item.flags?.babele?.originalName, item.originalName].find(english);
  if (original) {
    const matches = known.filter(name => fold(name) === fold(original)
      || Object.entries(info.existingAliases).some(([alias, target]) => target === name && fold(alias) === fold(original)));
    return matches.length === 1 ? eligible(matches[0]) : null;
  }

  const id = validIdentifier(item.system?.identifier);
  if (id) {
    const matches = known.filter(name => slug(name) === id || info.identifiers.get(name)?.has(id));
    if (matches.length === 1) return eligible(matches[0]);
    if (matches.length > 1) return null;
  }

  if (parts) {
    const matches = known.filter(name => fold(name) === fold(parts.english));
    if (matches.length === 1) return eligible(matches[0]);
  }

  return null;
}
