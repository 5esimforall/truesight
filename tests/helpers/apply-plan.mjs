// Test-only publisher: core planning must never write the caller's table.
import assert from 'node:assert/strict';
import {planAliases} from '../../module/scripts/names/resolver.mjs';
export function applyPlan(pairs, lookupNames, table, groups) {
  const before = {...table};
  const {aliases, report} = planAliases({pairs, lookupNames, existingAliases: table, groups});
  assert.deepEqual({...table}, before);
  for (const [name, target] of aliases) table[name] = target;
  return {...report, registered: aliases.size};
}
