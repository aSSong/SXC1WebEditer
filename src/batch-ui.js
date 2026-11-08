'use strict';
const batchDialog=$('batchDialog');
const batchState={jobs:[],ignored:0,running:false,collecting:false,stop:false,attempted:false,conflicts:[],rows:[]};
const batchLabels={queued:'待检查',checking:'校验音频…',ready:'已就绪',uploading:'正在上传…',complete:'已完成',invalid:'音频无效',uncertain:'待核对',failed:'待重试'};
const batchLocked=()=>batchState.jobs.some(j=>['complete','uncertain'].includes(j.status));
const batchStart=()=>({bank:Number($('batchBank').value),pad:Number($('batchPad').value)});
function batchMessage(text,error=false){$('batchMessage').textContent=text;$('batchMessage').classList.toggle('error',error)}
function syncBatchControls(){
  const busy=state.busy||batchState.running||batchState.collecting,locked=batchLocked(),jobs=batchState.jobs,done=jobs.filter(j=>j.status==='complete').length;
  $('batchOpen').disabled=state.busy||batchState.collecting;
  for(const id of ['batchFilesButton','batchFolderButton','batchFiles','batchFolder'])$(id).disabled=busy||locked;
  $('batchBank').disabled=busy||locked;$('batchPad').disabled=busy||locked;
  $('batchClear').disabled=busy||!jobs.length;$('batchClose').disabled=busy;
  $('batchConnect').hidden=state.mode==='live';$('batchConnect').disabled=busy;
  $('batchSubmit').disabled=busy||state.mode!=='live'||!jobs.length||done===jobs.length;
  $('batchSubmit').textContent=done&&done<jobs.length?'重试剩余采样':batchState.attempted?'重试上传':'检查并上传';
  $('batchStop').hidden=!batchState.running;$('batchStop').disabled=batchState.stop;
  $('batchReceipt').disabled=!batchState.attempted||busy;
  $('batchDrop').classList.toggle('disabled',busy||locked);
  for(const row of batchState.rows)row.remove.disabled=busy||locked;
  $('batchConnectionHint').hidden=state.mode==='live';
}
function renderBatch(){
  const jobs=batchState.jobs,{bank,pad}=batchStart();let targets=[],rangeError='';
  batchDialog.classList.toggle('has-files',jobs.length>0);
  if(jobs.length)try{targets=SXCBatch.plan(jobs.length,bank,pad)}catch(e){rangeError=e.message}
  const done=jobs.filter(j=>j.status==='complete').length;
  $('batchCount').textContent=jobs.length?`${jobs.length} 个采样 · 已完成 ${done} 个`:'尚未选择音频';
  $('batchRange').textContent=rangeError||(targets.length?`${SXCBatch.label(targets[0])} → ${SXCBatch.label(targets[targets.length-1])}`:'选择文件后显示填充范围');
  $('batchRange').classList.toggle('error',!!rangeError);
  $('batchIgnored').textContent=batchState.ignored?`已跳过 ${batchState.ignored} 个隐藏或非音频文件。`:'';
  $('batchListEmpty').hidden=!!jobs.length;$('batchTable').hidden=!jobs.length;
  batchState.rows=[];const fragment=document.createDocumentFragment();
  jobs.forEach((job,i)=>{
    const row=document.createElement('tr'),order=document.createElement('td'),fileCell=document.createElement('td'),target=document.createElement('td'),status=document.createElement('td'),action=document.createElement('td');
    order.textContent=String(i+1);order.className='batch-order';
    const name=document.createElement('strong'),detail=document.createElement('small');name.textContent=job.path;name.title=job.path;
    detail.textContent=size(job.file.size)+(job.info?` · ${job.info.duration.toFixed(2)} 秒`:'');fileCell.className='batch-file';fileCell.append(name,detail);
    target.textContent=targets[i]?`${pad2(targets[i].bank)} / ${pad2(targets[i].pad)}`:'超出范围';target.className='batch-target';
    status.textContent=batchLabels[job.status];status.className='batch-status';status.dataset.state=job.status;if(job.error)status.title=job.error;
    if(targets[i]&&batchState.conflicts.some(t=>t.bank===targets[i].bank&&t.pad===targets[i].pad)){status.textContent='位置已占用';status.dataset.state='invalid'}
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.className='batch-remove';remove.setAttribute('aria-label','移除 '+job.path);
    remove.onclick=()=>{if(state.busy||batchLocked())return;jobs.splice(i,1);batchState.conflicts=[];batchMessage('列表已更新，点击重试会重新检查全部目标位置。');renderBatch()};
    action.append(remove);row.append(order,fileCell,target,status,action);fragment.append(row);batchState.rows.push({row,status,detail,remove});
  });
  $('batchRows').replaceChildren(fragment);syncBatchControls();
}
function updateBatchJob(job){
  const row=batchState.rows[batchState.jobs.indexOf(job)];if(!row)return;
  if(job.status==='uploading'&&!batchState.stop)batchMessage('空位与音频检查已通过，正在顺序上传。请保持连接；可点击“停止”在当前采样核对完成后暂停。');
  row.status.textContent=batchLabels[job.status];row.status.dataset.state=job.status;row.status.title=job.error||'';
  row.detail.textContent=size(job.file.size)+(job.info?` · ${job.info.duration.toFixed(2)} 秒`:'');
  $('batchCount').textContent=`${batchState.jobs.length} 个采样 · 已完成 ${batchState.jobs.filter(j=>j.status==='complete').length} 个`;
  syncBatchControls();
}
function openBatch(){
  if(state.busy)return;stopAudio();
  if(!batchState.jobs.length){$('batchBank').value=String(state.bank);$('batchPad').value='1'}
  renderBatch();batchDialog.showModal();
}
function closeBatch(){if(state.busy||batchState.running||batchState.collecting)return;batchDialog.close()}
$('batchOpen').onclick=openBatch;$('batchClose').onclick=closeBatch;
batchDialog.addEventListener('cancel',event=>{event.preventDefault();closeBatch()});
for(let n=1;n<=80;n++)$('batchBank').append(new Option('Bank '+pad2(n),String(n)));
for(let n=1;n<=16;n++)$('batchPad').append(new Option('Pad '+pad2(n),String(n)));
for(const id of ['batchBank','batchPad'])$(id).onchange=()=>{batchState.conflicts=[];renderBatch();batchMessage('点击上传后会重新检查整个填充范围。')};
$('batchFilesButton').onclick=()=>$('batchFiles').click();$('batchFolderButton').onclick=()=>$('batchFolder').click();
async function chooseBatch(getSelection){
  if(state.busy||batchState.running||batchState.collecting||batchLocked())return;
  batchState.collecting=true;syncBatchControls();batchMessage('正在读取文件列表…');
  try{const selected=await getSelection();batchState.jobs=selected.jobs;batchState.ignored=selected.ignored;batchState.attempted=false;batchState.conflicts=[];batchMessage('文件已按路径和名称排序。设置起点后，点击“检查并上传”。')}
  catch(e){batchMessage(e.message+' 原有列表未改变。',true)}
  finally{batchState.collecting=false;renderBatch()}
}
for(const id of ['batchFiles','batchFolder'])$(id).onchange=()=>{const files=[...$(id).files];$(id).value='';if(files.length)chooseBatch(()=>SXCBatch.fromFiles(files))};
$('batchClear').onclick=()=>{if(state.busy||batchState.collecting)return;batchState.jobs=[];batchState.ignored=0;batchState.attempted=false;batchState.conflicts=[];batchMessage('列表已清空。机器上已经上传的采样会保留。');renderBatch()};
const batchDrop=$('batchDrop');
batchDrop.addEventListener('dragover',event=>{
  if(!dragHasFiles(event))return;event.preventDefault();event.stopPropagation();
  const allowed=!state.busy&&!batchState.collecting&&!batchLocked();event.dataTransfer.dropEffect=allowed?'copy':'none';batchDrop.classList.toggle('drop-target',allowed);
});
batchDrop.addEventListener('dragleave',event=>{if(!batchDrop.contains(event.relatedTarget))batchDrop.classList.remove('drop-target')});
batchDrop.addEventListener('drop',event=>{
  event.preventDefault();event.stopPropagation();batchDrop.classList.remove('drop-target');
  if(state.busy||batchState.collecting||batchLocked())return;
  const captured=SXCBatch.captureDrop(event.dataTransfer);chooseBatch(()=>SXCBatch.fromDrop(captured));
});
$('batchConnect').onclick=async()=>{if(state.busy)return;await $('connect').onclick();batchMessage(state.mode==='live'?'已连接。文件列表保留，可以开始或重试上传。':'连接未完成。文件列表保留，请连接机器后重试。',state.mode!=='live');syncBatchControls()};
$('batchStop').onclick=()=>{batchState.stop=true;batchMessage('正在停止：如已有采样在传送，将先完成当前 Pad 的加载与核对。');syncBatchControls()};
$('batchReceipt').onclick=()=>{
  const report={format:'sxc-batch-v1',created_at:new Date().toISOString(),...batchStart(),files:batchState.jobs.map(({path,status,target,info,error,report})=>({path,status,target,info,error,report}))};
  saveBlob(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),'SXC-1_批量上传记录_'+localDate()+'.json');
};
$('batchSubmit').onclick=async()=>{
  if(state.busy||batchState.collecting||state.mode!=='live'||!batchState.jobs.length)return;
  const midi=state.midi;batchState.running=true;batchState.stop=false;batchState.attempted=true;batchState.conflicts=[];state.uploading=true;stopAudio();renderBatch();
  batchMessage('正在检查连续空位，检查完成前不会写入采样。');$('batchProgressPanel').hidden=false;let failure=null;
  const batchProgress=(text,pct)=>{progress(text,pct);$('batchProgressText').textContent=text;if(pct==null)$('batchProgress').removeAttribute('value');else $('batchProgress').value=pct};
  try{
    await run('检查批量上传目标…',async()=>{
      try{
        await SXCBatch.execute(midi,batchState.jobs,{...batchStart(),
          checkpoint:()=>{checkAbort();if(batchState.stop)throw new SXCBatch.BatchError('cancelled','已停止，文件列表和已完成进度均保留。点击重试可继续剩余采样。')},
          progress:batchProgress,change:updateBatchJob,journal:uploadJournal,
          completed:job=>{if(state.bank!==job.target.bank){state.cache.clear();state.padSettings.clear()}state.bank=job.target.bank;state.entries=job.report.after;state.padSettings.set(state.bank+':'+job.target.pad,SXCPad.parseDb(SXCUpload.defaults()))}
        });
        batchMessage(`批量上传完成：${batchState.jobs.length} 个采样均已读回核对。`);notice('批量上传完成，所有采样均已核对。');
        await loadBank();
      }catch(e){
        failure=e;batchState.conflicts=e.conflicts||[];
        if(e instanceof SXCBatch.BatchError){batchMessage(e.message,e.code!=='cancelled');notice(e.message,e.code!=='cancelled')}
        else{batchMessage(`上传已停止：${e.message}。列表与已完成进度已保留，请重新连接后重试。`,true);throw e}
      }
    });
  }finally{
    batchState.running=false;state.uploading=false;state.uploadLock=false;$('batchProgressPanel').hidden=true;renderBatch();controls();
    if(!failure&&batchState.jobs.every(j=>j.status==='complete'))$('batchSubmit').textContent='全部完成';
  }
};
renderBatch();
