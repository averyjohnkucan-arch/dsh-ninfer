import test from 'node:test';
import assert from 'node:assert/strict';
import {ready} from '../lib/process.js';
import {startupError} from '../lib/startup-error.js';

test('startup errors retain the diagnostic before a long usage manual',async()=>{
  const diagnostic='ninfer-serve: --kv-capacity must be at least --max-context';
  const log='\x1b[31m'+diagnostic+'\x1b[0m\nusage: ninfer-serve <model> [options]\n'+'API BEHAVIOR NETWORK LIMITS help text\n'.repeat(500);
  await assert.rejects(()=>ready('http://localhost:1',{exitCode:1},{log:()=>log}),error=>{
    assert.ok(error.message.includes(diagnostic));assert.ok(!error.message.includes('API BEHAVIOR'));assert.ok(error.message.length<300);assert.equal(error.exitCode,1);return true;
  });
  assert.ok(startupError('weights loaded\nERROR GPU allocation failed\ncleanup complete',1).message.includes('GPU allocation failed'));
  assert.ok(!startupError('usage: ninfer-serve\n'+ 'long manual\n'.repeat(100),1).message.includes('long manual'));
});
