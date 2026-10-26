import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../lib/process.js';
import {engineBuildPlan,cudaArchitecture} from '../lib/engine-build-plan.js';
const pkg=dirname(dirname(fileURLToPath(import.meta.url)));
const engine=JSON.parse(await readFile(join(pkg,'lib/engine.json'),'utf8'));
const arg=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined;};
const requestedRoot=resolve(arg('--root')||join(pkg,'.engine'));
const patch=join(pkg,engine.patch||'patches/ninfer-dflash-checkpoints.patch');
const patchBytes=await readFile(patch);
const {root,source,build,patchSha256}=engineBuildPlan(requestedRoot,engine,patchBytes);
const execute=(cmd,args,cwd=root)=>run(cmd,args,{cwd,timeout:7200000,onData:s=>process.stdout.write(s)});
await mkdir(root,{recursive:true});
try{
 try{await access(join(source,'.git'));}catch(e){if(e.code!=='ENOENT')throw e;await execute('git',['init',source]);await execute('git',['remote','add','origin',engine.source+'.git'],source);await execute('git',['fetch','--depth','1','origin',engine.revision],source);await execute('git',['checkout','--detach','FETCH_HEAD'],source);}
 const rev=(await execute('git',['rev-parse','HEAD'],source)).stdout.trim();
 if(rev!==engine.revision)throw new Error('Checkpoint build requires the pinned source revision; use a new --root directory.');
 let applied=false;try{await run('git',['apply','--reverse','--check',patch],{cwd:source});applied=true;}catch{}
 if(!applied){await execute('git',['apply','--index','--check',patch],source);await execute('git',['apply','--index',patch],source);}
 const sourceTree=(await execute('git',['write-tree'],source)).stdout.trim();
 if(sourceTree!==engine.sourceTree)throw new Error('Engine source tree differs from the packaged implementation.');
 await execute('git',['diff','--exit-code'],source);
 if((await execute('git',['ls-files','--others','--exclude-standard'],source)).stdout.trim())throw new Error('Unexpected untracked engine source; preserve it and use a clean root.');
 if(process.argv.includes('--prepare-only')){console.log('DSH_RESULT='+JSON.stringify({sourceDir:source,sourceTree,patchSha256,preparedOnly:true}));process.exit(0);}
 const cmake=process.env.CMAKE||'cmake';
 const arch=arg('--arch')||cudaArchitecture((await execute('nvidia-smi',['--query-gpu=compute_cap','--format=csv,noheader'])).stdout);
 await execute(cmake,['-S',source,'-B',build,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_CUDA_ARCHITECTURES='+arch,'-DNINFER_BUILD_APPS=ON','-DBUILD_TESTING=OFF','-DNINFER_BUILD_BENCHMARKS=OFF',...(process.env.NINFER_CMAKE_ARGS?JSON.parse(process.env.NINFER_CMAKE_ARGS):[])]);
 await execute(cmake,['--build',build,'--target','ninfer-serve','--parallel',arg('--jobs')||'2']);
 const executable=join(build,'apps',process.platform==='win32'?'ninfer-serve.exe':'ninfer-serve');await access(executable);
 await writeFile(join(root,'checkpoint-build.json'),JSON.stringify({sourceRevision:rev,sourceTree,patchSha256,executable,architecture:arch,snapshotVersion:3,capabilities:engine.capabilities},null,2));
 console.log('DSH_RESULT='+JSON.stringify({sourceDir:source,executable,kvCache:true}));
}catch(error){console.error(error.message);process.exitCode=1;}
