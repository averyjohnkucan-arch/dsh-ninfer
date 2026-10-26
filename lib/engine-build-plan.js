import {createHash} from 'node:crypto';
import {join} from 'node:path';

export function engineBuildPlan(root,engine,patch){
 const patchSha256=createHash('sha256').update(patch).digest('hex');
 if(engine.patchSha256&&engine.patchSha256!==patchSha256)throw Error('Packaged engine patch checksum mismatch.');
 const directory=join(root,'builds',`${engine.revision.slice(0,12)}-${patchSha256.slice(0,12)}`);
 return {root:directory,source:join(directory,'source'),build:join(directory,'build'),patchSha256};
}

export function cudaArchitecture(computeCapabilities){
 const first=String(computeCapabilities).split(/\r?\n/).map(x=>x.trim()).find(Boolean);
 const match=/^(\d+)\.(\d+)$/.exec(first||'');
 if(!match)throw Error('Cannot detect CUDA architecture; pass --arch explicitly.');
 const arch=match[1]+match[2];
 if(!['70','75','80','86','89','120'].includes(arch))throw Error(`CUDA architecture ${arch} is not established for this engine; pass a supported --arch explicitly.`);
 return arch==='120'?'120a':arch;
}
