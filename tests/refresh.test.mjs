import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshQueue} from '../module/scripts/names/refresh.mjs';
import {createCorpusLoader} from '../module/scripts/names/corpus.mjs';
const deferred = () => {let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick = () => new Promise(resolve=>setTimeout(resolve,0));

test('refresh bursts run once, keep at most one successor, and stop prevents publication', async () => {
  let starts=0, active=0, maximum=0, invalidations=0;
  const gates=[],published=[];
  const queue=createRefreshQueue({invalidate:()=>invalidations++,build:async isCurrent=>{
    const id=++starts;maximum=Math.max(maximum,++active);const gate=deferred();gates.push(gate);
    await gate.promise;active--;if(isCurrent())published.push(id);
  }});
  const burst=Array.from({length:50},()=>queue.request());
  await tick();assert.equal(starts,1);
  for(let i=0;i<50;i++)queue.request();
  gates[0].resolve();await tick();assert.equal(starts,2);assert.deepEqual(published,[]);
  gates[1].resolve();await Promise.all(burst);
  assert.deepEqual(published,[2]);assert.equal(maximum,1);assert.equal(invalidations,100);
  const stopped=queue.request();queue.stop();await stopped;assert.equal(starts,2);
  const later=queue.request();await tick();queue.stop();gates[2].resolve();await later;assert.deepEqual(published,[2]);
});
test('failed refresh releases the running slot for an explicit retry', async () => {
  let fail=true, count=0;
  const queue=createRefreshQueue({invalidate:()=>{},build:async()=>{count++;if(fail)throw Error('offline');}});
  await assert.rejects(queue.request(),/offline/);fail=false;await queue.request();assert.equal(count,2);
});
test('corpus requests merge fields, share one read, and return detached evidence without provider plans', async () => {
  let revision=0,reads=0;const requested=[];
  const load=createCorpusLoader({key:()=>revision,read:async({fields})=>{
    reads++;requested.push(fields);return {indexes:new Map([['p',new Map([['x',{name:'Name',flags:{provider:{id:'x'}}}]])]]),catalogFor:()=>new Map()};
  }});
  const [a,b,c]=await Promise.all([load({fields:['one']}),load({fields:['two']}),load()]);
  assert.equal(reads,1);assert.deepEqual(requested,[['one','two']]);
  a.indexes.get('p').get('x').flags.provider.id='changed';
  assert.equal(b.indexes.get('p').get('x').flags.provider.id,'x');assert.notEqual(a.indexes,c.indexes);
  await load();assert.equal(reads,1);revision++;assert.equal(a.isCurrent(),false);await load();assert.equal(reads,2);
});
test('permission/revision and field changes during a read discard old results and serialize the latest read', async () => {
  let revision=0,reads=0,active=0,max=0;const gates=[];
  const load=createCorpusLoader({key:()=>revision,read:async()=>{
    reads++;max=Math.max(max,++active);const gate=deferred();gates.push(gate);await gate.promise;active--;
    return {indexes:new Map([['p',new Map([['x',{name:reads===1?'SECRET':'visible'}]])]]),catalogFor:()=>new Map()};
  }});
  const a=load();await tick();revision++;
  const b=load({fields:['extra']});gates[0].resolve();await tick();assert.equal(reads,2);
  gates[1].resolve();const results=await Promise.all([a,b]);assert.equal(max,1);
  for(const result of results)assert.equal(result.indexes.get('p').get('x').name,'visible');
});
test('a failed corpus read is not cached', async () => {
  let reads=0;
  const load=createCorpusLoader({key:()=>0,read:async()=>{if(++reads===1)throw Error('offline');return {catalogFor:()=>new Map(),indexes:new Map()};}});
  await assert.rejects(load(),/offline/);await load();assert.equal(reads,2);
});

test('a later provider field requirement does not invalidate already delivered evidence', async () => {
  const load=createCorpusLoader({key:()=>0,read:async()=>({catalogFor:()=>new Map(),indexes:new Map()})});
  const a=await load({fields:['one']});await load({fields:['two']});assert.equal(a.isCurrent(),true);
});
test('an obsolete failed build does not drop the queued latest request', async () => {
  const gate=deferred();let builds=0,published=0;
  const queue=createRefreshQueue({invalidate:()=>{},build:async isCurrent=>{if(++builds===1)await gate.promise;if(isCurrent())published++;}});
  const first=queue.request();await tick();const next=queue.request();gate.reject(Error('old failure'));
  await Promise.all([first,next]);assert.equal(builds,2);assert.equal(published,1);
});
