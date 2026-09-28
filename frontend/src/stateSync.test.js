import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStateSync} from './stateSync.js';
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('event bursts coalesce and in-flight stale reads are followed by one fresh read', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const pending=[], applied=[];
  const sync=createStateSync({read:()=>new Promise(resolve=>pending.push(resolve)),apply:v=>applied.push(v),fail:assert.fail,paused:()=>false,visible:()=>true});
  sync.start(); sync.request(); sync.request();
  t.mock.timers.tick(100);
  assert.equal(pending.length,1);
  sync.request(); sync.request();
  t.mock.timers.tick(100);
  assert.equal(pending.length,1);
  pending[0]('stale'); await settle();
  assert.deepEqual(applied,[]);
  t.mock.timers.tick(100);
  pending[1]('current'); await settle();
  assert.deepEqual(applied,['current']);
  sync.stop();
});

test('switching documents discards responses from the previous editor', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const pending=[],applied=[];
  const sync=createStateSync({read:()=>new Promise(resolve=>pending.push(resolve)),apply:v=>applied.push(v),fail:assert.fail,paused:()=>false,visible:()=>true});
  sync.start(); t.mock.timers.tick(100);
  sync.stop(); sync.start(); t.mock.timers.tick(100);
  pending[0]('old document'); await settle();
  pending[1]('new document'); await settle();
  assert.deepEqual(applied,['new document']);
  sync.stop(); t.mock.timers.tick(5000);
  assert.equal(pending.length,2);
});

test('writes and hidden pages suspend reads, failures do not stop later recovery', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let paused=true,visible=true,calls=0;
  const applied=[],errors=[];
  const sync=createStateSync({read:async()=>{calls++;if(calls===1)throw Error('offline');return 'recovered';},apply:v=>applied.push(v),fail:e=>errors.push(e.message),paused:()=>paused,visible:()=>visible});
  sync.start(); t.mock.timers.tick(100);
  assert.equal(calls,0);
  paused=false; visible=false; sync.request(); t.mock.timers.tick(100);
  assert.equal(calls,0);
  visible=true; sync.request(); t.mock.timers.tick(100); await settle();
  assert.deepEqual(errors,['offline']);
  sync.request(); t.mock.timers.tick(100); await settle();
  assert.deepEqual(applied,['recovered']);
  sync.stop();
});
