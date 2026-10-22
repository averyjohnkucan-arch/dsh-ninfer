import { mkdir,readFile,writeFile,access } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.js';
const pkg=dirname(dirname(fileURLToPath(import.meta.url)));
const engine=JSON.parse(await readFile(join(pkg,'lib/engine.json'),'utf8'));
const index=process.argv.indexOf('--root');
const root=resolve(index>=0?process.argv[index+1]:join(pkg,'.engine'));
await mkdir(root,{recursive:true});
const log=text=>process.stdout.write(text);
const execute=(cmd,args,cwd=root)=>run(cmd,args,{cwd,timeout:7200000,onData:log});
try{
 if(engine.id==='strata'){
  const source=join(root,'source');
  try{await access(join(source,'.git'));}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(source,{recursive:true});await execute('git',['init',source]);await execute('git',['remote','add','origin',engine.source+'.git'],source);}
  await execute('git',['fetch','--depth','1','origin',engine.revision],source);
  await execute('git',['checkout','--detach','FETCH_HEAD'],source);
  // The engine source and Python server are one reviewed revision. Model weights stay external.
  const venv=join(root,'venv');await execute('python3',['-m','venv',venv]);
  const python=join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await execute(python,['-m','pip','install','-r',join(source,'requirements-unleashed.txt')]);
  await execute(python,['-B',join(source,'unleashed.py'),'--build','--help'],source);
  // --help exits before building; use the public build helper without starting a model or tuning it.
  await execute(python,['-B','-c','import unleashed; unleashed.build()'],source);
  console.log('DSH_RESULT='+JSON.stringify({sourceDir:source,executable:join(source,'build',process.platform==='win32'?'strata.exe':'strata'),python}));
 }else{
  await execute(process.execPath,[join(pkg,'scripts/build-checkpoint-engine.js'),'--root',root]);
 }
}catch(e){console.error(e.message);process.exitCode=1;}
