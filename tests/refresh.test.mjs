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

test('delayed requests coalesce bursts, preempt cleanly for immediate requests, and cancel on stop', async () => {
  let builds = 0, invalidations = 0, lastOption;
  const queue = createRefreshQueue({
    invalidate: opts => { invalidations++; lastOption = opts; },
    build: async (_isCurrent, opts) => { builds++; lastOption = opts; }
  });
  const burst = Array.from({length: 10}, (_, i) => queue.request({delay: 25, seq: i}));
  assert.equal(invalidations, 10);
  assert.equal(builds, 0);
  await Promise.all(burst);
  assert.equal(builds, 1);
  assert.equal(lastOption.seq, 9);

  // Immediate/retract request preempts a pending delayed build without double-running
  const delayed = queue.request({delay: 40, tag: 'delayed'});
  const immediate = queue.request({retract: true, tag: 'retract'});
  await Promise.all([delayed, immediate]);
  assert.equal(builds, 2);
  assert.equal(lastOption.tag, 'retract');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(builds, 2);

  // stop() cancels pending delayed work and resolves waiters
  const stopped = queue.request({delay: 40, tag: 'stopped'});
  queue.stop();
  await stopped;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(builds, 2);

  // Failed delayed build rejects and releases the queue
  let fail = true;
  const failingQueue = createRefreshQueue({
    invalidate: () => {},
    build: async () => { if (fail) throw Error('delayed offline'); }
  });
  await assert.rejects(failingQueue.request({delay: 10}), /delayed offline/);
  fail = false;
  await failingQueue.request({delay: 10});
});

test('idle-scheduled refreshes wait for requestIdleCallback after debounce and cancel cleanly on preemption or stop', async t => {
  const origReq = globalThis.requestIdleCallback, origCancel = globalThis.cancelIdleCallback;
  const scheduled = [], cancelled = [];
  let nextHandle = 10;
  globalThis.requestIdleCallback = (cb, opts) => {
    const id = ++nextHandle;
    scheduled.push({id, cb, opts});
    return id;
  };
  globalThis.cancelIdleCallback = id => {
    cancelled.push(id);
    const idx = scheduled.findIndex(entry => entry.id === id);
    if (idx >= 0) scheduled.splice(idx, 1);
  };
  t.after(() => {
    if (origReq === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origReq;
    if (origCancel === undefined) delete globalThis.cancelIdleCallback;
    else globalThis.cancelIdleCallback = origCancel;
  });

  let builds = 0;
  const tags = [];
  const queue = createRefreshQueue({
    invalidate: () => {},
    build: async (_isCurrent, opts) => { builds++; tags.push(opts?.tag); }
  });

  const idlePromise = queue.request({delay: 15, idle: true, idleTimeout: 900, tag: 'idle1'});
  await new Promise(r => setTimeout(r, 25));
  assert.equal(builds, 0);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0].opts, {timeout: 900});
  scheduled.shift().cb();
  await idlePromise;
  assert.equal(builds, 1);
  assert.deepEqual(tags, ['idle1']);

  // Immediate/retract request cancels pending idle callback
  const idle2 = queue.request({delay: 15, idle: true, tag: 'idle2'});
  await new Promise(r => setTimeout(r, 25));
  assert.equal(scheduled.length, 1);
  const idle2Id = scheduled[0].id;
  await Promise.all([idle2, queue.request({retract: true, tag: 'retract'})]);
  assert.ok(cancelled.includes(idle2Id));
  assert.equal(builds, 2);
  assert.deepEqual(tags, ['idle1', 'retract']);

  // stop() cancels pending idle callback and resolves waiter without running build
  const idle3 = queue.request({delay: 15, idle: true, tag: 'idle3'});
  await new Promise(r => setTimeout(r, 25));
  assert.equal(scheduled.length, 1);
  const stale = scheduled[0];
  queue.stop();
  await idle3;
  assert.ok(cancelled.includes(stale.id));
  stale.cb();
  await tick();
  assert.equal(builds, 2);
});
