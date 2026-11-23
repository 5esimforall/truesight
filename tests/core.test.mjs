import {FoundryCollection} from './helpers/foundry-collection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {core} from '../module/scripts/names/api.mjs';
import {BASE_ITEM_PACKS, readNamePairs} from '../module/scripts/names/translations.mjs';

const pair = (englishName, rules, type = 'feat') => ({translatedName: '同名', englishName,
  source: `${type}:${rules}#${englishName}`, type, rules});
const scope = (rules, type = 'feat') => ({rules, type, types: [type]});

test('one immutable corpus resolves independently against each provider catalog', () => {
  const pairs = Object.freeze([Object.freeze({translatedName: '不屈', englishName: 'Indomitable', source: 'PHB#Indomitable'})]);
  const existing = Object.freeze({});
  const cpr = core.planAliases({pairs, lookupNames: new Set(['Indomitable Might']), existingAliases: existing});
  const gps = core.planAliases({pairs, lookupNames: new Set(['Indomitable']), existingAliases: existing});
  assert.equal(cpr.aliases.size, 0);
  assert.equal(cpr.report.unsupported, 2);
  assert.equal(gps.aliases.get('不屈'), 'Indomitable');
  assert.equal(gps.aliases.get('不屈 Indomitable'), 'Indomitable');
  assert.deepEqual(existing, {});
});

test('scoped output separates types and editions; a global output still rejects a shared key', () => {
  const pairs = [pair('Old Feature', '2014'), pair('New Feature', '2024'), pair('New Spell', '2024', 'spell')];
  const lookupNames = new Set(pairs.map(p => p.englishName));
  assert.equal(core.planAliases({pairs, lookupNames}).aliases.has('同名'), false);
  for (const p of pairs) {
    const result = core.planAliases({pairs, lookupNames, scope: scope(p.rules, p.type)});
    assert.equal(result.aliases.get('同名'), p.englishName);
    assert.equal(result.report.conflicts.length, 0);
  }
  const unknown = {translatedName: '同名', englishName: 'Unknown Feature', source: 'unscoped'};
  assert.equal(core.planAliases({pairs: [...pairs, unknown], lookupNames, scope: scope('2024')}).aliases.has('同名'), false);
});

test('scoped group evidence never borrows another editions member; CPR may request global checks', () => {
  const groups = new Map([
    ['old', [{displayName: '旧能力', source: 'old', type: 'feat', rules: '2014', lookupNames: ['Old Feature']}]],
    ['new', [{displayName: '新能力', source: 'new', type: 'feat', rules: '2024', lookupNames: ['New Feature']}]]
  ]);
  const result = core.planAliases({pairs: [], lookupNames: new Set(['Old Feature', 'New Feature']), groups, scope: scope('2024')});
  assert.deepEqual([...result.aliases], [['新能力', 'New Feature']]);
});

test('translation rows keep known type and edition from IDs or Babele original names', () => {
  const index = new Map([
    ['old', {type: 'feat', name: '同名 Old Feature', flags: {babele: {originalName: 'Old Feature'}}, system: {source: {rules: '2014'}}}],
    ['new', {type: 'feat', name: '同名', flags: {babele: {originalName: 'New Feature'}}, system: {source: {rules: '2024'}}}]
  ]);
  const pairs = readNamePairs('pack', {'Old Feature': '同名', new: '同名'}, index, new Set());
  assert.deepEqual(pairs.map(p => [p.englishName, p.type, p.rules]), [['Old Feature', 'feat', '2014'], ['New Feature', 'feat', '2024']]);
});

test('public API exposes separate catalog, names and source namespaces without automation dependencies', async () => {
  const {api} = await import('../module/api-v1.mjs');
  assert.equal(api.names, core);
  assert.equal(api.apiVersion, 1);
  assert.equal(api.catalog.apiVersion, 1);
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(core));
});


test('corpus snapshots use Foundry collection entries without interpreting pack contents as key/value pairs', async () => {
  const row = {_id: 'deflect', name: 'Deflect Missiles', type: 'feat'};
  const index = new FoundryCollection([[row._id, row]]);
  // Compendiums are also iterable collections. Empty contents reproduce the
  // reported undefined pack, even though getIndex successfully returned rows.
  const visible = Object.assign(new FoundryCollection(), {
    visible: true, documentName: 'Item', getIndex: async () => index
  });
  const hidden = {visible: false, documentName: 'Item', getIndex: () => {throw Error('hidden pack read');}};
  const actors = {visible: true, documentName: 'Actor', getIndex: () => {throw Error('actor pack read');}};
  const packs = new FoundryCollection([['visible', visible], ['hidden', hidden], ['actors', actors]]);
  const catalogFor = () => new Map();
  const corpus = await core.readCorpus({packs, loadGrouping: () => catalogFor, loadTitleIndex: () => null});
  assert.deepEqual([...corpus.indexes.keys()], ['visible']);
  assert.notEqual(corpus.indexes.get('visible'), index);
  assert.deepEqual([...corpus.indexes.get('visible').values()], [row]);
  row.name = 'Changed after snapshot';
  assert.equal(corpus.indexes.get('visible').get(row._id).name, 'Deflect Missiles');
  assert.deepEqual([...corpus.sources.keys()], ['visible', 'hidden', 'actors']);
  assert.deepEqual(corpus.sources.get('visible'), {visible: true, documentName: 'Item', index: corpus.indexes.get('visible')});
  assert.deepEqual(corpus.sources.get('hidden'), {visible: false, documentName: 'Item', index: undefined});
  assert.equal(corpus.sources.get('actors').documentName, 'Actor');
  assert.equal(corpus.catalogFor, catalogFor);
  assert.equal(corpus.titleIndex, null);
});

test('Foundry collection index failures still identify the source and reject the snapshot', async () => {
  const packs = new FoundryCollection([['broken.pack', {
    visible: true, documentName: 'Item', getIndex: async () => {throw Error('index failed');}
  }]]);
  await assert.rejects(core.readCorpus({packs, loadGrouping: () => () => new Map(), loadTitleIndex: () => null}),
    error => error.source === 'broken.pack' && error.cause.message === 'index failed');
});

test('a failed pack batch waits for all in-flight reads before allowing a retry', async () => {
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const packs=new Map([
    ['bad',{visible:true,documentName:'Item',getIndex:async()=>{throw Error('offline');}}],
    ['slow',{visible:true,documentName:'Item',getIndex:async()=>{await gate;return new Map();}}]
  ]);
  let settled=false;
  const reading=core.readCorpus({packs,loadGrouping:()=>()=>new Map(),loadTitleIndex:()=>null});
  const checked=assert.rejects(reading,/Index unavailable/).then(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(settled,false);release();await checked;
});

test('category and actorType scoping separate class features from monster/race collisions', async () => {
  const index = new Map([
    ['dnd5e.classes24', new Map([
      ['rage', {_id: 'rage', name: '狂暴', type: 'feat', flags: {babele: {originalName: 'Rage'}}, system: {identifier: 'rage', source: {rules: '2024'}, type: {value: 'class'}}}],
      ['indomitable', {_id: 'indomitable', name: '不屈', type: 'feat', flags: {babele: {originalName: 'Indomitable'}}, system: {identifier: 'indomitable', source: {rules: '2024'}, type: {value: 'class'}}}]
    ])],
    ['dnd5e.monsterfeatures', new Map([
      ['berserk', {_id: 'berserk', name: '狂暴', type: 'feat', flags: {babele: {originalName: 'Berserk'}}, system: {identifier: 'berserk', source: {rules: '2014'}, type: {value: 'monster'}}}],
      ['relentless', {_id: 'relentless', name: '不屈', type: 'feat', flags: {babele: {originalName: 'Relentless'}}, system: {identifier: 'relentless', source: {rules: '2014'}, type: {value: 'monster'}}}]
    ])],
    ['third.races', new Map([
      ['unflinching', {_id: 'unflinching', name: '不屈', type: 'feat', flags: {babele: {originalName: 'Unflinching'}}, system: {identifier: 'unflinching', source: {rules: '2024'}, type: {value: 'race'}}}]
    ])]
  ]);
  const packs = new FoundryCollection([...index].map(([id, rows]) => [id, {
    visible: true, documentName: 'Item', getIndex: async () => rows
  }]));
  const titleIndex = {
    ...Object.fromEntries(BASE_ITEM_PACKS.map(id => [id, {titles: {}}])),
    'dnd5e.classes24': {titles: {Rage: '狂暴', Indomitable: '不屈'}},
    'dnd5e.monsterfeatures': {titles: {Berserk: '狂暴', Relentless: '不屈'}},
    'third.races': {titles: {Unflinching: '不屈'}}
  };
  const localItems = [
    {uuid: 'Actor.npc1.Item.1', name: '狂暴', type: 'feat', flags: {babele: {originalName: 'Berserk'}}, system: {source: {rules: '2024'}}, actor: {type: 'npc', items: []}},
    {uuid: 'Actor.npc1.Item.2', name: '偷袭', type: 'feat', flags: {babele: {originalName: 'Sneak Attack (1/Round)'}}, system: {source: {rules: '2024'}}, actor: {type: 'npc', items: []}},
    {uuid: 'Compendium.dnd5e.classes24.Item.sneak', name: '偷袭', type: 'feat', flags: {babele: {originalName: 'Sneak Attack'}}, system: {source: {rules: '2024'}, type: {value: 'class'}}}
  ];
  const corpus = await core.readCorpus({
    packs, localItems,
    loadTitleIndex: () => titleIndex,
    loadGrouping: () => items => new Map(items.map(item => [item.uuid, {key: null}]))
  });
  assert.equal(corpus.localItems[0].actor, undefined);
  assert.equal(corpus.localItems[0].actorType, 'npc');
  const lookupNames = new Set(['Rage', 'Indomitable', 'Sneak Attack']);
  const pairs = core.collectNamePairs(corpus.sources, corpus.titleIndex, lookupNames, ['third.races']);
  const groups = core.itemGroups(corpus.indexes, corpus.catalogFor, corpus.localItems);
  const featScope = {rules: '2024', type: 'feat', types: ['feat'], category: 'class', excludeCategories: ['monster'], actorType: 'character'};
  const plan = core.planAliases({pairs, lookupNames, groups, scope: featScope});
  assert.equal(plan.aliases.get('狂暴'), 'Rage');
  assert.equal(plan.aliases.get('不屈'), 'Indomitable');
  assert.equal(plan.aliases.get('偷袭'), 'Sneak Attack');
  // Monster scope sees neither character class features nor PC-only exclusions incorrectly
  const monsterPlan = core.planAliases({
    pairs, lookupNames: new Set(['Berserk']), groups,
    scope: {rules: '2014', type: 'feat', types: ['feat'], category: 'monster', actorType: 'npc'}
  });
  assert.equal(monsterPlan.aliases.get('狂暴'), 'Berserk');
});

test('resolveItemAlias disambiguates conflicts via reviewed groups, originalName, identifier, and bilingual names while failing closed', () => {
  const pairs = [
    {translatedName: '狂暴', englishName: 'Rage', source: 'phb#Rage', type: 'feat', rules: '2024', identifier: 'rage'},
    {translatedName: '狂暴', englishName: 'Berserk', source: 'mm#Berserk', type: 'feat', rules: '2024', identifier: 'berserk'},
    {translatedName: '宿敌', englishName: 'Favored Enemy', source: 'phb#Favored Enemy', type: 'feat', rules: '2014', identifier: 'favored-enemy'},
    {translatedName: '宿敌', englishName: 'Favored Foe', source: 'tce#Favored Foe', type: 'feat', rules: '2014', identifier: 'favored-foe'},
    {translatedName: '拨挡', englishName: 'Deflect Missiles', source: 'phb#Deflect Missiles', type: 'feat', rules: '2014', identifier: 'deflect-attacks'}
  ];
  const groups = new Map([
    ['reviewed-rage', [
      {displayName: '狂暴', source: 'Compendium.aaatransfer.classes.Item.rage1', type: 'feat', rules: '2024', identifier: 'feat-hash'},
      {displayName: '狂暴', source: 'Compendium.dnd5e.classes24.Item.rage2', originalName: 'Rage', type: 'feat', rules: '2024', identifier: 'rage'}
    ]],
    ['reviewed-deflect', [
      {displayName: '拨挡', source: 'Compendium.dnd5e.classfeatures.Item.deflect', originalName: 'Deflect Missiles', type: 'feat', rules: '2014', identifier: 'deflect-attacks'}
    ]],
    ['inconsistent', [
      {displayName: '宿敌', source: 'Compendium.bad.Item.1', originalName: 'Favored Enemy'},
      {displayName: '宿敌', source: 'Compendium.bad.Item.2', originalName: 'Favored Foe'}
    ]]
  ]);
  const lookupNames = new Set(['Rage', 'Favored Enemy', 'Deflect Missiles']);
  const plan = core.planAliases({pairs, lookupNames, groups});
  assert.equal(plan.aliases.has('狂暴'), false);
  assert.equal(plan.aliases.has('宿敌'), false);

  // 1. Reviewed Truesight group / compendiumSource match
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', _stats: {compendiumSource: 'Compendium.aaatransfer.classes.Item.rage1'}, system: {identifier: 'feat-hash'}
  }), 'Rage');
  // Renamed item must not match via compendiumSource
  assert.equal(core.resolveItemAlias(plan, {
    name: '自订名字', _stats: {compendiumSource: 'Compendium.aaatransfer.classes.Item.rage1'}
  }), null);
  // Inconsistent group does not disambiguate
  assert.equal(core.resolveItemAlias(plan, {
    name: '宿敌', _stats: {compendiumSource: 'Compendium.bad.Item.1'}
  }), null);

  // 2. Explicit Babele originalName (supports matched, fails closed on unsupported without falling through)
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', flags: {babele: {originalName: 'Rage'}}
  }), 'Rage');
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', flags: {babele: {originalName: 'Berserk'}}, system: {identifier: 'rage'}
  }), null);
  assert.equal(core.resolveItemAlias(plan, {
    name: '宿敌', flags: {babele: {originalName: 'Favored Foe'}}, system: {identifier: 'favored-enemy'}
  }), null);

  // 3. System identifier (including mismatched slug from pair identifier)
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', system: {identifier: 'rage'}
  }), 'Rage');
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', system: {identifier: 'berserk'}
  }), null);
  assert.equal(core.resolveItemAlias(plan, {
    name: '拨挡', system: {identifier: 'deflect-attacks'}
  }), 'Deflect Missiles');

  // 4. Complete bilingual name, and opaque hash identifier falls through to bilingual but not plain Chinese
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴 Rage', system: {identifier: 'feat-8ec40c57e1e9aed7'}
  }), 'Rage');
  assert.equal(core.resolveItemAlias(plan, {
    name: '未知 Rage'
  }), null);
  assert.equal(core.resolveItemAlias(plan, {
    name: '狂暴', system: {identifier: 'feat-8ec40c57e1e9aed7'}
  }), null);
});

test('planAliases handles fullwidth bilingual names, isolated vs shared-display groups, English-only conflicts, and spelling variants', () => {
  const pairs = [
    {translatedName: '火球术 Ｆｉｒｅｂａｌｌ', englishName: 'Fireball', source: 'phb#Fireball'},
    {translatedName: '重名', englishName: 'Lay on Hands', source: 'phb14#Lay'}
  ];
  const groups = new Map([
    ['isolated-clean', [{displayName: '法师护甲 Ｍａｇｅ　Ａｒｍｏｒ', source: 'Compendium.p.Item.ma'}]],
    ['isolated-conflict', [
      {displayName: '孤立冲突', source: 'Compendium.p.Item.ic1', originalName: 'Fireball'},
      {displayName: '孤立冲突', source: 'Compendium.p.Item.ic2', originalName: 'Lay On Hands'}
    ]],
    ['shared-a', [{displayName: '跨组同名', source: 'Compendium.p.Item.sa', originalName: 'Fireball'}]],
    ['shared-b', [{displayName: '跨组同名', source: 'Compendium.p.Item.sb', originalName: 'Lay On Hands'}]],
    ['english-only-conflict', [
      {displayName: 'English Only', source: 'Compendium.p.Item.e1', originalName: 'Fireball'},
      {displayName: 'English Only', source: 'Compendium.p.Item.e2', originalName: 'Lay On Hands'}
    ]]
  ]);
  const lookupNames = new Set(['Fireball', 'Mage Armor', 'Lay On Hands']);
  const existingAliases = {Blocked: null, 'Lay on Hands': 'Lay On Hands'};
  const plan = core.planAliases({pairs, lookupNames, existingAliases, groups});

  assert.equal(plan.aliases.get('火球术 Ｆｉｒｅｂａｌｌ'), 'Fireball');
  assert.equal(plan.aliases.get('火球术'), 'Fireball');
  assert.equal(plan.aliases.get('法师护甲 Ｍａｇｅ　Ａｒｍｏｒ'), 'Mage Armor');
  assert.equal(plan.aliases.get('重名'), 'Lay On Hands');
  assert.equal(plan.aliases.has('孤立冲突'), false);
  assert.equal(plan.aliases.has('跨组同名'), false);
  assert.equal(plan.aliases.has('Blocked'), false);
  assert.deepEqual(plan.report.clusterErrors.map(e => e.groups).sort((a, b) => a.length - b.length || a[0].localeCompare(b[0])), [
    ['english-only-conflict'],
    ['isolated-conflict'],
    ['shared-a', 'shared-b']
  ]);
  assert.equal(plan.report.status, 'cluster-conflict');
});
