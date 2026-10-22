import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {run} from '../lib/process.js';
const pkg=dirname(dirname(fileURLToPath(import.meta.url)));
const engine=JSON.parse(await readFile(join(pkg,'lib/engine.json'),'utf8'));
const arg=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined;};
const root=resolve(arg('--root')||join(pkg,'.engine')),source=join(root,'source'),build=join(root,'build');
const execute=(cmd,args,cwd=root)=>run(cmd,args,{cwd,timeout:7200000,onData:s=>process.stdout.write(s)});
await mkdir(root,{recursive:true});
try{
 try{await access(join(source,'.git'));}catch(e){if(e.code!=='ENOENT')throw e;await execute('git',['init',source]);await execute('git',['remote','add','origin',engine.source+'.git'],source);await execute('git',['fetch','--depth','1','origin',engine.revision],source);await execute('git',['checkout','--detach','FETCH_HEAD'],source);}
 const rev=(await execute('git',['rev-parse','HEAD'],source)).stdout.trim();
 if(rev!==engine.revision)throw new Error('Checkpoint build requires the pinned source revision; use a new --root directory.');
 const patch=join(pkg,'patches/ninfer-dflash-checkpoints.patch');
 let applied=false;try{await run('git',['apply','--reverse','--check',patch],{cwd:source});applied=true;}catch{}
 if(!applied){await execute('git',['apply','--check',patch],source);await execute('git',['apply',patch],source);}
 const actualPatch=(await run('git',['diff','--binary','HEAD'],{cwd:source})).stdout;
 if(actualPatch!==await readFile(patch,'utf8'))throw new Error('Engine source has changes beyond the packaged patch; use a clean --root directory.');
 const cmake=process.env.CMAKE||'cmake';
 const arch=arg('--arch')||'120a';
 await execute(cmake,['-S',source,'-B',build,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_CUDA_ARCHITECTURES='+arch,'-DNINFER_BUILD_APPS=ON','-DBUILD_TESTING=OFF','-DNINFER_BUILD_BENCHMARKS=OFF',...(process.env.NINFER_CMAKE_ARGS?JSON.parse(process.env.NINFER_CMAKE_ARGS):[])]);
 await execute(cmake,['--build',build,'--target','ninfer-serve','--parallel',arg('--jobs')||'8']);
 const executable=join(build,'apps',process.platform==='win32'?'ninfer-serve.exe':'ninfer-serve');await access(executable);
 const patchSha256=createHash('sha256').update(await readFile(patch)).digest('hex');
 await writeFile(join(root,'checkpoint-build.json'),JSON.stringify({sourceRevision:rev,patchSha256,executable,architecture:arch,snapshotVersion:3},null,2));
 console.log('DSH_RESULT='+JSON.stringify({sourceDir:source,executable,kvCache:true}));
}catch(error){console.error(error.message);process.exitCode=1;}
