import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlutoniumCnProvider,cnReference} from '../module/scripts/providers/plutonium-cn.mjs';
import {calculateGrouping,describeGroupingIndex} from '../module/scripts/catalog/identity.mjs';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {createRuntime} from '../module/scripts/runtime.mjs';
import {examples,providerFixture} from './provider-fixture.mjs';
const provider=f=>createPlutoniumCnProvider({module:()=>({active:true}),capabilities:()=>f.api});
const environment=external=>({system:{id:'dnd5e'},externalIdentities:external.records});
const native={uuid:'Item.native',name:'Resolve',documentType:'Item',subType:'feat',system:{identifier:'resolve',source:{rules:'2014'},type:{value:'class'},requirements:'Fighter 9'}};

test('optional CN identity matches a native family without replacing original search objects or crossing owners',async()=>{
 const f=providerFixture(examples()),external=provider(f);await external.refresh(f.items);
 assert.equal([...external.records.values()].every(e=>e.status==='ready'),true);
 const rows=[...f.items,native].map(item=>({item})),result=calculateGrouping(rows,environment(external));
 const a=result.records[f.items[1].uuid],b=result.records[native.uuid];assert.ok(a.key);assert.equal(a.key,b.key);
 assert.equal(result.records[f.items[3].uuid].key,null);
 const entries=describeGroupingIndex(rows,environment(external));assert.equal(entries.get(f.items[1].uuid).result.item,f.items[1]);
 assert.deepEqual(f.items[1].system,{});assert.equal(f.items[1].name,'勇气');assert.equal(f.items[1].onDrag(),f.items[1].dragData);
 assert.equal(entries.get(f.items[3].uuid).context.level,11);
 assert.equal(entries.get(f.items[1].uuid).source.rules,'2014');assert.equal(f.reads,6,'class and raw_class are distinct loader pages');
});
test('missing capabilities, wrong UIDs, English names, editions and sources stay independent',async()=>{
 const absent=createPlutoniumCnProvider({module:()=>null,capabilities:()=>({})}),base=providerFixture(examples());
 await absent.refresh(base.items);assert.equal(base.reads,0);assert.equal(absent.records.get(base.items[1].uuid).warning,'provider-unavailable');
 for(const edit of [e=>delete e[1].ENG_name,e=>e[0].edition='unknown',e=>e[1].prerequisites=['other'],e=>e[1].edition='one']) {
   const data=examples();edit(data);const f=providerFixture(data),p=provider(f);await p.refresh(f.items);assert.equal(p.records.get(f.items[1].uuid).status,'failed');
 }
 const f=providerFixture(examples()),p=provider(f);f.items[1].dragData.source='XPHB';await p.refresh(f.items);assert.equal(p.records.get(f.items[1].uuid).warning,'provider-identity');
 assert.equal(cnReference({...f.items[1],__source:'other'}),null);
 assert.equal(cnReference({...f.items[1],dragData:{...f.items[1].dragData,tagText:'bogus'}}).error,'provider-identity');
});
test('source conflicts are not overwritten and reloaded missing-provider records retract reviewed links',async()=>{
 const f=providerFixture(examples()),p=provider(f);await p.refresh(f.items);
 const rows=[...f.items,native].map(item=>({item}));
 const s=new CatalogService({index:()=>({results:rows}),environment:()=>environment(p),load:()=>null,save:async v=>v});
 await s.apply(s.preview().id);assert.ok(s.getMember(native.uuid).key);
 f.items[1].source='XPHB';s.invalidate();assert.equal(s.getMember(f.items[1].uuid).warning,'edition');
 f.items[1].source='PHB';p.stop();s.invalidate();assert.equal(s.getMember(f.items[1].uuid).key,null);
});
test('obsolete refresh and stop never publish late identities',async()=>{
 const f=providerFixture(examples());let release;const original=f.api.loader.pCacheAndGet;
 f.api.loader.pCacheAndGet=async(...args)=>{await new Promise(r=>release=r);return original(...args);};
 const p=provider(f),pending=p.refresh([f.items[0]]);await new Promise(r=>setTimeout(r,0));
 await p.refresh([]);release();assert.equal(await pending,false);assert.equal(p.records.size,0);
 const next=p.refresh([f.items[0]]);await new Promise(r=>setTimeout(r,0));p.stop();release();assert.equal(await next,false);assert.equal(p.records.size,0);
});
test('rule content reads are explicit, safe for virtual items, detached and permission checked after await',async()=>{
 const f=providerFixture(examples()),p=provider(f);await p.refresh(f.items);let rows=f.items.map(item=>({item}));
 const s=new CatalogService({index:()=>({results:rows}),environment:()=>environment(p),load:()=>null,save:async v=>v});
 const rules=await s.loadRuleEvidence([f.items[1].uuid,f.items[3].uuid]);assert.match(rules[0].text,/13/);assert.match(rules[1].text,/18/);
 rules[0].provider.ownerName='changed';assert.equal((await s.loadRuleEvidence([f.items[1].uuid]))[0].provider.ownerName,'Fighter');
 s.canManage=()=>false;await assert.rejects(s.loadRuleEvidence([f.items[1].uuid]),{code:'review-forbidden'});s.canManage=()=>true;
 const pending=s.loadRuleEvidence([f.items[1].uuid]);rows=[];await assert.rejects(pending,{code:'preview-stale'});
 await assert.rejects(s.loadRuleEvidence(Array(51).fill('Item.x')),{code:'invalid-options'});
});
test('runtime hydrates visible CN data, invalidates on disable and keeps native operation without CN',async()=>{
 const f=providerFixture(examples()),callbacks=new Map();let active=true;
 const game={ready:true,user:{isGM:true},system:{id:'dnd5e'},i18n:{lang:'en',localize:k=>k},packs:new Map(),items:new Map(),actors:new Map(),
 modules:new Map([['quick-insert',{active:true}],['plutonium-cn',{get active(){return active;}}]]),settings:{register(){},get(){return null;}}};
 const hooks={on:(k,fn)=>{callbacks.set(k,fn);return fn;},off(){},callAll(){}};
 const qi={hasIndex:true,search:()=>f.items.map(item=>({item}))};
 const r=createRuntime({game,hooks,config:{Item:{compendiumIndexFields:[]}},quickInsert:()=>qi,providerCapabilities:()=>f.api,
 publisher:{status:()=>({canPublish:true}),start(){},destroy(){}},reportError(){}});
 await r.start();assert.equal(r.getMember(f.items[1].uuid).evidence.identifier,'resolve');
 active=false;callbacks.get('srd5e.configUpdate')();await new Promise(r=>setTimeout(r,0));assert.equal(r.getMember(f.items[1].uuid).warning,'provider-unavailable');
 r.destroy();assert.equal(r.getStatus().status,'unavailable');
});

test('subclass feature identity verifies both owners and rejects subclass source mismatch',async()=>{
 const data=examples(),child={kind:'class',name:'冠军',shortName:'冠军',ENG_name:'Champion',source:'PHB',className:'战士',classSource:'PHB'};
 data.push(child,{name:'重击',ENG_name:'Improved Critical',source:'PHB',className:'战士',classSource:'PHB',subclassShortName:'冠军',subclassSource:'PHB',level:3});
 const f=providerFixture(data),p=provider(f);await p.refresh([f.items.at(-1)]);
 const entry=p.records.get(f.items.at(-1).uuid);assert.equal(entry.status,'ready');
 assert.deepEqual(entry.context.owners,[{type:'subclass',identifier:'champion',classIdentifier:'fighter'}]);
 child.classSource='XPHB';const bad=providerFixture(data),q=provider(bad);await q.refresh([bad.items.at(-1)]);assert.equal(q.records.get(bad.items.at(-1).uuid).warning,'provider-identity');
});
test('native rule reads keep content separate from implementation, use visible progression metadata and reject revocation',async()=>{
 let visible=true,resolve;const gate=new Promise(r=>resolve=r);
 const doc={system:{description:{value:'<p>Reroll a save.</p><script>unsafe()</script><p>Two uses at level 13.</p>'},uses:{max:'@scale.fighter.resolve',recovery:[{period:'lr'}]}}};
 const item={...native,uuid:'Compendium.test.features.Item.native',package:'test.features'};
 const owner={uuid:'Item.fighter',name:'Fighter',documentType:'Item',subType:'class',system:{identifier:'fighter',source:{rules:'2014'},advancement:[{type:'ScaleValue',configuration:{identifier:'resolve',scale:{9:{value:1},13:{value:2}}}}]}};
 const pack={get visible(){return visible;},async getDocument(){await gate;return doc;}};
 const s=new CatalogService({index:()=>({results:[{item:owner},...(visible?[{item}]:[])]}),environment:()=>({system:{id:'dnd5e'},packs:new Map([['test.features',pack]])}),load:()=>null,save:async v=>v});
 const pending=s.loadRuleEvidence([item.uuid]);resolve();const [e]=await pending;
 assert.match(e.text,/Two uses/);assert.doesNotMatch(e.text,/unsafe/);assert.equal(e.progressions[0].scale['13'].value,2);assert.equal(e.usage.max,'@scale.fighter.resolve');
 const later=s.loadRuleEvidence([item.uuid]);visible=false;await assert.rejects(later,{code:'preview-stale'});
});

test('provider metadata cannot override explicit native identity or edition fields',async()=>{
 const f=providerFixture(examples()),p=provider(f);await p.refresh(f.items);
 f.items[1].system={identifier:'another-feature'};
 assert.equal(describeGroupingIndex(f.items.map(item=>({item})),environment(p)).get(f.items[1].uuid).warning,'context-conflict');
 f.items[1].system={source:{rules:'2024'}};
 assert.equal(describeGroupingIndex(f.items.map(item=>({item})),environment(p)).get(f.items[1].uuid).warning,'edition');
});
test('silent loss of a progression source during a rule read retracts its evidence too',async()=>{
 let allowed=true,resolve;const gate=new Promise(r=>resolve=r),item={...native,uuid:'Compendium.test.features.Item.n',package:'test.features'};
 const owner={uuid:'Item.fighter',name:'Hidden parent',documentType:'Item',subType:'class',system:{identifier:'fighter',source:{rules:'2014'},advancement:[{type:'ScaleValue',configuration:{identifier:'resolve',scale:{9:{value:1}}}}]}};
 const pack={visible:true,async getDocument(){await gate;return {system:{uses:{max:'@scale.fighter.resolve'}}};}};
 const s=new CatalogService({index:()=>({results:[{item},...(allowed?[{item:owner}]:[])]}),environment:()=>({system:{id:'dnd5e'},packs:new Map([['test.features',pack]])}),load:()=>null,save:async v=>v});
 const pending=s.loadRuleEvidence([item.uuid]);allowed=false;resolve();await assert.rejects(pending,{code:'preview-stale'});
});
