import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from '../module/scripts/runtime.mjs';
import {createPublisher} from '../module/scripts/catalog/publisher.mjs';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {connectCatalog, catalog} from '../module/scripts/catalog/api.mjs';
import {groupingFixture, spell} from './catalog-fixture.mjs';

function hooks() {
  const callbacks = new Map();
  return {on(name, fn) {const set = callbacks.get(name) ?? new Set(); set.add(fn); callbacks.set(name, set); return fn;},
    off(name, fn) {callbacks.get(name)?.delete(fn);},callAll(name, ...args) {for (const fn of callbacks.get(name) ?? []) fn(...args);}};
}
function world() {
  const values = new Map(), clients = []; let failure = false, waiting = null;
  const create = (id, isGM, publish = isGM) => {
    const f = groupingFixture(), event = hooks(), definitions = new Map(), notices = [], errors = [];
    const game = {ready:true,world:{id:'world'},user:{id,isGM},system:{id:'dnd5e'},i18n:{lang:'en',localize:k=>k},
      modules:new Map([['quick-insert',{active:true}]]),packs:new Map([['fixture.spells',{visible:true}]]),items:new Map(),actors:new Map(),
      settings:{register(ns,key,definition) {definitions.set(ns+'.'+key,definition);},
        get(ns,key) {return structuredClone(values.get(ns+'.'+key) ?? null);},
        async set(ns,key,value) {
          assert.equal(isGM,true,'native world write permission');
          if (waiting) await waiting;
          if (failure) throw Error('save-failed');
          values.set(ns+'.'+key,structuredClone(value));
          for (const client of clients) client.definitions.get(ns+'.'+key)?.onChange?.(structuredClone(value));
          return value;
        }}};
    const runtime = createRuntime({game,hooks:event,config:{Item:{compendiumIndexFields:[]},Actor:{compendiumIndexFields:[]}},
      quickInsert:()=>({hasIndex:true,search:()=>f.rows}),parser:()=>null,reportError:code=>errors.push(code),
      publisher:{status:()=>({canPublish:publish,publishReason:publish?null:'publisher-other-gm'}),start(){},begin(){},end(){},destroy(){}}});
    event.on('truesightChanged',s=>notices.push(s));
    const client = {runtime,game,definitions,f,notices,errors}; clients.push(client); return client;
  };
  return {values,clients,create,fail(value) {failure=value;},pause(value) {waiting=value;}};
}
const apply = r => r.apply(r.preview({includeRisk:true}).id);

test('world publication, exclusion and undo propagate; players consume but cannot manage', async () => {
  const w=world(),gm=w.create('gm',true),player=w.create('p',false),other=w.create('gm2',true,false);
  await apply(gm.runtime);
  assert.equal(player.runtime.read().groups.size,3);assert.equal(other.runtime.read().revision,1);
  assert.equal(player.runtime.getStatus().scope,'world');assert.equal(player.runtime.getStatus().canUndo,undefined);
  assert.throws(()=>player.runtime.preview(),{code:'review-forbidden'});
  for(const method of [()=>player.runtime.apply('1'),()=>player.runtime.undo(),()=>player.runtime.exclude('x'),()=>player.runtime.restoreExcluded()]) await assert.rejects(method,{code:'review-forbidden'});
  connectCatalog(player.runtime,()=>assert.fail('must not open'));
  assert.throws(()=>catalog.openReview(),{code:'review-forbidden'});
  const otherPreview=other.runtime.preview();await assert.rejects(other.runtime.apply(otherPreview.id),{code:'publisher-other-gm'});
  const id=gm.f.rows[0].item.uuid;await gm.runtime.exclude(id);
  assert.equal(player.runtime.getMember(id).key,null);await gm.runtime.undo();assert.ok(player.runtime.getMember(id).key);
  assert.ok(player.notices.every(n=>!JSON.stringify(n).includes('Compendium.')));
  const state=w.values.get('truesight.review');assert.equal(state.publisherId,'gm');assert.ok(state.publishedAt>0);
  gm.runtime.destroy();other.runtime.destroy();
  const reload=w.create('new-player',false);assert.equal(reload.runtime.read().groups.size,3);
  reload.game.packs.get('fixture.spells').visible=false;assert.equal(reload.runtime.read().entries.size,0);
  player.runtime.destroy();reload.runtime.destroy();
});

test('external publication invalidates old previews and does not permit stale completion rollback', async () => {
  const w=world(),gm=w.create('gm',true),other=w.create('gm2',true);
  const preview=other.runtime.preview();await apply(gm.runtime);
  await assert.rejects(other.runtime.apply(preview.id),{code:'preview-stale'});
  const first=structuredClone(w.values.get('truesight.review'));await gm.runtime.exclude(gm.f.rows[0].item.uuid);
  other.runtime.receive(first);assert.equal(other.runtime.state.revision,2);
  other.runtime.receive({...other.runtime.state,excluded:[]});assert.equal(other.runtime.getStatus().reason,'review-conflict');
});

test('failed or concurrent saves retain the last confirmed state', async () => {
  const w=world(),gm=w.create('gm',true),p=w.create('p',false);await apply(gm.runtime);
  w.fail(true);const preview=gm.runtime.preview();await assert.rejects(gm.runtime.apply(preview.id),/save-failed/);
  assert.equal(gm.runtime.state.revision,1);assert.equal(p.runtime.state.revision,1);
  w.fail(false);let release;w.pause(new Promise(resolve=>{release=resolve;}));
  const saving=gm.runtime.apply(preview.id);
  await assert.rejects(gm.runtime.undo(),{code:'save-in-progress'});
  release();await saving;assert.equal(p.runtime.state.revision,2);
});

test('recalculation preserves absent relationships, exclusions and undo without inventing new links', async () => {
  const w=world(),gm=w.create('gm',true);await apply(gm.runtime);
  const missing=gm.f.rows[0],visible=gm.f.rows[1];await gm.runtime.exclude(missing.item.uuid);
  gm.f.rows=gm.f.rows.slice(1);gm.f.rows.push(spell('new'));
  gm.runtime.invalidate('index');const preview=gm.runtime.preview({includeRisk:true});assert.equal(preview.retained,1);
  await gm.runtime.apply(preview.id);
  const saved=w.values.get('truesight.review');assert.ok(saved.excluded.includes(missing.item.uuid));
  assert.ok(saved.active.records[missing.item.uuid]);
  assert.equal(saved.active.records[visible.item.uuid].key,saved.active.records[missing.item.uuid].key);
  assert.equal(gm.runtime.getMember(gm.f.rows.at(-1).item.uuid).key,null);
  await gm.runtime.undo();assert.ok(w.values.get('truesight.review').active.records[missing.item.uuid]);
});


test('invalid world review errors on all clients and the designated GM clears active, undo and exclusions', async () => {
  const w=world();w.values.set('truesight.review',{schemaVersion:99,revision:7,active:{bad:true},previous:{bad:true},excluded:['old']});
  const player=w.create('p',false),other=w.create('other',true,false);
  await player.runtime.start();await other.runtime.start();await settle();
  assert.equal(w.values.get('truesight.review').schemaVersion,99);
  assert.equal(player.runtime.getStatus().reason,'invalid-review');
  assert.deepEqual(player.errors,['invalid-review']);assert.deepEqual(other.errors,['invalid-review']);
  const gm=w.create('gm',true);await gm.runtime.start();await settle();
  const cache=w.values.get('truesight.review');
  assert.equal(cache.revision,8);assert.equal(cache.active,null);assert.equal(cache.previous,null);assert.deepEqual(cache.excluded,[]);
  assert.equal(gm.runtime.read().groups.size,0);assert.equal(player.runtime.getStatus().status,'unreviewed');
  assert.deepEqual(gm.errors,['invalid-review']);
  assert.ok([...gm.definitions.keys()].every(key=>key==='truesight.review'));
  assert.throws(()=>gm.runtime.preview({importLegacy:true}),{code:'invalid-options'});
  await apply(gm.runtime);assert.equal(player.runtime.read().groups.size,3);
  for(const client of w.clients)client.runtime.destroy();
});

test('failed invalid-cache reset stays explicitly failed and never publishes retained members', async () => {
  const w=world();w.values.set('truesight.review',{bad:true});w.fail(true);
  const gm=w.create('gm',true);await gm.runtime.start();await settle();
  assert.equal(gm.runtime.getStatus().reason,'invalid-review');assert.equal(gm.runtime.state.active,null);
  assert.deepEqual(gm.errors,['invalid-review','cache-reset-failed']);assert.deepEqual(w.values.get('truesight.review'),{bad:true});
  await settle();assert.equal(gm.errors.length,2);gm.runtime.destroy();
  w.fail(false);const reload=w.create('gm',true);await reload.runtime.start();await settle();
  assert.equal(reload.runtime.getStatus().status,'unreviewed');reload.runtime.destroy();
});


function publisherNetwork() {
  const users=new Map([['a',{id:'a',isGM:true,active:true}],['b',{id:'b',isGM:true,active:true}]]);
  users.activeGM=users.get('a');const peers=[];
  const create=(id,session)=>{
    const event=hooks(),socketHooks=hooks();
    const socket={id:session,connected:true,on:socketHooks.on,off:socketHooks.off,emit(channel,data){for(const p of peers)if(p.socket!==socket)p.socketHooks.callAll(channel,data);}};
    const game={user:{...users.get(id),can:()=>true},users,socket};
    const publisher=createPublisher({game,hooks:event,settleMs:1});
    const peer={publisher,socket,socketHooks,event,game};peers.push(peer);publisher.start();return peer;
  };
  return {create,users,peers};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
test('native designated GM is the only writer; duplicate same-account sessions fail closed', async () => {
  const n=publisherNetwork(),a=n.create('a','a1'),b=n.create('b','b1');await settle();
  assert.equal(a.publisher.status().canPublish,true);assert.equal(b.publisher.status().publishReason,'publisher-other-gm');
  const second=n.create('a','a2');await settle();
  for(const peer of [a,second])assert.equal(peer.publisher.status().publishReason,'publisher-multiple-sessions');
  second.publisher.destroy();assert.equal(a.publisher.status().canPublish,true);
  a.publisher.begin();n.users.activeGM=n.users.get('b');a.event.callAll('userConnected',n.users.get('a'),false);b.event.callAll('userConnected',n.users.get('a'),false);
  assert.equal(b.publisher.status().publishReason,'publisher-busy');a.publisher.end();assert.equal(b.publisher.status().canPublish,true);
  b.socket.connected=false;b.socketHooks.callAll('disconnect');assert.equal(b.publisher.status().publishReason,'publisher-not-ready');
  a.publisher.destroy();b.publisher.destroy();
});

test('explicit same-name review shares only applied relations, survives client reload and honors player access',async()=>{
 const w=world(),gm=w.create('gm',true),player=w.create('p',false),other=w.create('gm2',true,false);
 for(const client of [gm,player,other])client.f.rows[1].item.system.school='evo';
 const left=gm.f.rows[0].item.uuid,right=gm.f.rows[1].item.uuid;
 const preview=gm.runtime.previewNameDecision({left,right,kind:'same',reason:'Reviewed matching rule text despite the school metadata conflict'});
 assert.equal(player.runtime.getMember(left).key,null);
 assert.throws(()=>player.runtime.readNameReview(),{code:'review-forbidden'});assert.throws(()=>player.runtime.readNameDecisions(),{code:'review-forbidden'});
 const otherPreview=other.runtime.previewNameDecision({left,right,kind:'same',reason:'Same comparison'});
 await assert.rejects(other.runtime.apply(otherPreview.id),{code:'publisher-other-gm'});
 await gm.runtime.apply(preview.id);
 const key=player.runtime.getMember(left).key;assert.ok(key);assert.equal(player.runtime.getMember(right).key,key);
 const reload=w.create('reload',false);reload.f.rows[1].item.system.school='evo';assert.equal(reload.runtime.getMember(left).key,key);
 reload.game.packs.get('fixture.spells').visible=false;assert.equal(reload.runtime.getMember(left).status,'not-indexed');assert.equal(reload.runtime.read().groups.size,0);
 assert.ok(player.notices.every(change=>!JSON.stringify(change).includes('Compendium.')));
 await gm.runtime.undo();assert.equal(player.runtime.getMember(left).key,null);
 for(const client of [gm,player,other,reload])client.runtime.destroy();
});
