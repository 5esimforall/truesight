import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChange, affects, isLocalDocumentChange} from '../module/scripts/changes.mjs';

const classify = (event, delta, doc = {}) => classifyChange(event, doc, delta, {userId: 'me'});
test('unrelated actor, item, user and preference updates leave evidence alone', () => {
  for (const delta of [{'system.attributes.hp.value': 1}, {system: {resources: {legact: {value: 0}}}}, {system: {uses: {spent: 2}}}, {'flags.ui.window': 1}]) {
    assert.deepEqual(classify('updateActor', delta), []);
    assert.deepEqual(classify('updateItem', delta), []);
  }
  assert.deepEqual(classify('updateUser', {active: false}, {id:'me'}), []);
  assert.deepEqual(classify('updateUser', {role: 1}, {id:'someone-else'}), []);
  for (const key of ['slow-insert.grouping', 'truesight.review-world-user', 'quick-insert.searchDensity', 'chris-premades.someWindowPreference']) assert.deepEqual(classify('updateSetting', {value: 1}, {key}), []);
});
test('nested, flat, parent replacement and deletion evidence updates are classified', () => {
  for (const delta of [{'system.identifier': 'new'}, {system: {school: 'evo'}}, {'system.-=source': null}, {system:null}, {'-=system':null}]) assert.ok(classify('updateItem',delta).includes('identity'));
  for (const delta of [{name:'New'}, {'flags.babele.-=originalName':null}, {flags:{'chris-premades':{info:{identifier:'new'}}}}]) assert.ok(classify('updateItem',delta).includes('names'));
  assert.deepEqual(classify('updateItem', {img: 'new.webp'}), ['display']);
  assert.ok(classify('updateItem', {ownership:{default:0}}).includes('access'));
  assert.deepEqual(classify('updateUser', {role:1}, {id:'me'}), ['access']);
  assert.deepEqual(classify('updateSetting', {value:true}, {key:'quick-insert.gmOnly'}), ['access']);
  assert.deepEqual(classify('updateSetting', {value:true}, {key:'chris-premades.thirdParty'}), ['names']);
  assert.ok(classify('updateActor', {items:[]}).includes('identity'));
  assert.ok(classify('updateItem', undefined).includes('identity'));
  assert.deepEqual(classify('createItem', undefined, {id: 'item1'}), ['identity', 'names']);
  assert.deepEqual(classify('deleteItem', undefined, {id: 'item1'}), ['identity', 'names']);
  assert.deepEqual(classify('createActor', undefined, {id: 'actor1'}), ['identity', 'names']);
  assert.deepEqual(classify('deleteActor', undefined, {id: 'actor1'}), ['identity', 'names']);
  assert.deepEqual(classify('createCompendium', undefined, {}), ['identity', 'names', 'access']);
  assert.deepEqual(classify('deleteCompendium', undefined, {}), ['identity', 'names', 'access']);
});
test('local document changes are distinguished from compendium and mock updates', () => {
  assert.equal(isLocalDocumentChange('createItem', {id: 'local1'}), true);
  assert.equal(isLocalDocumentChange('updateItem', {uuid: 'Actor.a1.Item.i1', parent: {id: 'a1'}}), true);
  assert.equal(isLocalDocumentChange('updateItem', {}), false);
  assert.equal(isLocalDocumentChange('updateItem', {id: 'x', pack: 'dnd5e.spells'}), false);
  assert.equal(isLocalDocumentChange('updateItem', {id: 'x', uuid: 'Compendium.dnd5e.spells.Item.x'}), false);
  assert.equal(isLocalDocumentChange('updateItem', {id: 'x', parent: {pack: 'dnd5e.monsters'}}), false);
  assert.equal(isLocalDocumentChange('updateCompendium', {id: 'dnd5e.spells'}), false);
});
test('domain filters reject untagged notifications and ignore unrelated classified changes', () => {
  assert.throws(()=>affects(undefined,['names']), /domain-tagged/);
  assert.throws(()=>affects({},['names']), /domain-tagged/);
  assert.equal(affects({changes:['display']},['names']),false);
  assert.equal(affects({changes:['names']},['names']),true);
});
