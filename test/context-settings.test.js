import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {freshProfile,normalizeProfile,ninferArgs} from '../lib/profiles.js';

function profile(context=196608,capacity='196608') {
  const p=freshProfile('ninfer');p.context=context;p.options={'--kv-capacity':capacity,'--kv-dtype':'nvfp4'};
  return normalizeProfile(p,'ninfer');
}

test('saving a profile repairs an undersized explicit pool while preserving precision, auto and larger pools',()=>{
  const p=profile();p.context=262144;
  assert.throws(()=>ninferArgs(p),/KV capacity.*196,608.*262,144/);
  const fixed=normalizeProfile(p,'ninfer');
  assert.equal(fixed.context,262144);assert.equal(fixed.options['--kv-capacity'],262144);
  assert.equal(fixed.options['--kv-dtype'],'nvfp4');assert.ok(fixed.locks.includes('options.--kv-capacity'));
  for(const capacity of ['auto',524288])assert.equal(profile(262144,capacity).options['--kv-capacity'],capacity);
});

test('the context selector updates the same saved profile and preserves automatic or custom larger capacity',async()=>{
  const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
  for(const [oldContext,capacity,newContext,expected] of [[196608,'196608',262144,262144],[262144,'262144',131072,131072],[196608,'auto',262144,'auto'],[196608,524288,262144,524288]]){
    const p=profile(oldContext,capacity);const states=[{profiles:[p],jobs:[],customRuntime:true},'editor',p];
    let cursor=0,definition,Card;
    const react={useState(initial){const index=cursor++;if(states[index]===undefined)states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useEffect(){},createElement(type,props,...children){return {type,props:props||{},children};}};
    vm.runInNewContext(source,{window:{__ModuleLoader__:{load(value){definition=value;}}}});
    const plugin=definition.factory(()=>react);plugin.apply({slots:{inject(_name,callback){callback();},register(_options,component){Card=component;}}});
    const tree=Card();
    function find(value){if(Array.isArray(value))return value.map(find).find(Boolean);if(!value||typeof value!=='object')return null;if(value.type==='select'&&value.props.value===oldContext)return value;return find(value.children);}
    const select=find(tree);assert.ok(select,'Context selector must be rendered');select.props.onChange({target:{value:String(newContext)}});
    assert.equal(states[2].context,newContext);assert.equal(states[2].options['--kv-capacity'],expected);assert.equal(states[2].options['--kv-dtype'],'nvfp4');
  }
});
