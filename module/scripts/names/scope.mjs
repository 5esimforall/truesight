// @ts-check
/** @typedef {import('../../../types/api-v1.d.ts').RulesEdition} RulesEdition */
/** @typedef {import('../../../types/api-v1.d.ts').AliasScope} AliasScope */
/** @typedef {import('../../../types/api-v1.d.ts').ScopeEvidence} ScopeEvidence */

/**
 * @param {unknown} rules
 * @returns {RulesEdition | null}
 */
export function rulesEdition(rules) {
  if (rules === 'legacy' || rules === '2014') return '2014';
  if (rules === 'modern' || rules === '2024') return '2024';
  return null;
}

// Missing context remains uncertain evidence, not an invented edition/type.
/**
 * @param {ScopeEvidence} evidence
 * @param {AliasScope | null | undefined} scope
 * @returns {boolean}
 */
export function inScope(evidence, scope) {
  if (!scope) return true;
  const rules = rulesEdition(evidence.rules);
  if (rules && scope.rules && rules !== scope.rules) return false;
  if (evidence.type && scope.types && !scope.types.includes(evidence.type)) return false;
  if (scope.category && evidence.category && evidence.category !== scope.category) return false;
  if (scope.excludeCategories?.length && evidence.category && scope.excludeCategories.includes(evidence.category)) return false;
  if (scope.actorType && evidence.actorType && evidence.actorType !== scope.actorType) return false;
  return true;
}
