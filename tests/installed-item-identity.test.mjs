import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {calculateGrouping} from '../module/scripts/catalog/identity.mjs';

import {installedCnFixture} from './installed-cn-fixture.mjs';
import {createPlutoniumCnProvider} from '../module/scripts/providers/plutonium-cn.mjs';
import {CatalogService} from '../module/scripts/catalog/service.mjs';

const data = process.env.FOUNDRY_DATA_DIR, level = process.env.CLASSIC_LEVEL_PATH;
test('installed Indomitable metadata groups native and GPS implementations in separate 2014 and 2024 families', {
  skip: !(data && level) && 'set FOUNDRY_DATA_DIR and CLASSIC_LEVEL_PATH; original databases are never opened'
}, async t => {
  const {ClassicLevel} = createRequire(import.meta.url)(level);
  const temporary=await mkdtemp(join(tmpdir(),'truesight-identity-'));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const rows=[],packs=new Map(),modules=new Map();let system;
  for(const [packageType,packageName,names] of [
    ['system','dnd5e',['classes','classfeatures','classes24']],
    ['module','gambits-premades',['gps-class-features','gps-class-features-2024']]
  ]) {
    const root=join(data,packageType==='system'?'systems':'modules',packageName);
    const manifest=JSON.parse(await readFile(join(root,packageType+'.json'),'utf8'));
    if(packageType==='system')system=manifest;else modules.set(packageName,manifest);
    for(const name of names) {
      const pack=manifest.packs.find(p=>p.name===name);assert.ok(pack,name);
      const directory=join(temporary,packageName+'.'+name);
      await cp(join(root,pack.path),directory,{recursive:true});
      const db=new ClassicLevel(directory,{valueEncoding:'json',readOnly:true});
      try {
        const index=new Map(),id=packageName+'.'+name;
        for await(const [key,doc] of db.iterator()) {
          if(!key.startsWith('!items!'))continue;
          const system=Object.fromEntries(['identifier','source','level','school','type','requirements','prerequisites','advancement','classIdentifier','rarity','magicalBonus']
            .filter(k=>doc.system?.[k]!==undefined).map(k=>[k,doc.system[k]]));
          const entry={_id:doc._id,name:doc.name,type:doc.type,system,originalName:doc.name};index.set(entry._id,entry);
          rows.push({item:{uuid:`Compendium.${id}.Item.${entry._id}`,package:id,documentType:'Item',subType:entry.type,...entry}});
        }
        packs.set(id,{title:pack.label,metadata:{...pack,packageType,packageName},index});
      } finally {await db.close();}
    }
  }
  const environment={system,packs,modules},control=calculateGrouping(rows,environment);
  for(const rules of ['2014','2024']) {
    const entries=rows.filter(({item})=>item.name==='Indomitable'&&item.system.source?.rules===rules);
    assert.ok(entries.some(({item})=>item.package.startsWith('dnd5e.')),rules);
    assert.ok(entries.some(({item})=>item.package.startsWith('gambits-premades.')),rules);
    const keys=new Set(entries.map(({item})=>control.records[item.uuid].key));
    assert.equal(keys.size,1,rules);assert.ok([...keys][0],rules);
    const group=control.groups[[...keys][0]];assert.equal(group.rules,rules);assert.equal(group.kind,'feat');
    assert.equal(group.context.level,9);assert.deepEqual(group.context.owners,[{type:'class',identifier:'fighter',classIdentifier:null}]);
  }
  // Simulate translated display projections; original identity metadata and
  // native UUIDs remain those read above. This is not a live Babele/UI test.
  const translated=structuredClone(rows);
  for(const [i,row] of translated.filter(({item})=>item.name==='Indomitable').entries())row.item.name=i%2?'不屈':'不屈 Indomitable';
  const result=calculateGrouping(translated,environment);
  assert.deepEqual(result.groups,control.groups);
  assert.ok(translated.some(({item})=>item.name==='不屈'));
});


test('installed CN protocol joins fighter copies and exposes the actual sidekick progression difference', {
 skip: !(data && level) && 'set FOUNDRY_DATA_DIR and CLASSIC_LEVEL_PATH'
},async t=>{
 const f=await installedCnFixture(data),provider=createPlutoniumCnProvider({module:()=>({active:true}),capabilities:()=>f.api});
 await provider.refresh(f.items);
 assert.equal([...provider.records.values()].every(e=>e.status==='ready'),true,JSON.stringify([...provider.records]));
 const {ClassicLevel}=createRequire(import.meta.url)(level),temporary=await mkdtemp(join(tmpdir(),'truesight-cn-'));
 t.after(()=>rm(temporary,{recursive:true,force:true}));
 const rows=f.items.map(item=>({item})),packs=new Map(),documents=new Map();
 for(const [type,name,packNames] of [['system','dnd5e',['classes','classfeatures']],['module','gambits-premades',['gps-class-features']],['module','dnd-tashas-cauldron',['tcoe-character-options']]]) {
   const root=join(data,type==='system'?'systems':'modules',name),manifest=JSON.parse(await readFile(join(root,type+'.json'),'utf8'));
   for(const packName of packNames) {
     const pack=manifest.packs.find(p=>p.name===packName),id=name+'.'+packName,dir=join(temporary,id),index=new Map();
     await cp(join(root,pack.path),dir,{recursive:true});const db=new ClassicLevel(dir,{valueEncoding:'json',readOnly:true});
     try{for await(const [key,doc]of db.iterator())if(key.startsWith('!items!')) {
       const uuid=`Compendium.${id}.Item.${doc._id}`;documents.set(uuid,doc);index.set(doc._id,doc);
       rows.push({item:{uuid,package:id,name:doc.name,originalName:doc.name,documentType:'Item',subType:doc.type,system:doc.system}});
     }}finally{await db.close();}
     packs.set(id,{visible:true,title:pack.label,index,metadata:{...pack,packageName:name,packageType:type},getDocument:async key=>documents.get(`Compendium.${id}.Item.${key}`)});
   }
 }
 const env={system:{id:'dnd5e'},packs,externalIdentities:provider.records};
 const result=calculateGrouping(rows,env),phb=f.items.find(i=>i.subType==='feat'&&i.source==='PHB'),sidekick=f.items.find(i=>i.subType==='feat'&&i.source==='TCE');
 const native='Compendium.dnd5e.classfeatures.Item.653ZHbNcmm7ZGXbw',gps='Compendium.gambits-premades.gps-class-features.Item.DIVpjryena0RUsrk',tcoe='Compendium.dnd-tashas-cauldron.tcoe-character-options.Item.tcoeWarriorIndom';
 assert.ok(result.records[phb.uuid].key);assert.equal(result.records[phb.uuid].key,result.records[native].key);assert.equal(result.records[gps].key,result.records[native].key);
 assert.notEqual(result.records[sidekick.uuid].key,result.records[phb.uuid].key);assert.notEqual(result.records[tcoe].key,result.records[phb.uuid].key);
 const service=new CatalogService({index:()=>({results:rows}),environment:()=>env,load:()=>null,save:async v=>v});
 const [fighterRules,sidekickRules,nativeRules,tcoeRules]=await service.loadRuleEvidence([phb.uuid,sidekick.uuid,native,tcoe]);
 assert.match(fighterRules.text,/13/);assert.match(fighterRules.text,/17/);assert.match(sidekickRules.text,/18/);
 assert.match(nativeRules.text,/13/);assert.match(nativeRules.text,/17/);assert.match(tcoeRules.text,/18/);
 assert.equal(nativeRules.usage.max,'@scale.fighter.indomitable');assert.equal(tcoeRules.usage.max,'@scale.warrior.indomitable');
 assert.ok(nativeRules.progressions.length);assert.ok(tcoeRules.progressions.length);
 assert.ok(nativeRules.progressions.some(p=>p.scale['13']));assert.ok(tcoeRules.progressions.some(p=>p.scale['18']));
});
