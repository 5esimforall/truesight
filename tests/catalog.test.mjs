import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {validSnapshot, reviewSettingKey} from '../module/scripts/catalog/state.mjs';
import {connectCatalog, catalog} from '../module/scripts/catalog/api.mjs';
import {loadGrouping, itemGroups} from '../module/scripts/names/groups.mjs';
import {createRuntime, permitted} from '../module/scripts/runtime.mjs';
import {core} from '../module/scripts/names/api.mjs';
import {groupingFixture, spell} from './catalog-fixture.mjs';

function fixture(options = {}) {
  const f = {...groupingFixture(), events: [], status: 'ready', saved: options.saved ?? null, failSave: false};
  f.service = new CatalogService({indexStatus: () => ({status:f.status}), index: () => ({status:f.status, results:f.rows}), environment: () => f.environment,
    load: () => f.saved, save: async value => {if(f.failSave) throw Error('quota'); f.saved = value;},
    notify: event => f.events.push(event)});
  f.apply = async () => f.service.apply(f.service.preview({includeRisk:true}).id);
  return f;
}

test('shared catalog has explicit readiness and no review is not failure', async () => {
  const f = fixture();
  assert.equal(f.service.getStatus().status, 'unreviewed');
  assert.equal(f.service.read().groups.size, 0);
  f.status = 'not-ready';
  assert.throws(() => f.service.read(), {code:'not-ready'});
  const waiting = f.service.whenReady({timeout:100});
  f.status = 'ready'; f.service.invalidate();
  assert.equal((await waiting).status,'unreviewed');
  f.status = 'unavailable';
  await assert.rejects(f.service.whenReady(), {code:'unavailable'});
  f.status = 'not-ready';
  await assert.rejects(f.service.whenReady({timeout:1}), {code:'index-timeout'});
});

test('preview does not apply; application and undo notify and retain separate editions', async () => {
  const f = fixture(), p = f.service.preview({includeRisk:true});
  assert.equal(p.diff.groups,3); assert.equal(f.service.read().groups.size,0);
  await f.service.apply(p.id);
  const result = f.service.read();
  assert.equal(result.groups.size,3); assert.equal(result.revision,1);
  assert.notEqual(result.entries.get(f.rows[0].item.uuid).key,result.entries.get(f.rows[2].item.uuid).key);
  assert.equal(f.events.length,1);
  assert.ok(!JSON.stringify(f.events).includes('Compendium.'));
  await f.service.undo();
  assert.equal(f.service.read().status,'unreviewed'); assert.equal(f.service.getStatus().revision,2);
  assert.equal(f.events.length,2); assert.equal(f.service.getStatus().canUndo,false);
});

test('publication remains on the previous review when client storage fails', async () => {
  const f = fixture(); await f.apply(); const before = f.service.read();
  f.rows.push(spell('later')); const preview = f.service.preview(); f.failSave = true;
  await assert.rejects(f.service.apply(preview.id),/quota/);
  assert.equal(f.service.read().revision,before.revision); assert.equal(f.events.length,1);
  assert.equal(f.service.getMember(f.rows.at(-1).item.uuid).key,null);
});

test('new and changed entries stay independent after refresh, reload and undo', async () => {
  const f = fixture(); await f.apply(); f.rows.push(spell('later'));
  f.rows[0].item.system.school = 'evo'; f.service.invalidate('index');
  assert.equal(f.service.getMember(f.rows.at(-1).item.uuid).status,'pending');
  assert.equal(f.service.getMember(f.rows[0].item.uuid).status,'invalidated');
  const reload = fixture({saved:f.saved}); reload.rows = f.rows;
  assert.equal(reload.service.getMember(f.rows.at(-1).item.uuid).key,null);
  await reload.apply(); await reload.service.undo();
  assert.equal(reload.service.getMember(f.rows[0].item.uuid).key,null);
});

test('changed evidence or applied review rejects an old preview', async () => {
  const f = fixture(), p = f.service.preview();
  f.rows[0].item.system.level = 2;
  await assert.rejects(f.service.apply(p.id),{code:'preview-stale'});
  const next = f.service.preview(); await f.service.apply(next.id);
  await assert.rejects(f.service.apply(p.id),{code:'preview-stale'});
});

test('names and catalog consumers get identical approved membership without Slow Insert', async () => {
  const f = fixture(); await f.apply(); connectCatalog(f.service);
  const indexes = new Map([['fixture.spells',new Map(f.rows.map(({item}) => [item.uuid.split('.').at(-1),
    {_id:item.uuid.split('.').at(-1),name:item.name,type:'spell',system:item.system,originalName:item.originalName}]))]]);
  const groups = itemGroups(indexes,await loadGrouping());
  for (const [key, group] of catalog.read().groups) assert.deepEqual(groups.get(key).map(member=>member.source).sort(),group.members.toSorted());
  const namesBefore = JSON.stringify([...groups]);
  // Unrelated UI preferences never enter the service API.
  f.preferences = {query:'anything', filters:{}, pins:{bad:'another'}, enabled:false};
  assert.equal(JSON.stringify([...itemGroups(indexes,await loadGrouping())]),namesBefore);
});

test('public results are detached metadata; no document, search wrapper or functions escape', async () => {
  const f = fixture(); for(const {item} of f.rows) item.show=()=>assert.fail('must not load');
  await f.apply(); const data=f.service.read();
  for(const entry of data.entries.values()) {assert.equal(entry.result,undefined);assert.equal(entry.item,undefined);}
  const uuid=f.rows[0].item.uuid;data.entries.get(uuid).key='corrupted';data.groups.clear();
  assert.notEqual(f.service.getMember(uuid).key,'corrupted');assert.equal(f.service.read().groups.size,3);
});

test('denied members disappear from reads but world review preserves absent relationships', async () => {
  const f = fixture(); await f.apply();
  const hidden=f.rows[0]; hidden.item.name='SECRET TITLE'; f.rows=f.rows.slice(1);
  const result=f.service.read();
  const text=JSON.stringify({entries:[...result.entries],groups:[...result.groups]});
  assert.ok(!text.includes(hidden.item.uuid));assert.ok(!text.includes('SECRET TITLE'));
  await f.apply();
  assert.ok(JSON.stringify(f.saved).includes(hidden.item.uuid));
  assert.ok(f.saved.active.groups[f.saved.active.records[hidden.item.uuid].key].members.includes(hidden.item.uuid));
});

test('identity exclusion is shared and undoable, not a browser preference', async () => {
  const f=fixture();await f.apply();const uuid=f.rows[0].item.uuid;
  await f.service.exclude(uuid);assert.equal(f.service.getMember(uuid).key,null);
  assert.equal(f.service.read().excludedCount,1);await f.service.undo();assert.ok(f.service.getMember(uuid).key);
  await f.service.exclude(uuid);await f.service.restoreExcluded();assert.ok(f.service.getMember(uuid).key);
});

test('corrupt or incompatible persisted review is an explicit failure, not no-review', () => {
  for(const saved of [{schemaVersion:99},{schemaVersion:1,revision:0,active:{bad:true},excluded:[]}]) {
    const f=fixture({saved});assert.equal(f.service.getStatus().status,'failed');assert.throws(()=>f.service.read(),{code:'invalid-review'});
  }
  assert.equal(validSnapshot({version:1,ruleVersion:99}),null);
  assert.notEqual(reviewSettingKey({id:'a'},{id:'u'}),reviewSettingKey({id:'b'},{id:'u'}));
  assert.notEqual(reviewSettingKey({id:'a'},{id:'u'}),reviewSettingKey({id:'a'},{id:'v'}));
});

function runtimeFixture() {
  const handlers=new Map(),settings=new Map([['quick-insert.gmOnly',false]]),rows=groupingFixture().rows;
  const hooks={on:(name,cb)=>{handlers.set(name,cb);return cb;},off:name=>handlers.delete(name),callAll:(name,...args)=>handlers.get(name)?.(...args)};
  const game={ready:true,world:{id:'world'},user:{id:'gm',isGM:true,can:()=>true},system:{id:'dnd5e'},i18n:{lang:'en',localize:key=>key},
    modules:new Map([['quick-insert',{active:true}]]),packs:new Map([['fixture.spells',{visible:true}]]),items:new Map(),actors:new Map(),
    settings:{register:(id,key,def)=>{if(!settings.has(id+'.'+key))settings.set(id+'.'+key,def.default);},get:(id,key)=>settings.get(id+'.'+key),set:async(id,key,value)=>settings.set(id+'.'+key,value)}};
  const config={Item:{compendiumIndexFields:[]},Actor:{compendiumIndexFields:[]}};
  const qi={hasIndex:false,search:()=>rows,forceIndex:async()=>{qi.hasIndex=true;hooks.callAll('QuickInsert:IndexCompleted');}};
  const service=createRuntime({game,hooks,config,quickInsert:()=>qi,parser:()=>null, publisher:{status:()=>({canPublish:true}),start(){},begin(){},end(){},destroy(){}}});
  return {service,game,config,qi,hooks,settings,rows};
}

test('runtime starts and indexes with Quick Insert only; no panel, translator, CPR or GPS', async () => {
  const f=runtimeFixture();await f.service.start();await f.service.whenReady({timeout:100});
  assert.equal(f.service.read().entries.size,6);assert.equal(f.game.modules.size,1);
  assert.ok(f.config.Item.compendiumIndexFields.includes('system.identifier'));
  f.service.destroy();
});

test('runtime permissions never rely solely on old QI search results', async () => {
  const f=runtimeFixture();f.qi.hasIndex=true;
  await f.service.apply(f.service.preview().id);f.game.packs.get('fixture.spells').visible=false;
  assert.equal(f.service.read().entries.size,0);
  f.game.user.isGM=false;f.settings.set('quick-insert.gmOnly',true);assert.equal(f.service.getStatus().status,'unavailable');
  assert.throws(()=>f.service.read(),{code:'quick-insert-gm-only'});
  f.game.user.isGM=true;assert.equal(f.service.getStatus().status,'ready');
  assert.equal(permitted({uuid:'Item.secret'},f.game),false);
  assert.equal(permitted({uuid:'Actor.secret.Item.secret'},f.game),false);f.service.destroy();
});

test('source providers have one shared owner and stale disposers cannot remove replacements', () => {
  const f=runtimeFixture();f.qi.hasIndex=true;
  const first=f.service.registerPublications('test',[{id:'a',title:'A',label:'A'}]);
  const second=f.service.registerPublications('test',[{id:'b',title:'B',label:'B'}]);
  assert.equal(first(),false);assert.equal(f.service.environment().publicationProviders.get('test')[0].id,'b');
  assert.equal(second(),true);assert.equal(f.service.getStatus().generation,3);f.service.destroy();
});

test('name evidence works without a Chinese translation module and never fetches missing assets', async t => {
  const f=fixture();connectCatalog(f.service);
  const old=globalThis.game,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.game=old;globalThis.fetch=oldFetch;});
  globalThis.game={modules:new Map(),packs:new Map(),items:new Map(),actors:new Map(),user:{}};
  globalThis.fetch=()=>assert.fail('optional translation must not fetch');
  const corpus=await core.loadCorpus();assert.equal(corpus.indexes.size,0);assert.equal(corpus.titleIndex,null);
  assert.deepEqual(core.collectNamePairs(new Map(),corpus.titleIndex,new Set(),['provider.actions']),[]);
});

test('ordinary updates preserve previews; identity and access invalidate synchronously before deferred publication', async () => {
  const f=runtimeFixture();f.qi.hasIndex=true;
  let notices=0;f.hooks.on('truesightChanged',()=>notices++);
  const preview=f.service.preview();
  f.hooks.callAll('updateActor',{}, {'system.attributes.hp.value':1});
  f.hooks.callAll('updateSetting',{key:'slow-insert.grouping'},{value:{}});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(notices,0);assert.ok(f.service.previews.has(preview.id));
  f.rows[0].item.name='Changed display';
  f.hooks.callAll('updateItem',{}, {name:'Changed display'});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(notices,1);assert.ok(f.service.previews.has(preview.id));
  await f.service.apply(preview.id);
  const next=f.service.preview();
  f.hooks.callAll('updateItem',{}, {'system.school':'evo'});
  await assert.rejects(f.service.apply(next.id),{code:'preview-stale'});
  const risk=f.service.preview({includeRisk:true});
  f.hooks.callAll('updateItem',{}, {name:'Risk rename'});
  assert.equal(f.service.previews.has(risk.id),false);
  f.game.packs.get('fixture.spells').visible=false;
  f.hooks.callAll('updateCompendium',{}, {ownership:{default:0}});
  assert.equal(f.service.read().entries.size,0);
  f.service.destroy();
});
test('batched notifications retain all domains and immediate access revocation flushes pending changes', async () => {
  const f=fixture();
  f.service.invalidate('rename',['names'],{defer:true});
  f.service.invalidate('image',['display'],{defer:true});
  assert.equal(f.events.length,0);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.events.length,1);assert.deepEqual(f.events[0].changes.sort(),['display','names']);
  f.service.invalidate('rename',['names'],{defer:true});
  f.service.invalidate('permission',['access']);
  assert.equal(f.events.length,2);
  assert.ok(f.events[1].changes.includes('access'));
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.events.length,2);
});

test('status never scans; a revision reuses the QI scan and normalized metadata across consumers', async () => {
  const f=runtimeFixture();f.qi.hasIndex=true;let scans=0;
  f.qi.search=()=>{scans++;return f.rows;};
  for(let i=0;i<100;i++)f.service.getStatus();assert.equal(scans,0);
  f.service.read();const metadata=f.service.metadataCache;
  f.service.read();f.service.getMember(f.rows[0].item.uuid);f.service.preview();
  assert.equal(scans,1);assert.equal(f.service.metadataCache,metadata);
  const preview=f.service.preview();await f.service.apply(preview.id);
  assert.equal(scans,2); // One fresh evidence check at apply, never a cached authorization.
  const applied=f.service.metadataCache;f.service.read();f.service.preview();assert.equal(f.service.metadataCache,applied);
  assert.equal(scans,2);
  f.hooks.callAll('updateActor',{}, {'system.attributes.hp.value':0});await new Promise(r=>setTimeout(r,5));
  f.service.read();assert.equal(scans,2);
  f.rows[0].item.name='New name';f.hooks.callAll('updateItem',{}, {name:'New name'});await new Promise(r=>setTimeout(r,5));
  assert.equal(f.service.getMember(f.rows[0].item.uuid).names[0],'New name');assert.equal(scans,3);
  // Permission checks are performed even on a cache hit, without a hook.
  f.game.packs.get('fixture.spells').visible=false;
  assert.equal(f.service.read().entries.size,0);assert.equal(scans,3);
  f.service.destroy();
});
test('index object replacement and source revisions invalidate metadata without changing the algorithm', () => {
  const f=runtimeFixture();f.qi.hasIndex=true;f.qi.searchLib={index:{}};
  f.service.read();const before=f.service.metadataCache;
  f.qi.searchLib.index={};f.service.read();assert.notEqual(f.service.metadataCache,before);
  const next=f.service.metadataCache;f.service.registerPublications('test',[]);f.service.read();assert.notEqual(f.service.metadataCache,next);
  f.service.destroy();
});

test('destroy cancels readiness waiters and pending notifications', async () => {
  const f=runtimeFixture();const waiting=f.service.whenReady();
  f.service.invalidate('index',undefined,{defer:true});f.service.destroy();
  await assert.rejects(waiting,{code:'stopped'});assert.equal(f.service.waiters.size,0);
  assert.equal(f.service.getStatus().reason,'stopped');
});

test('production corpus shares requested fields across consumers and rechecks access before using its cache', async t => {
  const f=runtimeFixture();f.qi.hasIndex=true;const old=globalThis.game;t.after(()=>{globalThis.game=old;f.service.destroy();});
  globalThis.game=f.game;connectCatalog(f.service);
  let reads=0;const fields=[];const pack=f.game.packs.get('fixture.spells');pack.documentName='Item';
  pack.getIndex=async request=>{reads++;fields.push(request.fields);return new Map([['a',{_id:'a',name:'例子',type:'spell',system:{identifier:'example-spell',source:{rules:'2014'},level:4,school:'con'},flags:{test:{id:'extra'}},folderId:'folder'}]]);};
  const [a,b]=await Promise.all([core.loadCorpus({fields:['flags.test.id']}),core.loadCorpus({fields:['folderId']})]);
  assert.equal(reads,1);assert.ok(fields[0].includes('folderId'));assert.ok(fields[0].includes('flags.test.id'));
  a.indexes.get('fixture.spells').get('a').name='changed';assert.equal(b.indexes.get('fixture.spells').get('a').name,'例子');
  await core.loadCorpus();assert.equal(reads,1);
  pack.visible=false;assert.equal(a.isCurrent(),false);const denied=await core.loadCorpus();assert.equal(denied.indexes.size,0);assert.equal(reads,1);
  pack.visible=true;await core.loadCorpus();assert.equal(reads,2);
  f.hooks.callAll('updateItem',{}, {name:'new'});await new Promise(r=>setTimeout(r,5));await core.loadCorpus();assert.equal(reads,3);
});

test('access changes retract immediately and settle again after later QI hooks update the index', async () => {
  const f=runtimeFixture();f.qi.hasIndex=true;let rows=f.rows.slice(0,1);f.qi.search=()=>rows;
  const sizes=[];f.hooks.on('truesightChanged',()=>sizes.push(f.service.read().entries.size));
  f.service.read();f.hooks.callAll('updateActor',{}, {ownership:{default:2}});
  assert.equal(sizes.length,1);assert.equal(sizes[0],1);
  rows=f.rows; // Simulate QI's document hook running after Truesight's hook.
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(sizes,[1,6]);assert.equal(f.service.read().entries.size,6);f.service.destroy();
});
