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
test('non-character actors and their non-class embedded items do not emit names', () => {
  const monster = {
    id: 'm1', uuid: 'Actor.m1', type: 'npc',
    items: new Map([
      ['f1', {id: 'f1', name: '狂暴', type: 'feat'}],
      ['w1', {id: 'w1', name: '啃咬', type: 'weapon'}],
      ['s1', {id: 's1', name: '火球术', type: 'spell'}]
    ])
  };
  assert.deepEqual(classify('createActor', undefined, monster), ['identity']);
  assert.deepEqual(classify('deleteActor', undefined, monster), ['identity']);
  assert.deepEqual(classify('updateActor', {items: []}, monster), ['identity']);
  assert.deepEqual(classify('updateActor', {folder: 'f1'}, monster), []);
  assert.deepEqual(classify('updateActor', {type: 'character'}, monster), ['identity', 'names']);

  const vehicle = {id: 'v1', uuid: 'Actor.v1', type: 'vehicle', items: new Map([['w1', {name: '攻城锤', type: 'weapon'}]])};
  const group = {id: 'g1', uuid: 'Actor.g1', type: 'group', items: new Map([['w1', {name: '行囊', type: 'backpack'}]])};
  assert.deepEqual(classify('createActor', undefined, vehicle), ['identity']);
  assert.deepEqual(classify('deleteActor', undefined, group), ['identity']);

  const classedNpc = {
    id: 'm2', uuid: 'Actor.m2', type: 'npc',
    items: new Map([['c1', {name: 'Fighter', type: 'class'}], ['s1', {name: '火球术', type: 'spell'}]])
  };
  assert.deepEqual(classify('createActor', undefined, classedNpc), ['identity', 'names']);

  const npcTrait = {id: 'f1', uuid: 'Actor.m1.Item.f1', name: '狂暴', type: 'feat', parent: monster};
  const npcSpell = {id: 's1', uuid: 'Actor.m1.Item.s1', name: '火球术', type: 'spell', parent: monster};
  for (const item of [npcTrait, npcSpell]) {
    assert.deepEqual(classify('createItem', undefined, item), []);
    assert.deepEqual(classify('deleteItem', undefined, item), []);
    assert.deepEqual(classify('updateItem', {name: '新名称'}, item), []);
    assert.deepEqual(classify('createItem', undefined, item, {embeddedIndexing: true}), ['identity']);
    assert.deepEqual(classify('deleteItem', undefined, item, {embeddedIndexing: true}), ['identity']);
    assert.deepEqual(classify('updateItem', {name: '新名称'}, item, {embeddedIndexing: true}), ['display']);
  }

  const classOnNpc = {id: 'c1', uuid: 'Actor.m1.Item.c1', name: 'Fighter', type: 'class', parent: monster};
  assert.deepEqual(classify('createItem', undefined, classOnNpc), ['names']);
  assert.deepEqual(classify('deleteItem', undefined, classOnNpc), ['names']);
  assert.deepEqual(classify('createItem', undefined, classOnNpc, {embeddedIndexing: true}), ['identity', 'names']);
  assert.deepEqual(classify('deleteItem', undefined, classOnNpc, {embeddedIndexing: true}), ['identity', 'names']);
});
test('non-item world documents and world sidebar folders never emit names or folder access', () => {
  for (const type of ['Scene', 'JournalEntry', 'Macro', 'RollTable', 'Playlist', 'Cards']) {
    const doc = {id: 'd1', uuid: `${type}.d1`, name: '中文文档'};
    assert.deepEqual(classify(`create${type}`, undefined, doc), ['identity']);
    assert.deepEqual(classify(`delete${type}`, undefined, doc), ['identity']);
    assert.deepEqual(classify(`update${type}`, {name: '改名'}, doc), ['display']);
    assert.deepEqual(classify(`update${type}`, {folder: 'folder1'}, doc), []);
    assert.equal(classify(`update${type}`, undefined, doc).includes('names'), false);
  }
  const worldItem = {id: 'i1', uuid: 'Item.i1', type: 'spell', name: '火球术'};
  assert.deepEqual(classify('updateItem', {folder: 'f1'}, worldItem), []);
  const packItem = {id: 'i2', uuid: 'Compendium.pack.items.Item.i2', pack: 'pack.items', type: 'spell', name: '火球术'};
  assert.deepEqual(classify('updateItem', {folder: 'f1'}, packItem), ['names']);

  for (const folderType of ['Actor', 'Item', 'Scene', 'JournalEntry', 'Macro', 'RollTable', 'Playlist', 'Cards']) {
    const worldFolder = {id: 'f1', type: folderType, name: '世界文件夹'};
    assert.deepEqual(classify('createFolder', undefined, worldFolder), []);
    assert.deepEqual(classify('updateFolder', {name: '改名'}, worldFolder), []);
    assert.deepEqual(classify('deleteFolder', undefined, worldFolder), []);
  }
  const packItemFolder = {id: 'f2', type: 'Item', pack: 'pack.items', name: 'Items'};
  assert.deepEqual(classify('createFolder', undefined, packItemFolder), ['names']);
  assert.deepEqual(classify('updateFolder', {name: 'Items2'}, packItemFolder), ['names']);
  assert.deepEqual(classify('deleteFolder', undefined, packItemFolder), ['names']);
  const packActorFolder = {id: 'f3', type: 'Actor', pack: 'pack.monsters', name: 'Monsters'};
  assert.deepEqual(classify('createFolder', undefined, packActorFolder), []);
  const compendiumFolder = {id: 'f4', type: 'Compendium', name: 'Compendiums'};
  assert.deepEqual(classify('createFolder', undefined, compendiumFolder), ['names', 'access']);
  assert.deepEqual(classify('deleteFolder', undefined, compendiumFolder), ['names', 'access']);
});
