window.__ModuleLoader__.load({
 id: 'dsh-ninfer',
 factory(require) {
  const React = require('react');
  const h = React.createElement;
  const { useEffect, useState } = React;
  const css = `.ninfer-card{margin-top:16px;padding:18px;border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-settings-card-fill);font:inherit}.ninfer-card *{box-sizing:border-box}.ninfer-head,.ninfer-actions,.ninfer-row,.ninfer-tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ninfer-head,.ninfer-row{justify-content:space-between}.ninfer-card button,.ninfer-card input,.ninfer-card select{font:inherit;color:inherit;background:var(--dsw-alias-button-secondary-fill);border:1px solid var(--dsw-alias-border-l3);border-radius:7px;padding:8px}.ninfer-card button{cursor:pointer}.ninfer-card button:disabled{opacity:.5;cursor:default}.ninfer-card p,.ninfer-card small{color:var(--dsw-alias-label-secondary);line-height:1.5}.ninfer-card h3,.ninfer-card h4{margin:0}.ninfer-row{padding:15px 0;border-top:1px solid var(--dsw-alias-border-l3)}.ninfer-tabs{padding:14px 0}.ninfer-tabs button[aria-current=page]{font-weight:bold}.ninfer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.ninfer-grid label{display:grid;gap:5px}.ninfer-path{overflow-wrap:anywhere}.ninfer-error{color:#ed7474!important}.ninfer-files{max-height:230px;overflow:auto;display:grid;gap:4px}.ninfer-files button{text-align:left}.ninfer-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}`;
  async function api(action,payload={}) {
   const response=await fetch('/api/dsh-ninfer',{credentials:'same-origin',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});
   if(response.status===401||response.status===403)throw Error('Reopen DSH using its launch link, then reload this page.');
   const result=await response.json();if(!response.ok||result.error)throw Error(result.error||response.statusText);return result.result;
  }
  function Card() {
   const [data,setData]=useState(null),[view,setView]=useState('models'),[draft,setDraft]=useState(null),[listing,setListing]=useState(null),[path,setPath]=useState(''),[scan,setScan]=useState(null),[catalog,setCatalog]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
   const refresh=async()=>setData(await api('list'));
   useEffect(()=>{let live=true;const update=()=>api('list').then(x=>{if(live)setData(x);}).catch(e=>{if(live)setError(e.message);});update();const timer=setInterval(update,2000);return()=>{live=false;clearInterval(timer);};},[]);
   useEffect(()=>{if(view!=='download')return;let live=true;const update=()=>api('recommended').then(x=>{if(live)setCatalog(x);}).catch(e=>{if(live)setError(e.message);});update();const timer=setInterval(update,2000);return()=>{live=false;clearInterval(timer);};},[view]);
   const act=async(action,payload={})=>{setBusy(true);setError('');try{const result=await api(action,payload);await refresh();return result;}catch(e){setError(e.message);throw e;}finally{setBusy(false);}};
   const run=(action,payload)=>act(action,payload).catch(()=>{});
   const edit=(key,value)=>setDraft(p=>({...p,[key]:value}));
   const option=(key,value)=>setDraft(p=>({...p,options:{...p.options,[key]:value}}));
   const active=data?.jobs.find(j=>j.status==='running'), latest=data?.jobs.at(-1);
   const modelBusy=active && active.kind!=='Install NInfer';
   async function browse(folder) {try{const next=await act('browse',{path:folder||undefined});setListing(next);setPath(next.path);}catch{}}
   async function scanFolder() {try{setScan(await act('scan',{path:listing.path}));}catch{}}
   async function choose(model) {
    if(!model.complete){setError('This model is missing one or more files.');return;}
    try{
     const result=await act('assign',{paths:[model.path]});
     if(!result.complete)throw Error(result.warnings.join(' '));
     const profile=await act('new');const values={...result.assignments};const name=values.suggestedName||model.name;delete values.suggestedName;
     const options={...profile.options};if(model.components.includes('vision'))options['--vision']=true;
     // NInfer requires a draft width with --spec mtp; 3 is its own automatic default.
     if(model.components.includes('mtp')){options['--spec']='mtp';options['--draft-tokens']=3;}
     setDraft({...profile,...values,name,nativeContext:model.nativeContext||null,components:model.components,kvCache:model.modelType==='qwen3_5_text',options});setView('editor');
    }catch(e){setError(e.message);}
   }
   async function save(calibrate=false){try{await act('save',{profile:draft});const id=draft.id;setDraft(null);setView('models');if(calibrate)await act('calibrate',{id});}catch{}}
   async function editProfile(p){
    setDraft(structuredClone(p));setView('editor');
    if(!p.modelPath||p.components)return;
    try{const result=await api('assign',{paths:[p.modelPath]});const item=result.files.find(f=>f.kind==='ninfer');if(item)setDraft(current=>current?.id===p.id?{...current,nativeContext:item.nativeContext||null,components:item.components}:current);}catch(e){setError(e.message);}
   }
   const button=(label,fn,disabled=false)=>h('button',{type:'button',onClick:fn,disabled},label);
   return h('section',{className:'ninfer-card','aria-label':'NInfer'},h('style',null,css),
    h('header',{className:'ninfer-head'},h('div',null,h('h3',null,'NInfer'),h('small',null,'Local models')),button('Purge all cache',()=>run('purge-cache'),busy||!!active)),
    error&&h('p',{role:'alert',className:'ninfer-error'},error),
    !data?h('p',null,'Connecting to NInfer…'):null,
    data&&view!=='editor'&&h('nav',{className:'ninfer-tabs','aria-label':'NInfer views'},...['models','files','download','activity'].map(id=>h('button',{key:id,type:'button','aria-current':view===id?'page':undefined,onClick:()=>setView(id)},id[0].toUpperCase()+id.slice(1))),button('Import files',async()=>{setView('files');await browse();},busy)),
    data&&view==='models'&&h('div',null,
     !data.profiles.length&&h('p',null,'Import a NInfer model to get started.'),
     ...data.profiles.map(p=>h('div',{className:'ninfer-row',key:p.id},h('div',null,h('strong',null,p.name),h('p',null,`${p.status} · ${p.context.toLocaleString()} context`),p.cacheStatus?.phase==='warning'&&h('small',null,p.cacheStatus.message)),h('div',{className:'ninfer-actions'},button('Settings',()=>editProfile(p),busy||!!active),button(p.status==='running'?'Unload':'Load',()=>run(p.status==='running'?'stop':'prepareStart',{id:p.id}),busy||!!active),button('Remove',()=>{if(window.confirm('Remove this profile? Model files will be kept.'))run('remove',{id:p.id});},busy||!!active)))),
     h('p',null,'NInfer calibrates GPU kernels automatically when needed.')),
    data&&view==='files'&&h('div',null,
     h('p',null,'Choose a folder to scan its subfolders for NInfer models. Model files stay where they are.'),
     h('div',{className:'ninfer-actions'},h('input',{'aria-label':'Folder path',value:path,onChange:e=>setPath(e.target.value),onKeyDown:e=>{if(e.key==='Enter')browse(path);}}),button('Open folder',()=>browse(path),busy),listing&&button('Scan this folder',scanFolder,busy)),
     listing&&h('div',{className:'ninfer-files'},button('↑ Parent folder',()=>browse(listing.parent),busy),...listing.entries.filter(e=>e.directory).map(e=>h('button',{key:e.path,type:'button',onClick:()=>browse(e.path)},e.name+'/'))),
     scan&&h('div',null,h('h4',null,`Models found (${scan.models.length})`),...scan.models.map(model=>h('div',{className:'ninfer-row',key:model.path},h('div',null,h('strong',null,model.name),h('p',{className:'ninfer-path'},model.path),h('small',null,model.complete?`${model.nativeContext||'Unknown'} native context · ${model.components.join(', ')}`:'Missing files: '+model.missing.join(', '))),button(model.complete?'Add model':'Missing files',()=>choose(model),busy||!model.complete))),scan.errorCount>0&&h('p',null,`${scan.errorCount} files or folders could not be inspected.`))),
    data&&view==='download'&&h('div',null,h('p',null,'Download a listed model or import files you already have.'),...((catalog?.models||[]).map(model=>{const job=catalog.jobs.filter(j=>j.modelId===model.id).at(-1),downloadable=model.files.length&&model.files.every(file=>file.downloadable);return h('div',{className:'ninfer-row',key:model.id},h('div',null,h('strong',null,model.name),job&&h('p',null,`${job.status} · ${job.progress}`)),downloadable&&button('Download',()=>run('recommendedDownload',{id:model.id}),busy||job?.status==='running'),job?.status==='complete'&&button('Open downloaded files',async()=>{setView('files');await browse(job.directory);},busy));}))),
    data&&view==='editor'&&draft&&h('div',null,button('← Models',()=>{setDraft(null);setView('models');}),h('h4',null,draft.name),h('p',{className:'ninfer-path'},draft.modelPath),
     h('div',{className:'ninfer-grid'},h('label',null,'Name',h('input',{value:draft.name,onChange:e=>edit('name',e.target.value)})),h('label',null,'Context',h('select',{value:draft.context,onChange:e=>edit('context',Number(e.target.value))},...Array.from(new Set([draft.context,draft.nativeContext,...Array.from({length:Math.ceil((draft.nativeContext||Math.max(draft.context,262144))/32768)},(_,i)=>(i+1)*32768)].filter(x=>x>0&&x<=Math.max(draft.context,draft.nativeContext||262144)))).sort((a,b)=>a-b).map(n=>h('option',{key:n,value:n},n===draft.nativeContext?`Native (${n.toLocaleString()})`:n.toLocaleString())))),
     h('label',null,'KV precision',h('select',{value:draft.options['--kv-dtype']||'',onChange:e=>option('--kv-dtype',e.target.value)},...['','bf16','int8','fp8','rk8v4','rk4v4','rk4v4-e8','rk2v4-e8','nvfp4','k8v4'].map(x=>h('option',{key:x,value:x},x||'Engine default'))))),
     !draft.nativeContext&&h('p',null,'Native context was not found; the engine default is selected.'),h('p',null,draft.components?.includes('vision')?'Vision is built into this artifact.':'No built-in vision component detected.'),h('p',null,draft.components?.includes('mtp')?(draft.options['--spec']==='mtp'?'Built-in MTP enabled (NInfer default draft width).':'Built-in MTP is available.'):'No built-in MTP detected.'),
     h('details',null,h('summary',null,'Advanced'),h('div',{className:'ninfer-grid'},h('label',null,'Port',h('input',{type:'number',value:draft.port,onChange:e=>edit('port',Number(e.target.value))})),h('label',null,'GPU index',h('input',{type:'number',value:draft.gpu,onChange:e=>edit('gpu',Number(e.target.value))}))),h('label',null,h('input',{type:'checkbox',checked:draft.kvCache===true,onChange:e=>edit('kvCache',e.target.checked)}),' Save conversation checkpoints (16 GiB per model)'),h('p',null,'DFlash and DFlash2 cannot save checkpoints in the official NInfer runtime; unsupported saves show a warning.'),h('p',null,'Engine: '+(draft.executable||'Automatically installed runtime'))),
     h('div',{className:'ninfer-actions'},button('Cancel',()=>{setDraft(null);setView('models');}),button('Save',()=>save(),busy||!!modelBusy),button('Save and calibrate',()=>save(true),busy||!!active)),h('small',null,'Calibrate runs NInfer’s GPU kernel calibration; resource settings remain automatic.')),
    data&&view==='activity'&&h('div',null,...data.jobs.slice(-8).reverse().map(job=>h('div',{key:job.id,className:'ninfer-row'},h('div',null,h('strong',null,job.kind),h('p',{role:job.status==='failed'?'alert':'status'},job.progress),job.log&&h('details',null,h('summary',null,'View log'),h('pre',null,job.log))),job.status==='running'&&button('Cancel',()=>run('cancel',{id:job.id})),['failed','cancelled'].includes(job.status)&&job.kind==='Install NInfer'&&button('Retry installation',()=>run('install-engine'))))),
    data&&view!=='activity'&&(active||latest?.status==='failed')&&h('div',{role:'status'},h('p',null,(active||latest).kind+': '+(active||latest).progress),h('button',{type:'button',onClick:()=>setView('activity')},'Activity'))
   );
  }
  return {inject:['slots'],apply(ctx){ctx.slots.inject('settings.models.footer',()=>ctx.slots.register({name:'settings.models.footer',id:'dsh-ninfer',order:20},Card));}};
 }
});
