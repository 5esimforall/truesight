import test from 'node:test';
import assert from 'node:assert/strict';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {calculateGrouping,describeGroupingIndex} from '../module/scripts/catalog/identity.mjs';
import {comparePair,buildNameSets,decisionEvidence} from '../module/scripts/catalog/name-review.mjs';
import {validSnapshot} from '../module/scripts/catalog/state.mjs';
import {spell} from './catalog-fixture.mjs';
const env={system:{id:'dnd5e'},packs:new Map(),modules:new Map()};
const id=n=>`Compendium.fixture.spells.Item.${n}`;
const same=(a,b,extra={})=>({left:id(a),right:id(b),kind:'same',reason:'Reviewed the rule text',...extra});
const different=(a,b)=>same(a,b,{kind:'different',reason:'Different rule variants confirmed from the source text'});
function fixture(rows,load=null){let saved=load;const service=new CatalogService({index:()=>({results:rows}),environment:()=>env,load:()=>saved,save:async value=>(saved=value)});return {service,rows,get saved(){return saved;}};}
const apply=s=>s.apply(s.preview().id);
const pending=s=>s.readNameReview().sets;

test('names normalize lightly, keep qualifiers and use original or corroborated bilingual evidence without transitive closure',()=>{
 const rows=[spell('a',{name:'不屈',originalName:'Indomitable'}),spell('b',{name:'不屈 Indomitable',system:{identifier:'indomitable'}}),
  spell('c',{name:'  ＩＮＤＯＭＩＴＡＢＬＥ  '}),spell('d',{name:'Indomitable (2024)'}),spell('e',{name:'Indomitable 2'})];
 const s=fixture(rows).service;const sets=pending(s);
 assert.ok(sets.some(set=>set.members.length===3));assert.ok(sets.every(set=>!set.members.includes(id('d'))&&!set.members.includes(id('e'))));
 const bridge=fixture([spell('a',{name:'甲',originalName:'One'}),spell('b',{name:'甲',originalName:'Two'}),spell('c',{name:'Two'})]).service;
 assert.deepEqual(pending(bridge).map(s=>s.members.length),[2,2]);assert.equal(pending(bridge).some(s=>s.members.length===3),false);
});

test('generation and object boundaries explain separation; unknown generations and conflicting fields reopen review',()=>{
 const rows=[spell('a'),spell('b',{system:{source:{rules:'2024',book:'PHB 2024'}}})];
 const f=fixture(rows),s=f.service;assert.equal(pending(s).length,0);
 rows.push(spell('c',{system:{source:{}}}));
 const set=pending(s)[0],detail=s.readNameSet(set.key);
 assert.equal(set.members.length,3);assert.deepEqual(detail.pairs.map(p=>p.status),['pending','pending','separate']);
 rows[2].item.system.school='evo';assert.ok(s.readNameSet(pending(s)[0].key).pairs.some(p=>p.clues.some(c=>c.field==='school')));
 const equipment=spell('x',{subType:'weapon',system:{type:{value:'martialM'}}});
 assert.equal(pending(fixture([rows[0],equipment]).service).length,0);
 const conflicted=spell('y',{system:{source:{rules:'2014',book:'PHB 2024'}}});
 assert.equal(pending(fixture([rows[0],conflicted]).service).length,1);
});

test('owner, level, prerequisite, identifier and provider differences remain review clues',()=>{
 const rows=[spell('a',{subType:'feat',system:{type:{value:'class'},requirements:'Fighter 9'}}),
 spell('b',{subType:'feat',system:{identifier:'other',type:{value:'class'},requirements:'Barbarian 13'}})];
 const s=fixture(rows).service,set=pending(s)[0];assert.equal(set.members.length,2);
 const pair=s.readNameSet(set.key).pairs[0];assert.equal(pair.status,'pending');
 assert.ok(pair.clues.some(c=>c.field==='requirements'));assert.ok(pair.clues.some(c=>c.field==='identifier'));
 assert.ok(pair.clues.some(c=>c.kind==='diagnostic'));
});

test('applied groups disappear, orphans and separate same-name groups are shown without changing consumer membership',async()=>{
 const rows=[spell('a'),spell('b'),spell('c',{system:{identifier:'another'}})],s=fixture(rows).service;
 await apply(s);assert.equal(s.read().groups.size,1);assert.equal(pending(s)[0].members.length,3);assert.equal(pending(s)[0].groupCount,1);
 assert.equal(s.getMember(id('c')).key,null);
 rows.push(spell('d',{system:{identifier:'another'}}));await apply(s);assert.equal(pending(s)[0].groupCount,2);
 rows.splice(2);assert.equal(pending(s).length,0);
});

test('same-content confirmation previews full affected groups, preserves conflicts, applies atomically and supports undo/reload/recalculate',async()=>{
 const rows=[spell('a'),spell('b'),spell('c',{system:{identifier:'another',school:'evo'}})];
 const f=fixture(rows),s=f.service;await apply(s);const before=s.read();
 const preview=s.previewNameDecision(same('a','c'));assert.deepEqual(preview.decision.members,[id('a'),id('b'),id('c')]);
 assert.equal(s.getMember(id('c')).key,null);assert.equal(pending(s).length,1);
 assert.equal(s.readNameReview({previewId:preview.id}).count,0);
 assert.ok(preview.decision.clues.some(pair=>pair.clues.some(c=>c.field==='school')));
 await s.apply(preview.id);assert.equal(pending(s).length,0);assert.equal(s.read().groups.size,1);
 const key=s.getMember(id('a')).key;assert.equal(s.getMember(id('c')).key,key);assert.equal(s.getMember(id('c')).names[0],'Example Spell');
 assert.ok(validSnapshot(f.saved.active));
 const reload=fixture(rows,f.saved).service;assert.equal(reload.getMember(id('c')).key,key);
 await apply(reload);assert.equal(reload.getMember(id('c')).key,key);
 await s.undo();assert.deepEqual(s.read().groups,before.groups);assert.equal(s.getMember(id('c')).key,null);
});

test('manual confirmation can resolve missing identity or conflicting metadata without erasing diagnostics',async()=>{
 const rows=[spell('a',{system:{school:'invalid'}}),spell('b',{system:{source:{}}})];
 const s=fixture(rows).service,p=s.previewNameDecision(same('a','b'));await s.apply(p.id);
 assert.ok(s.getMember(id('a')).key);assert.equal(s.getMember(id('a')).warning,'spell');assert.equal(pending(s).length,0);
 rows[0].item.system.school='abj';assert.equal(s.getMember(id('b')).key,null,'the entire manual decision expires');assert.equal(pending(s).length,1);
});

test('different-content decision has a reason, persists, invalidates with evidence, and never approves unrelated groups',async()=>{
 const rows=[spell('a'),spell('b'),spell('unrelated1',{name:'Other'}),spell('unrelated2',{name:'Other'})];
 const f=fixture(rows),s=f.service,p=s.previewNameDecision(different('a','b'));
 assert.equal(s.read().groups.size,0);assert.equal(p.groups.length,0);
 await s.apply(p.id);assert.equal(s.read().groups.size,0);assert.equal(pending(s).length,1);assert.equal(pending(s)[0].name,'Other');
 const reload=fixture(rows,f.saved).service;await apply(reload);
 assert.equal(reload.getMember(id('a')).key,null);assert.equal(reload.getMember(id('b')).key,null);assert.equal(reload.read().groups.size,1);
 rows[0].item.system.level=5;assert.ok(pending(reload).some(set=>set.members.includes(id('a'))));
 await s.undo();assert.equal(s.state.active,null);
});

test('old and malformed decisions are rejected rather than migrated',async()=>{
 const f=fixture([spell('a'),spell('b')]);await f.service.apply(f.service.previewNameDecision(different('a','b')).id);
 assert.ok(validSnapshot(f.saved.active));
 for(const mutate of [s=>delete s.decisions,s=>s.ruleVersion=2,s=>s.decisions[0].members.push('not-indexed'),s=>s.decisions[0].reason='',s=>s.decisions[0].evidence={},s=>s.decisions[0].kind='merge']) {
  const state=structuredClone(f.saved.active);mutate(state);assert.equal(validSnapshot(state),null);
 }
});

test('permissions, publication, names and stale index evidence guard both decision types',async()=>{
 const rows=[spell('a'),spell('b')],s=fixture(rows).service;
 for(const request of [same('a','a'),same('a','b',{reason:''}),same('a','b',{kind:'invalid'}),same('a','b',{extra:1})])assert.throws(()=>s.previewNameDecision(request),{code:'invalid-decision'});
 const p=s.previewNameDecision(different('a','b'));rows[0].item.system.level=5;
 await assert.rejects(s.apply(p.id),{code:'preview-stale'});
 const next=s.previewNameDecision(different('a','b'));s.publication=()=>({canPublish:false});await assert.rejects(s.apply(next.id),{code:'review-forbidden'});
 s.canManage=()=>false;assert.throws(()=>s.readNameReview(),{code:'review-forbidden'});assert.throws(()=>s.readNameSet('name'),{code:'review-forbidden'});assert.throws(()=>s.previewNameDecision(different('a','b')),{code:'review-forbidden'});
});

test('explicit generation boundaries and exclusions cannot be bypassed through a manual merge',async()=>{
 const s=fixture([spell('a'),spell('b',{system:{source:{rules:'2024',book:'PHB 2024'}}})]).service;
 assert.throws(()=>s.previewNameDecision(same('a','b')),{code:'separation-conflict'});
 const f=fixture([spell('a'),spell('b'),spell('c',{system:{identifier:'another'}})]);await apply(f.service);await f.service.apply(f.service.previewExclusion({uuid:id('a'), excluded:true}).id);
 assert.throws(()=>f.service.previewNameDecision(same('a','c')),{code:'excluded-decision'});
 assert.equal(pending(f.service).length,1,'exclusion does not confirm distinct identity');
});

test('pair detail pagination is bounded and each relationship remains accessible',()=>{
 const rows=Array.from({length:20},(_,i)=>spell('x'+i)),s=fixture(rows).service,key=pending(s)[0].key;
 const first=s.readNameSet(key,{limit:7}),second=s.readNameSet(key,{offset:7,limit:7});assert.equal(first.total,190);assert.equal(first.pairs.length,7);
 assert.notDeepEqual(first.pairs,second.pairs);assert.equal(s.readNameSet(key,{offset:189,limit:7}).pairs.length,1);
 assert.throws(()=>s.readNameSet(key,{limit:101}),{code:'invalid-options'});
});

test('saved decisions can be inspected and explicitly revoked after later reviews, with preview and undo',async()=>{
 const rows=[spell('a'),spell('b')],f=fixture(rows),s=f.service;
 await s.apply(s.previewNameDecision(different('a','b')).id);await apply(s);
 const d=s.readNameDecisions()[0];assert.equal(d.current,true);assert.equal(d.kind,'different');
 const revoke=s.previewNameDecision({kind:'revoke',key:d.key});assert.equal(s.readNameDecisions().length,1);
 await s.apply(revoke.id);assert.equal(s.readNameDecisions().length,0);assert.equal(pending(s).length,1);
 await s.undo();assert.equal(s.readNameDecisions().length,1);assert.equal(pending(s).length,0);
 rows[0].item.system.school='evo';assert.equal(s.readNameDecisions()[0].current,false);
 const sameFixture=fixture([spell('a'),spell('b')]);const ss=sameFixture.service;
 await ss.apply(ss.previewNameDecision(same('a','b')).id);
 const key=ss.readNameDecisions()[0].key;await ss.apply(ss.previewNameDecision({kind:'revoke',key}).id);
 assert.equal(ss.read().groups.size,0);assert.equal(pending(ss).length,1);assert.ok(validSnapshot(sameFixture.saved.active));
});

test('names, access changes and newly separated evidence stale previews, and hidden decisions never leak through review APIs',async()=>{
 for(const change of [rows=>rows.pop(),rows=>rows[0].item.name='Different',rows=>rows[0].item.system.source={rules:'2024',book:'PHB 2024'}]) {
  const rows=[spell('a'),spell('b')],s=fixture(rows).service,p=s.previewNameDecision(same('a','b'));change(rows);
  await assert.rejects(s.apply(p.id),{code:'preview-stale'});assert.equal(s.state.active,null);
 }
 const rows=[spell('a'),spell('b')],f=fixture(rows),s=f.service;await s.apply(s.previewNameDecision(different('a','b')).id);
 rows.pop();assert.equal(s.readNameDecisions().length,0);assert.equal(s.readNameReview().entries,0);
 assert.throws(()=>s.previewNameDecision({kind:'revoke',key:f.saved.active.decisions[0].key}),{code:'name-set-unavailable'});
});

test('missing members in an existing group prevent partial manual merges and failed writes preserve both review and decisions',async()=>{
 const rows=[spell('a'),spell('b'),spell('c',{system:{identifier:'another'}})],f=fixture(rows),s=f.service;
 await apply(s);rows.splice(1,1);assert.throws(()=>s.previewNameDecision(same('a','c')),{code:'incomplete-group'});
 rows.splice(1,0,spell('b'));const before=structuredClone(s.state),p=s.previewNameDecision(same('a','c'));
 s.save=async()=>{throw Error('offline');};await assert.rejects(s.apply(p.id),/offline/);assert.deepEqual(s.state,before);assert.equal(s.readNameDecisions().length,0);
});

test('separation decisions preview both complete sides and preserve them across recalculation without repeated pair confirmations',async()=>{
 const rows=[spell('a'),spell('b'),spell('c',{system:{identifier:'another'}})],f=fixture(rows),s=f.service;await apply(s);
 const p=s.previewNameDecision(different('a','c'));assert.equal(p.decision.members.length,3);assert.deepEqual(p.decision.sides,[[id('a'),id('b')],[id('c')]]);
 await s.apply(p.id);assert.equal(pending(s).length,0);await apply(s);assert.equal(pending(s).length,0);assert.equal(s.getMember(id('a')).key,s.getMember(id('b')).key);
 assert.ok(validSnapshot(f.saved.active));
 // Explicit decisions still prevent automatic regrouping when contexts match.
 const auto=fixture([spell('a'),spell('b'),spell('c')]);
 const ss=auto.service;await ss.apply(ss.previewNameDecision(same('a','b')).id);await ss.apply(ss.previewNameDecision(different('a','c')).id);
 await apply(ss);assert.equal(ss.getMember(id('a')).key,ss.getMember(id('b')).key);assert.equal(ss.getMember(id('c')).key,null);assert.equal(pending(ss).length,0);
 assert.ok(validSnapshot(auto.saved.active));
});

test('Set-valued prerequisites are plain detached evidence and changes reopen an otherwise incomplete identity',async()=>{
 const rows=[spell('a',{subType:'feat',system:{type:{value:'class'},prerequisites:{items:new Set(['feat:one'])}}}),spell('b',{subType:'feat',system:{type:{value:'class'},prerequisites:{items:new Set(['feat:one'])}}})];
 const s=fixture(rows).service,key=pending(s)[0].key,e=s.readNameSet(key).evidence[id('a')];
 assert.deepEqual(e.fields.prerequisites.items,['feat:one']);
 await s.apply(s.previewNameDecision(different('a','b')).id);assert.equal(pending(s).length,0);
 rows[0].item.system.prerequisites.items.add('feat:two');assert.equal(pending(s).length,1);
});

test('a name-only evidence change invalidates the whole manual group with a concrete identity diagnostic',async()=>{
 const rows=[spell('a',{originalName:'Example Spell'}),spell('b',{originalName:'Example Spell'})],s=fixture(rows).service;
 await s.apply(s.previewNameDecision(same('a','b')).id);
 rows[0].item.name='另一个译名';
 for(const id of rows.map(row=>row.item.uuid)){const entry=s.getMember(id);assert.equal(entry.key,null);assert.equal(entry.reason,'identity');assert.equal(entry.status,'invalidated');}
 assert.equal(pending(s).length,1);assert.equal(s.read().changed,2);
});
