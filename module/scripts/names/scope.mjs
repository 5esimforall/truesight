export function rulesEdition(rules) {
  if (rules === 'legacy' || rules === '2014') return '2014';
  if (rules === 'modern' || rules === '2024') return '2024';
  return null;
}

// Missing context remains uncertain evidence, not an invented edition/type.
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
