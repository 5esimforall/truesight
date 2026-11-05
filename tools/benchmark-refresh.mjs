// Synthetic metadata only. This measures local JS/fixture work, not Foundry,
// network, translated packs, or actual Quick Insert search implementation cost.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createRuntime} from '../module/scripts/runtime.mjs';
const size=Number(process.argv[2] ?? 20000);
if (!Number.isInteger(size) || size<2 || size>100000) throw Error('Expected 2..100000 synthetic entries');
const rows=Array.from({length:size},(_,i)=>({item:{uuid:`Compendium.fixture.spells.Item.s${i}`,package:'fixture.spells',name:`Spell ${Math.floor(i/2)}`,
  documentType:'Item',subType:'spell',system:{identifier:`spell-${Math.floor(i/2)}`,source:{book:'PHB',rules:'2014'},level:1,school:'abj'}}}));
const settings=new Map(), hooks={on:()=>1,off:()=>{},callAll:()=>{}};
const game={ready:true,world:{id:'fixture'},user:{id:'fixture',isGM:true},system:{id:'dnd5e'},i18n:{lang:'en',localize:k=>k},
  modules:new Map([['quick-insert',{active:true}]]),packs:new Map([['fixture.spells',{visible:true}]]),
  settings:{register:()=>{},get:(id,key)=>settings.get(id+'.'+key),set:async(id,key,value)=>settings.set(id+'.'+key,value)}};
let scans=0,normalizations=0;
const qi={hasIndex:true,search:()=>{scans++;return rows;}};
const service=createRuntime({game,hooks,config:{Item:{compendiumIndexFields:[]},Actor:{compendiumIndexFields:[]}},quickInsert:()=>qi,parser:()=>null});
const environment=service.environment;service.environment=()=>{normalizations++;return environment();};
const samples=[];
const measure=(operation,run)=>{const start=performance.now(),beforeScans=scans,beforeNormalizations=normalizations;run();samples.push({operation,ms:+(performance.now()-start).toFixed(2),scans:scans-beforeScans,normalizations:normalizations-beforeNormalizations});};
measure('100 status queries',()=>{for(let i=0;i<100;i++)service.getStatus();});assert.equal(scans,0);
measure('cold read',()=>service.read());assert.equal(scans,1);
measure('20 cached reads',()=>{for(let i=0;i<20;i++)service.read();});assert.equal(scans,1);assert.equal(normalizations,1);
measure('preview reusing normalized metadata',()=>service.preview());assert.equal(normalizations,1);
measure('unrelated HP update + read',()=>{service.invalidate('hp',[]);service.read();});assert.equal(scans,1);
measure('relevant rename + read',()=>{rows[0].item.name='Renamed';service.invalidate('name',['names']);service.read();});assert.equal(scans,2);
measure('permission revocation without hook + read',()=>{game.packs.get('fixture.spells').visible=false;assert.equal(service.read().entries.size,0);});assert.equal(scans,2);
service.destroy();
console.log(JSON.stringify({kind:'synthetic-fixture-not-live-performance',entries:size,node:process.version,samples},null,2));
