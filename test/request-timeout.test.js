import test from 'node:test';
import assert from 'node:assert/strict';
import { requestIdleTimeoutMs } from '../lib/request-timeout.js';
import { SerialGate, KvCache } from '../lib/kv-cache.js';
import { idleWatchdog } from '@deepseek-ai/dsh-timeout';

test('silent local work survives the former 15-minute limit and retains a finite deadline', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const watchdog=idleWatchdog(undefined,requestIdleTimeoutMs(),'fixture');
 let finish;
 const pending=watchdog.next({next:()=>new Promise(resolve=>finish=resolve)});
 t.mock.timers.tick(900001);
 assert.equal(watchdog.signal.aborted,false);
 finish({done:false,value:'token'});
 assert.equal((await pending).value,'token');
 const stalled=watchdog.next({next:()=>new Promise(()=>{})});
 const failure=assert.rejects(stalled,/fixture/);
 t.mock.timers.tick(requestIdleTimeoutMs());
 await failure;
 watchdog[Symbol.dispose]();
});

test('deployment timeout applies to base prefill and rejects invalid settings', () => {
 assert.equal(requestIdleTimeoutMs(),86400000);
 assert.equal(new KvCache('/unused',{requestIdleTimeoutMs:1234}).requestIdleTimeoutMs,1234);
 for(const value of [0,-1,Infinity,NaN,2147483648,1.5,'1000'])
  assert.throws(()=>requestIdleTimeoutMs({requestIdleTimeoutMs:value}),/positive integer/);
});

test('Stop immediately cancels a queued worker without releasing the active owner', async () => {
 const gate=new SerialGate(),release=await gate.acquire();
 const controller=new AbortController();
 const waiting=gate.acquire(controller.signal);
 const rejected=assert.rejects(waiting,{name:'AbortError'});
 controller.abort();await rejected;
 let entered=false;
 const next=gate.acquire().then(unlock=>{entered=true;return unlock;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(entered,false);
 release();(await next)();
 (await gate.acquire())();
});
