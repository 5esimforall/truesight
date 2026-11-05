import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {calculateGrouping} from '../module/scripts/catalog/identity.mjs';

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
