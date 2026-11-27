// @ts-check
/** @typedef {import('../../../types/api-v1.d.ts').AliasCandidateDescription} AliasCandidateDescription */
/** @typedef {import('../../../types/api-v1.d.ts').AliasClusterError} AliasClusterError */
/** @typedef {import('../../../types/api-v1.d.ts').AliasConflictEntry} AliasConflictEntry */
/** @typedef {import('../../../types/api-v1.d.ts').AliasGroupTarget} AliasGroupTarget */
/** @typedef {import('../../../types/api-v1.d.ts').AliasLookupItem} AliasLookupItem */
/** @typedef {import('../../../types/api-v1.d.ts').AliasPlan} AliasPlan */
/** @typedef {import('../../../types/api-v1.d.ts').AliasPlanReport} AliasPlanReport */
/** @typedef {import('../../../types/api-v1.d.ts').NameEvidenceEntry} NameEvidenceEntry */
/** @typedef {import('../../../types/api-v1.d.ts').PlanAliasesInput} PlanAliasesInput */
import {inScope} from './scope.mjs';
import {canonicalUuid} from '../catalog/identity.mjs';
import {validIdentifier} from '../catalog/item-identity.mjs';

const ascii = /[A-Za-z]/;
const han = /\p{Script=Han}/u;
/** @param {unknown} name @returns {name is string} */
const english = name => typeof name === 'string' && ascii.test(name) && !han.test(name);
/** @param {string} name */
const fold = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
/** @param {string} value */
const slug = value => fold(value).replace(/’/g, "'").replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Split only a complete English side, never search for known spell names as substrings.
/** @param {string} name */
function bilingualParts(name) {
  if (!han.test(name)) return null;
  const normalized = name.normalize('NFKC').trim();
  if (!ascii.test(normalized)) return null;
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

/**
 * @template K, V
 * @param {Map<K, Set<V>>} map
 * @param {K} key
 * @param {V} value
 */
function record(map, key, value) {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(value);
}
/**
 * @template K, V
 * @param {Map<K, Set<V>>} into
 * @param {Map<K, Set<V>> | null | undefined} from
 */
function merge(into, from) {
  for (const [name, sources] of from ?? []) for (const source of sources) record(into, name, source);
}
/**
 * @param {Map<string | null, Set<string>>} candidates
 * @returns {AliasCandidateDescription[]}
 */
function describe(candidates) {
  return Array.from(candidates, ([englishName, sources]) => ({englishName, sources: [...sources].sort()}))
    .sort((a, b) => String(a.englishName).localeCompare(String(b.englishName)));
}

/**
 * @param {PlanAliasesInput} input
 * @returns {AliasPlan}
 */
export function planAliases({pairs, lookupNames, existingAliases = {}, groups = new Map(), scope = null}) {
  /** @type {Map<string, string>} */
  const aliases = new Map();
  /** @type {Map<string, Set<string>>} */
  const spellings = new Map();
  /** @type {Map<string, string>} */
  const foldCache = new Map();
  /** @param {string} name */
  const folded = name => {
    let cached = foldCache.get(name);
    if (cached === undefined) {
      cached = fold(name);
      foldCache.set(name, cached);
    }
    return cached;
  };
  for (const name of lookupNames) if (english(name)) record(spellings, folded(name), name);
  for (const name of Object.keys(existingAliases)) if (english(name)) record(spellings, folded(name), name);
  /** @type {Map<string, (string | null)[]>} */
  const targetsByFold = new Map();
  /** @type {Map<string, string[]>} */
  const embeddedByFold = new Map();
  for (const [foldedName, set] of spellings) {
    /** @type {(string | null)[]} */
    const all = [];
    /** @type {string[]} */
    const matched = [];
    for (const spelling of set) {
      const raw = Object.hasOwn(existingAliases, spelling) ? existingAliases[spelling] : spelling;
      const target = typeof raw === 'string' ? raw : null;
      all.push(target);
      if (target !== null && lookupNames.has(target)) matched.push(target);
    }
    targetsByFold.set(foldedName, all);
    if (matched.length) embeddedByFold.set(foldedName, matched);
  }
  // Resolve against the provider snapshot, before publishing any aliases.
  /** @param {unknown} name @returns {(string | null)[] | null} */
  function targetsFor(name) {
    if (!english(name)) return null;
    const hit = targetsByFold.get(folded(name));
    if (hit) return hit;
    const raw = Object.hasOwn(existingAliases, name) ? existingAliases[name] : name;
    return [typeof raw === 'string' ? raw : null];
  }
  /**
   * @param {Map<string | null, Set<string>>} candidates
   * @param {(string | null)[] | null} targets
   * @param {string} source
   */
  function recordTargets(candidates, targets, source) {
    if (!targets) return;
    for (const target of targets) record(candidates, target, source);
  }
  /**
   * @param {Map<string | null, Set<string>>} candidates
   * @param {unknown} name
   * @param {string} source
   */
  function recordEmbedded(candidates, name, source) {
    if (!english(name)) return;
    const matched = embeddedByFold.get(folded(name));
    if (matched) for (const target of matched) record(candidates, target, source);
  }
  /** @type {Map<string, Map<string | null, Set<string>>>} */
  const evidence = new Map();
  /** @type {Map<string, Set<string>>} */
  const identifiers = new Map();
  /** @type {Map<string, AliasGroupTarget>} */
  const groupTargets = new Map();
  /** @type {Map<string, Set<string | null>>} */
  const disambiguationCandidates = new Map();
  /** @param {string} displayName */
  function forName(displayName) {
    let entry = evidence.get(displayName);
    if (!entry) { entry = new Map(); evidence.set(displayName, entry); }
    return entry;
  }
  for (const pair of pairs) {
    if (scope && !inScope(pair, scope)) continue;
    const {translatedName, englishName, source, identifier} = pair;
    const candidates = forName(translatedName);
    if (!englishName) { record(candidates, null, source); continue; }
    const targets = targetsFor(englishName);
    recordTargets(candidates, targets, source);
    const id = validIdentifier(identifier);
    if (id && targets) for (const target of targets) if (typeof target === 'string') record(identifiers, target, id);
    const parts = bilingualParts(translatedName);
    if (!parts) recordTargets(forName(translatedName + ' ' + englishName), targets, source);
    else {
      recordEmbedded(candidates, parts.english, source);
      if (folded(parts.english) === folded(englishName)) recordTargets(forName(parts.chinese), targets, source);
    }
  }

  // Collect from independent sources first. One cluster must never use another
  // cluster's guesses as input. Names remain exact keys in CPR's global table.
  /** @typedef {{ group: string, members: NameEvidenceEntry[], candidates: Map<string | null, Set<string>>, displays: Set<string> }} GroupPlan */
  /** @type {GroupPlan[]} */
  const plans = [];
  for (const [group, rawMembers] of groups) {
    const members = scope ? rawMembers.filter(member => inScope(member, scope)) : [...rawMembers];
    if (!members.length) continue;
    /** @type {Map<string | null, Set<string>>} */
    const candidates = new Map();
    /** @type {Map<string | null, Set<string>> | null} */
    let directCandidates = null;
    /** @type {Set<string>} */
    const displays = new Set();
    /**
     * @param {Map<string | null, Set<string>>} memberDirect
     * @param {unknown} name
     * @param {string} source
     */
    const recordBoth = (memberDirect, name, source) => {
      const targets = targetsFor(name);
      if (!targets) return;
      recordTargets(candidates, targets, source);
      recordTargets(memberDirect, targets, source);
    };
    for (const {displayName, originalName, source, lookupNames: memberLookupNames, identifier} of members) {
      /** @type {Map<string | null, Set<string>>} */
      const memberDirect = new Map();
      if (han.test(displayName)) displays.add(displayName);
      merge(candidates, evidence.get(displayName));
      const parts = bilingualParts(displayName);
      if (parts) {
        /** @type {Map<string | null, Set<string>>} */
        const embedded = new Map();
        recordEmbedded(embedded, parts.english, source);
        if (embedded.size) {
          merge(candidates, embedded);
          merge(memberDirect, embedded);
          const translated = evidence.get(parts.chinese);
          // A complete bilingual name may disambiguate a known translation,
          // but it must not contradict every known English original.
          if (translated) {
            let hasTranslatedNonNull = false, hasOverlap = false;
            for (const name of translated.keys()) {
              if (name !== null) {
                hasTranslatedNonNull = true;
                if (embedded.has(name)) { hasOverlap = true; break; }
              }
            }
            if (hasTranslatedNonNull && !hasOverlap) {
              merge(candidates, translated);
              merge(memberDirect, translated);
            }
          }
        }
      } else {
        recordBoth(memberDirect, displayName, source);
      }
      recordBoth(memberDirect, originalName, source);
      for (const name of memberLookupNames ?? []) recordBoth(memberDirect, name, source);
      if (Object.hasOwn(existingAliases, displayName)) {
        const target = existingAliases[displayName];
        const normalizedTarget = typeof target === 'string' ? target : null;
        const aliasSource = 'existingAliases#' + displayName;
        record(candidates, normalizedTarget, aliasSource);
        record(memberDirect, normalizedTarget, aliasSource);
      }
      if (members.length === 1) directCandidates = memberDirect;
      else {
        directCandidates ??= new Map();
        merge(directCandidates, memberDirect);
      }
      const id = validIdentifier(identifier);
      if (id) for (const target of memberDirect.keys()) if (typeof target === 'string') record(identifiers, target, id);
    }
    if (displays.size && directCandidates?.size === 1 && !directCandidates.has(null)) {
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
  /** @type {Map<string, Set<GroupPlan>>} */
  const byDisplay = new Map();
  for (const plan of plans) for (const name of plan.displays) record(byDisplay, name, plan);
  /** @type {Set<GroupPlan>} */
  const visited = new Set();
  /** @type {Set<string>} */
  const blocked = new Set();
  /** @type {Omit<AliasPlanReport, 'scope'>} */
  const report = {status: 'ready', planned: 0, existing: 0, unsupported: 0, conflicts: [], clusterErrors: []};
  /**
   * @param {GroupPlan[]} component
   * @param {Map<string | null, Set<string>>} combined
   * @param {Set<string>} displays
   */
  function finishComponent(component, combined, displays) {
    if (combined.size > 1 || combined.has(null)) {
      for (const name of displays) {
        blocked.add(name);
        for (const candidate of combined.keys()) record(disambiguationCandidates, name, candidate);
      }
      const originals = [...combined.keys()].filter(/** @returns {name is string} */ name => name !== null);
      /** @type {AliasClusterError['reason']} */
      const reason = originals.filter(name => lookupNames.has(name)).length > 1 ? 'multiple-lookup-targets'
        : originals.length > 1 ? 'conflicting-originals' : 'unknown-original';
      report.clusterErrors.push({
        reason,
        groups: component.length === 1 ? [component[0].group] : component.map(p => p.group).sort(),
        members: (component.length === 1 ? [...component[0].members] : component.flatMap(p => p.members))
          .sort((a, b) => a.source.localeCompare(b.source)),
        candidates: describe(combined)
      });
      return;
    }
    if (component.length === 1) {
      for (const name of displays) merge(forName(name), combined);
      return;
    }
    for (const plan of component) for (const name of plan.displays) merge(forName(name), plan.candidates);
  }
  for (const seed of plans) {
    if (visited.has(seed)) continue;
    visited.add(seed);
    let isolated = true;
    for (const name of seed.displays) {
      if ((byDisplay.get(name)?.size ?? 0) > 1) { isolated = false; break; }
    }
    if (isolated) {
      finishComponent([seed], seed.candidates, seed.displays);
      continue;
    }
    const component = [seed];
    /** @type {Map<string | null, Set<string>>} */
    const combined = new Map();
    /** @type {Set<string>} */
    const displays = new Set();
    for (const plan of component) {
      merge(combined, plan.candidates);
      for (const name of plan.displays) {
        if (displays.has(name)) continue;
        displays.add(name);
        for (const shared of byDisplay.get(name) ?? []) {
          if (!visited.has(shared)) { visited.add(shared); component.push(shared); }
        }
      }
    }
    finishComponent(component, combined, displays);
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
    if (typeof lookupName !== 'string' || !lookupNames.has(lookupName)) { report.unsupported++; continue; }
    aliases.set(displayName, lookupName);
    report.planned++;
  }
  return {
    aliases,
    report: {...report, scope: scope ?? null},
    disambiguation: {
      identifiers,
      groupTargets,
      candidates: disambiguationCandidates,
      lookupNames: new Set(lookupNames),
      existingAliases: Object.assign(Object.create(null), existingAliases)
    }
  };
}

/**
 * @param {AliasPlan | null | undefined} plan
 * @param {AliasLookupItem | null | undefined} item
 * @returns {string | null}
 */
export function resolveItemAlias(plan, item) {
  if (!plan || !item || typeof item.name !== 'string') return null;
  if (plan.aliases?.has(item.name)) return plan.aliases.get(item.name) ?? null;
  const info = plan.disambiguation;
  if (!info || !han.test(item.name)) return null;
  if (Object.hasOwn(info.existingAliases, item.name) || info.lookupNames.has(item.name)) return null;
  /** @param {string | null | undefined} target */
  const eligible = target => typeof target === 'string' && info.lookupNames.has(target) ? target : null;

  for (const raw of [item.uuid, item._stats?.compendiumSource]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const match = info.groupTargets.get(canonicalUuid({uuid: raw, documentType: 'Item'}));
    if (match?.displays.has(item.name)) return eligible(match.target);
  }

  const parts = bilingualParts(item.name);
  const candidates = info.candidates.get(item.name) ?? (parts ? info.candidates.get(parts.chinese) : null);
  const known = [...(candidates ?? [])].filter(/** @returns {name is string} */ name => typeof name === 'string');
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
