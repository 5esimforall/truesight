import {FoundryCollection} from './helpers/foundry-collection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {core} from '../module/scripts/names/api.mjs';
import {readNamePairs} from '../module/scripts/names/translations.mjs';

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
