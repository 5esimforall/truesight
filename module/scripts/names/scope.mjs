export function rulesEdition(rules) {
  if (rules === 'legacy' || rules === '2014') return '2014';
  if (rules === 'modern' || rules === '2024') return '2024';
  return null;
}

// Missing context remains uncertain evidence, not an invented edition/type.
export function inScope(evidence, scope) {
  if (!scope) return true;
  const rules = rulesEdition(evidence.rules);
  return (!rules || rules === scope.rules) && (!evidence.type || scope.types.includes(evidence.type));
}
