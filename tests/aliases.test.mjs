import test from 'node:test';
import assert from 'node:assert/strict';
import { readNamePairs } from '../module/scripts/names/translations.mjs';
import { applyPlan } from './helpers/apply-plan.mjs';

const misty = 'Misty Step', zh = '迷踪步';
const names = new Set([misty, 'Cunning Action', 'Prestidigitation']);
const titles = entries => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v?.name]));
function pairs(pack, entries) {
  return readNamePairs(pack, titles(entries), null, names);
}

test('registers exact Chinese and bilingual spellings without changing English or parsing arbitrary names', () => {
  const table = {};
  const report = applyPlan([...pairs('srd', {[misty]: {name: zh}}),
    ...pairs('phb', {[misty]: {name: zh + ' ' + misty}, 'Unknown Spell': {name: '未知法术'}})], names, table);
  assert.deepEqual(table, {[zh]: misty, [zh + ' ' + misty]: misty});
  assert.equal(report.registered, 2);
  assert.equal(report.unsupported, 2);
  for (const key of [misty, '迷踪', '迷踪步 Mist', '迷踪步  Misty Step', '未知法术']) assert.ok(!(key in table));
});

test('conflict detection precedes provider eligibility; bilingual forms remain independent', () => {
  const rows = [...pairs('first', {Step: {name: zh}, [misty]: {name: zh}}), ...pairs('second', {[misty]: {name: zh}})];
  for (const order of [rows, rows.toReversed()]) {
    const table = {};
    const report = applyPlan(order, names, table);
    assert.deepEqual(table, {[zh + ' ' + misty]: misty});
    const [conflict] = report.conflicts;
    assert.equal(conflict.displayName, zh);
    assert.equal(conflict.reason, 'ambiguous-name');
    assert.deepEqual(conflict.candidates.find(c => c.englishName === misty).sources.sort(),
      ['first#Misty Step', 'second#Misty Step']);
  }
});

test('preserves CPR, native pack aliases, and existing keys; matches a renamed English lookup', () => {
  const table = Object.assign(Object.create(null), {灵巧动作: 'House Rule', [misty]: 'Other Step'});
  const native = new Set([...names, 'Other Step', zh]);
  const rows = pairs('source', {[misty]: {name: zh}, 'Cunning Action': {name: '灵巧动作'}});
  const report = applyPlan(rows, native, table);
  assert.equal(report.existing, 2);
  assert.equal(table.灵巧动作, 'House Rule');
  assert.equal(table[zh], undefined);
  assert.equal(table[zh + ' ' + misty], 'Other Step');
  assert.equal(table['灵巧动作 Cunning Action'], 'Cunning Action');
  assert.equal(applyPlan(rows, native, table).registered, 0);
});

test('uses an ID only to look up the original; unknown IDs block ambiguous pure names', () => {
  const id = '0123456789abcdef';
  const dict = titles({[id]: {name: zh}, [misty]: {name: zh}, Prestidigitation: {name: '魔法伎俩'},
    'Invalid Record': {name: null}, 'English Only': {name: 'Other English'}, '__x': {}});
  const packIndex = new Map([[id, {name: zh, flags: {babele: {originalName: misty}}}]]);
  const read = index => readNamePairs('srd', dict, index, names);
  const ok = {};
  applyPlan(read(packIndex), names, ok);
  assert.equal(ok[zh], misty);
  assert.equal(ok['魔法伎俩'], 'Prestidigitation');
  const blocked = {};
  const r = applyPlan(read(null), names, blocked);
  assert.equal(r.conflicts[0].reason, 'unknown-original');
  assert.equal(blocked[zh], undefined);
  assert.equal(blocked[zh + ' ' + misty], misty);
  assert.ok(!Object.values(blocked).includes(id));
  assert.throws(() => readNamePairs('bad', [], null, names));
});
