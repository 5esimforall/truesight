import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateGrouping, describeGroupingIndex, GROUP_INDEX_FIELDS, GROUP_RULE_VERSION} from '../module/scripts/catalog/identity.mjs';
import {ITEM_TYPES, DOCUMENT_TYPES} from '../module/scripts/catalog/item-identity.mjs';
import {CatalogService} from '../module/scripts/catalog/service.mjs';
import {validSnapshot, readReview} from '../module/scripts/catalog/state.mjs';
import {reviewRows} from '../module/scripts/review-model.mjs';
import {classifyChange} from '../module/scripts/changes.mjs';
import {spell} from './catalog-fixture.mjs';
const environment = {system:{id:'dnd5e'},packs:new Map(),modules:new Map()};
const uuid = id => `Compendium.fixture.items.Item.${id}`;
function item(id, type='feat', system={}, patch={}) {
  return {item:{uuid:uuid(id),name:'不屈',originalName:'Indomitable',documentType:'Item',subType:type,
    system:{identifier:'indomitable',source:{rules:'2024'},type:{value:'class',subtype:''},
      requirements:'Fighter',prerequisites:{level:9,items:[]},...system},...patch}};
}
function fighter(rules='2024', grants=[]) {
  return item('fighter'+rules,'class',{identifier:'fighter',source:{rules},type:undefined,requirements:undefined,
    advancement:grants.map(id=>({type:'ItemGrant',level:9,configuration:{items:[{uuid:uuid(id)}]}}))},
    {name:'战士 Fighter',originalName:'Fighter'});
}
function indomitable() {
  return [fighter('2024',['native']),fighter('2014'),
    item('native','feat',{requirements:''}),item('gps','feat',{}, {name:'Indomitable'}),
    item('cn','feat',{requirements:'战士'}, {name:'不屈 Indomitable'}),
    item('old','feat',{source:{rules:'2014'},requirements:'Fighter 9',prerequisites:{level:null}}),
    item('oldGps','feat',{source:{rules:'2014'}})];
}
const groups = rows => Object.values(calculateGrouping(rows,environment).groups);
const record = (snapshot,id) => snapshot.records[uuid(id)];
function service(rows, saved=null) {
  return new CatalogService({index:()=>({results:rows}),environment:()=>environment,load:()=>saved,save:async x=>x});
}

test('Indomitable normalizes grants, bilingual class names and numbered requirements without crossing generations',()=>{
  const rows=indomitable(),before=structuredClone(rows),snapshot=calculateGrouping(rows,environment);
  const featureGroups=Object.values(snapshot.groups).filter(g=>g.kind==='feat');
  assert.equal(featureGroups.length,2);
  assert.deepEqual(featureGroups.find(g=>g.rules==='2024').members,[uuid('cn'),uuid('gps'),uuid('native')]);
  assert.deepEqual(featureGroups.find(g=>g.rules==='2014').members,[uuid('old'),uuid('oldGps')]);
  assert.equal(featureGroups[0].context.level,9);
  assert.deepEqual(featureGroups[0].context.owners,[{type:'class',identifier:'fighter',classIdentifier:null}]);
  assert.equal(featureGroups[0].reason,'item-identity');
  assert.deepEqual(rows,before);assert.ok(validSnapshot(snapshot));
});

test('every known Item type has a grouping policy, including registered extension types',()=>{
  const declared=Object.fromEntries([...ITEM_TYPES,'custom-item'].map(t=>[t,{}]));
  for(const type of Object.keys(declared)) {
    const system={identifier:'example-'+type,requirements:'',prerequisites:{level:1},
      type:{value:type==='feat'?'feat':'example',subtype:'',baseItem:''},
      classIdentifier:type==='subclass'?'fighter':undefined,level:1,school:'abj'};
    const snapshot=calculateGrouping([item('a',type,system),item('b',type,system)],{...environment,system:{id:'dnd5e',documentTypes:{Item:declared}}});
    assert.equal(Object.keys(snapshot.groups).length,1,type);assert.ok(record(snapshot,'a').key,type);assert.ok(validSnapshot(snapshot),type);
  }
});

test('unknown types, missing category, identifier, edition and ownership are distinct and all counted',()=>{
  const rows=[item('unknown','future'),item('category','feat',{type:{}}),
    item('id','class',{identifier:''}),item('edition','class',{source:{}}),
    item('owner','feat',{requirements:''}),item('only','background')];
  const snapshot=calculateGrouping(rows,environment);
  assert.deepEqual(rows.map(r=>snapshot.records[r.item.uuid].reason),['unknown-type','type-context','identifier','rules','owner-context','no-match']);
  assert.equal(Object.keys(snapshot.records).length,rows.length);
  const s=service(rows);const preview=s.preview();assert.equal(preview.diff.independent,rows.length);
  assert.deepEqual(preview.independent.map(e=>e.reason),rows.map(r=>snapshot.records[r.item.uuid].reason));s.dispose();
});

test('same slug never joins different owners, subtypes, levels, physical variants or generations',()=>{
  const rows=indomitable();
  rows.push(item('wizard','class',{identifier:'wizard'}, {name:'Wizard',originalName:'Wizard'}));
  rows.push(item('wrongOwner','feat',{requirements:'Wizard'}),item('wrongLevel','feat',{prerequisites:{level:13}}),
    item('wrongSubtype','feat',{type:{value:'class',subtype:'maneuver'}}));
  const snapshot=calculateGrouping(rows,environment);
  for(const id of ['wrongOwner','wrongLevel','wrongSubtype']) {
    assert.equal(record(snapshot,id).key,null);assert.equal(record(snapshot,id).reason,'context-difference');
  }
  for(const [field,value] of [['rarity','rare'],['magicalBonus',1],['type',{value:'martialM',baseItem:'longsword'}]]) {
    const physical=[item('a','weapon',{type:{value:'simpleM'},rarity:'common',magicalBonus:0}),
      item('b','weapon',{type:{value:'simpleM'},rarity:'common',magicalBonus:0,[field]:value})];
    assert.equal(groups(physical).length,0,field);
  }
  assert.equal(groups([item('a','class'),item('b','background')]).length,0);
});

test('conflicting ownership, prerequisite levels and translated owner ambiguity fail closed',()=>{
  const rows=[fighter('2024',['conflict']),item('wizard','class',{identifier:'wizard'},{name:'Wizard',originalName:'Wizard'}),
    item('conflict','feat',{requirements:'Wizard'}),item('level','feat',{requirements:'Fighter 13'}),
    item('ambiguous','class',{identifier:'other-fighter'},{name:'战士',originalName:'Other Fighter'}),
    item('cn','feat',{requirements:'战士'})];
  const snapshot=calculateGrouping(rows,environment);
  for(const id of ['conflict','level','cn'])assert.equal(record(snapshot,id).reason,'context-conflict');
});

test('subclass ownership refines a matching class requirement but cannot bridge unrelated classes',()=>{
  const champion=item('champion','subclass',{identifier:'champion',classIdentifier:'fighter',advancement:[
    {type:'ItemGrant',level:9,configuration:{items:[{uuid:uuid('a')},{uuid:uuid('b')}]}}]}, {name:'Champion',originalName:'Champion'});
  const rows=[fighter(),champion,item('a'),item('b')];
  const group=groups(rows).find(g=>g.kind==='feat');
  assert.deepEqual(group.context.owners,[{type:'subclass',identifier:'champion',classIdentifier:'fighter'}]);
  champion.item.system.classIdentifier='wizard';assert.equal(groups(rows).filter(g=>g.kind==='feat').length,0);
});

test('ItemChoice, arbitrary text and automation flags do not prove feature ownership',()=>{
  const parent=fighter('2024',['a']);parent.item.system.advancement[0].type='ItemChoice';
  const snapshot=calculateGrouping([parent,item('a','feat',{requirements:''}),item('b','feat',{requirements:'Definitely Fighter-ish'},
    {flags:{'chris-premades':{info:{identifier:'indomitable'}}}})],environment);
  assert.equal(record(snapshot,'a').reason,'owner-context');assert.equal(record(snapshot,'b').reason,'owner-context');
});

test('all known non-Item documents use direct provenance; absent provenance and unknown protocols are distinct',()=>{
  for(const documentType of DOCUMENT_TYPES) {
    const source=`Compendium.fixture.docs.${documentType}.source`;
    const rows=['source','copy'].map(id=>({item:{uuid:`Compendium.fixture.docs.${documentType}.${id}`,documentType,
      subType:'example',name:'Same',_stats:id==='copy'?{compendiumSource:source}:{}}}));
    const snapshot=calculateGrouping(rows,environment);
    assert.equal(Object.keys(snapshot.groups).length,1,documentType);assert.ok(validSnapshot(snapshot),documentType);
    delete rows[1].item._stats.compendiumSource;
    assert.deepEqual(Object.values(calculateGrouping(rows,environment).records).map(r=>r.reason),['origin','origin']);
  }
});

test('applying and reloading records every entry, leaves no supported type perpetually pending and keeps diagnostics consistent',async()=>{
  const rows=[...indomitable(),item('missing','feat',{requirements:''}),item('future','future')];
  const s=service(rows),preview=s.preview();
  assert.equal(s.getMember(uuid('gps')).reason,'awaiting-review');
  await s.apply(preview.id);const view=s.read();
  assert.equal(view.entries.get(uuid('gps')).status,'member');assert.equal(view.entries.get(uuid('missing')).status,'independent');
  assert.equal([...view.entries.values()].filter(e=>e.status==='pending').length,0);
  const actual=reviewRows(view).filter(r=>r.independent).map(r=>[r.key,r.reason]);
  assert.deepEqual(actual,preview.independent.map(r=>[r.uuid,r.reason]));
  const reloaded=service(rows,s.state);assert.equal(reloaded.getMember(uuid('gps')).key,s.getMember(uuid('gps')).key);
  s.dispose();reloaded.dispose();
});

test('owner changes invalidate membership and stale previews; display names and automation versions do not',async()=>{
  const rows=indomitable(),s=service(rows);await s.apply(s.preview().id);const preview=s.preview();
  rows[0].item.system.advancement=[];
  assert.equal(s.getMember(uuid('native')).key,null);
  await assert.rejects(s.apply(preview.id),{code:'preview-stale'});
  const member=s.getMember(uuid('gps'));rows.find(r=>r.item.uuid===uuid('gps')).item.name='显示名';
  assert.equal(s.getMember(uuid('gps')).key,member.key);
  s.dispose();
  for(const field of ['type','requirements','classIdentifier','prerequisites','advancement','rarity','magicalBonus']) {
    assert.ok(classifyChange('updateItem',{type:'feat'},{['system.'+field]:null}).includes('identity'),field);
    assert.ok(GROUP_INDEX_FIELDS.includes('system.'+field),field);
  }
  assert.ok(classifyChange('updateItem',{type:'class'},{name:'战士'}).includes('identity'));
  assert.ok(!classifyChange('updateItem',{type:'feat'},{name:'不屈'}).includes('identity'));
});

test('past rule versions are rejected and invalid-cache reset discards all members and undo instead of migrating',async()=>{
  const old=calculateGrouping([spell('a'),spell('b')],environment);old.ruleVersion=1;
  const persisted={schemaVersion:1,revision:7,active:old,previous:{active:old,excluded:[]},excluded:['old']};
  assert.equal(validSnapshot(old),null);assert.throws(()=>readReview(persisted),/Invalid review cache/);
  const s=service(indomitable(),persisted);
  assert.equal(s.getStatus().reason,'invalid-review');assert.equal(s.state.active,null);assert.equal(s.state.previous,null);
  assert.equal(s.previews.size,0);assert.deepEqual(s.state.excluded,[]);
  await s.discardInvalidReview();assert.equal(s.getStatus().status,'unreviewed');assert.equal(s.state.revision,8);
  assert.equal(s.state.active,null);assert.equal(s.state.previous,null);assert.deepEqual(s.state.excluded,[]);
  assert.equal(s.getMember(uuid('gps')).status,'pending');
  await s.apply(s.preview().id);assert.equal(s.read().groups.size,2);s.dispose();
});

test('reason labels are available in both languages and type coverage follows the installed schema when supplied',()=>{
  const reasons=['unknown-type','type-context','owner-context','context-conflict','context-difference','context-size','origin','awaiting-review'];
  for(const lang of ['cn','en']) {
    const labels=JSON.parse(readFileSync(new URL(`../module/lang/${lang}.json`,import.meta.url)));
    for(const reason of reasons)assert.ok(labels['TRUESIGHT.Grouping.Review.'+reason],lang+':'+reason);
  }
  if(process.env.DND5E_SYSTEM_DIR) {
    const manifest=JSON.parse(readFileSync(process.env.DND5E_SYSTEM_DIR+'/system.json'));
    assert.deepEqual(Object.keys(manifest.documentTypes.Item).sort(),[...ITEM_TYPES].sort());
  }
});

test('malformed metadata, source conflicts and direct provenance never create unsafe feature matches',()=>{
  const rows=[fighter(),
    item('prerequisite','feat',{prerequisites:{items:[{}]}}),item('category','feat',{type:{value:5}}),
    item('bonus','weapon',{type:{value:'simpleM'},magicalBonus:'1'}),
    item('edition','feat',{source:{rules:'2014',book:'PHB 2024'}}),
    item('source','feat',{source:{rules:'2024',book:'PHB 2024',custom:'DMG 2024'}}),
    item('oversized','feat',{type:{value:'feat'},requirements:'x'.repeat(3000)})];
  const snapshot=calculateGrouping(rows,environment);
  for(const id of ['prerequisite','category','bonus'])assert.equal(record(snapshot,id).reason,'type-context');
  assert.equal(record(snapshot,'edition').reason,'edition');assert.equal(record(snapshot,'source').reason,'source');
  assert.equal(record(snapshot,'oversized').reason,'context-size');assert.ok(validSnapshot(snapshot));
  const origin='Compendium.fixture.monsters.Item.bite';
  const monster=[item('a','feat',{type:{value:'monster'},requirements:''},{_stats:{compendiumSource:origin}}),
    item('b','feat',{type:{value:'monster'},requirements:''},{_stats:{compendiumSource:origin}})];
  assert.equal(groups(monster).length,1);
  monster[1].item._stats.compendiumSource='Compendium.fixture.monsters.Actor.bite';
  assert.equal(groups(monster).length,0);
  assert.equal(record(calculateGrouping(monster,environment),'b').reason,'owner-context');
});

test('changing permissions, exclusions, missing members and reload preserve feature review boundaries',async()=>{
  let rows=indomitable();const s=new CatalogService({index:()=>({results:rows}),environment:()=>environment,load:()=>null,save:async x=>x});
  await s.apply(s.preview().id);const key=s.getMember(uuid('gps')).key;
  await s.apply(s.previewExclusion({uuid:uuid('gps'), excluded:true}).id);assert.equal(s.getMember(uuid('gps')).reason,'excluded');await s.undo();
  rows=rows.filter(r=>r.item.uuid!==uuid('cn'));rows.push(item('new'));
  await s.apply(s.preview().id);
  assert.ok(s.state.active.groups[key].members.includes(uuid('cn')));
  assert.equal(s.getMember(uuid('new')).key,null);assert.equal(s.getMember(uuid('new')).reason,'retained-members');
  rows=rows.filter(r=>r.item.uuid!==uuid('fighter2024'));s.invalidate('access',['access']);
  assert.equal(s.getMember(uuid('gps')).key,null);assert.equal(s.getMember(uuid('gps')).reason,'owner-context');
  assert.ok(!s.read().entries.has(uuid('fighter2024')));s.dispose();
});

test('general feats retain class prerequisites as constraints rather than discard unrelated owner fields',()=>{
  const rows=[item('a','feat',{type:{value:'feat'},requirements:'',prerequisites:{items:['class:fighter']}}),
    item('b','feat',{type:{value:'feat'},requirements:'',prerequisites:{items:['class:wizard']}})];
  const snapshot=calculateGrouping(rows,environment);
  assert.equal(Object.keys(snapshot.groups).length,0);assert.equal(record(snapshot,'a').reason,'context-difference');
  const malformed=item('bad','feat',{requirements:5});assert.equal(record(calculateGrouping([fighter(),malformed],environment),'bad').reason,'type-context');
  const custom=calculateGrouping([item('a','custom_type'),item('b','custom_type')],{...environment,system:{id:'dnd5e',documentTypes:{Item:{custom_type:{}}}}});
  assert.equal(Object.keys(custom.groups).length,1);assert.ok(validSnapshot(custom));
});

test('invalid snapshots reject unknown reasons and inappropriate group protocols',()=>{
  const snapshot=calculateGrouping(indomitable(),environment);
  for(const mutate of [
    s=>{record(s,'gps').reason={code:'no-match'};},s=>{record(s,'gps').warning='unrecognized';},
    s=>{Object.values(s.groups)[0].rules=null;},s=>{Object.values(s.groups)[0].reason='source-suffix';},
    s=>{Object.values(s.groups)[0].context=null;}
  ]) {const copy=structuredClone(snapshot);mutate(copy);assert.equal(validSnapshot(copy),null);}
});
