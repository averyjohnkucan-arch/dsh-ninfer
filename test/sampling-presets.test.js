import test from 'node:test';
import assert from 'node:assert/strict';
import {samplingPayload} from '../lib/sampling-presets.js';
const p={samplingPresets:{instruct:{temperature:.7,top_p:.8,top_k:20,presence_penalty:1.5,repetition_penalty:1},thinking:{temperature:1,top_p:.95,presence_penalty:0}}};
test('nonthinking uses saved instruct sampler; reasoning uses thinking sampler',()=>{assert.deepEqual(samplingPayload(p,'off'),p.samplingPresets.instruct);assert.deepEqual(samplingPayload(p,'none'),p.samplingPresets.instruct);assert.deepEqual(samplingPayload(p,'medium'),p.samplingPresets.thinking);assert.deepEqual(samplingPayload(p,'xhigh'),p.samplingPresets.thinking);});
test('explicit zero temperature and penalties override preset defaults',()=>{const d=samplingPayload(p,'off',{temperature:0,presence_penalty:0,top_p:.99});assert.equal(d.temperature,undefined);assert.equal(d.presence_penalty,undefined);assert.equal(d.top_p,undefined);assert.equal(d.top_k,20);});
test('legacy profiles retain native defaults; ninfer omits unsupported repetition field',()=>{assert.deepEqual(samplingPayload({},'off'),{});assert.equal(samplingPayload(p,'off',{}, {ninfer:true}).repetition_penalty,undefined);});

test("null controls receive defaults while explicit zero remains intact",()=>{const body={temperature:null,presence_penalty:0};const merged={...body,...samplingPayload(p,"off",body)};assert.equal(merged.temperature,.7);assert.equal(merged.presence_penalty,0);});
