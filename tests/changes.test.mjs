import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChange, affects, isLocalDocumentChange, isTokenDocument, isEmbeddedActorItem} from '../module/scripts/changes.mjs';

const classify = (event, delta, doc = {}, opts = {}) => classifyChange(event, doc, delta, {userId: 'me', ...opts});
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
test('non-indexed document types and synthetic token documents produce no changes', () => {
  for (const event of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect', 'createChatMessage', 'createCombatant', 'updateToken']) {
    assert.deepEqual(classify(event, undefined, {id: 'doc1'}), []);
    assert.equal(isLocalDocumentChange(event, {id: 'doc1'}), false);
  }
  const tokenActor = {id: 'a1', isToken: true, uuid: 'Scene.s1.Token.t1.Actor.a1'};
  const tokenItem = {id: 'i1', name: '狂暴', uuid: 'Scene.s1.Token.t1.Actor.a1.Item.i1', parent: tokenActor};
  assert.equal(isTokenDocument(tokenActor), true);
  assert.equal(isTokenDocument(tokenItem), true);
  assert.equal(isTokenDocument({id: 'a1', uuid: 'Actor.a1'}), false);
  assert.deepEqual(classify('createActor', undefined, tokenActor), []);
  assert.deepEqual(classify('createItem', undefined, tokenItem), []);
  assert.deepEqual(classify('updateItem', {name: '新狂暴'}, tokenItem), []);
});
test('embedded actor items and journal pages respect embeddedIndexing and Han-name evidence', () => {
  const page = {id: 'p1', uuid: 'JournalEntry.j1.JournalEntryPage.p1', parent: {id: 'j1'}};
  assert.deepEqual(classify('createJournalEntryPage', undefined, page), []);
  assert.deepEqual(classify('createJournalEntryPage', undefined, page, {embeddedIndexing: true}), ['identity']);
  const actor = {id: 'a1', documentName: 'Actor', items: new Map()};
  const englishItem = {id: 'i1', uuid: 'Actor.a1.Item.i1', name: 'Longsword', type: 'weapon', parent: actor};
  const hanItem = {id: 'i2', uuid: 'Actor.a1.Item.i2', name: '狂暴', type: 'feat', parent: actor};
  assert.equal(isEmbeddedActorItem('createItem', englishItem), true);
  assert.equal(isEmbeddedActorItem('createItem', {id: 'w1', uuid: 'Item.w1'}), false);
  assert.deepEqual(classify('createItem', undefined, englishItem), []);
  assert.deepEqual(classify('deleteItem', undefined, englishItem), []);
  assert.deepEqual(classify('updateItem', {'system.equipped': true}, hanItem), []);
  assert.deepEqual(classify('updateItem', {'system.identifier': 'longsword'}, englishItem), []);
  assert.deepEqual(classify('createItem', undefined, hanItem), ['names']);
  assert.deepEqual(classify('deleteItem', undefined, hanItem), ['names']);
  assert.deepEqual(classify('updateItem', {name: '狂暴'}, englishItem), ['names']);
  assert.deepEqual(classify('updateItem', {'system.identifier': 'rage'}, hanItem), ['names']);
  assert.deepEqual(classify('createItem', undefined, englishItem, {embeddedIndexing: true}), ['identity']);
  assert.deepEqual(classify('createItem', undefined, hanItem, {embeddedIndexing: true}), ['identity', 'names']);
});
test('blank or English-only world actors skip names while Han-item actors and owner items emit names', () => {
  assert.deepEqual(classify('createActor', undefined, {id: 'a1', items: new Map()}), ['identity']);
  assert.deepEqual(classify('deleteActor', undefined, {id: 'a1', items: [{name: 'Longsword'}]}), ['identity']);
  assert.deepEqual(classify('createActor', undefined, {id: 'a2', items: new Map([['i1', {name: '长剑'}]])}), ['identity', 'names']);
  assert.deepEqual(classify('createItem', undefined, {id: 'i1', uuid: 'Item.i1', type: 'weapon', name: 'Longsword'}), ['identity']);
  assert.deepEqual(classify('createItem', undefined, {id: 'c1', uuid: 'Item.c1', type: 'class', name: 'Fighter'}), ['identity', 'names']);
});
