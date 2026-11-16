'use strict';
const batchDialog=$('batchDialog');
const batchState={jobs:[],ignored:0,running:false,collecting:false,stop:false,attempted:false,conflicts:[],rows:[]};
const batchLabels={queued:SXCI18n.msg('待检查'),checking:SXCI18n.msg('校验音频…'),ready:SXCI18n.msg('已就绪'),uploading:SXCI18n.msg('正在上传…'),complete:SXCI18n.msg('已完成'),invalid:SXCI18n.msg('音频无效'),uncertain:SXCI18n.msg('待核对'),failed:SXCI18n.msg('待重试')};
const batchLocked=()=>batchState.jobs.some(j=>['complete','uncertain'].includes(j.status));
const batchStart=()=>({bank:Number($('batchBank').value),pad:Number($('batchPad').value)});
function batchMessage(text,error=false){SXCI18n.text($('batchMessage'),SXCI18n.raw(text));$('batchMessage').classList.toggle('error',error)}
function syncBatchControls(){
  const busy=state.busy||batchState.running||batchState.collecting,locked=batchLocked(),jobs=batchState.jobs,done=jobs.filter(j=>j.status==='complete').length;
  $('batchOpen').disabled=state.busy||batchState.collecting;
  for(const id of ['batchFilesButton','batchFolderButton','batchFiles','batchFolder'])$(id).disabled=busy||locked;
  $('batchBank').disabled=busy||locked;$('batchPad').disabled=busy||locked;
  $('batchClear').disabled=busy||!jobs.length;$('batchClose').disabled=busy;
  $('batchConnect').hidden=state.mode==='live';$('batchConnect').disabled=busy;
  $('batchSubmit').disabled=busy||state.mode!=='live'||!jobs.length||done===jobs.length;
  SXCI18n.text($('batchSubmit'),SXCI18n.msg(done&&done<jobs.length?'重试剩余采样':batchState.attempted?'重试上传':'检查并上传'));
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
  SXCI18n.text($('batchCount'),jobs.length?SXCI18n.msg('{count} 个采样 · 已完成 {done} 个',{count:jobs.length,done}):SXCI18n.msg('尚未选择音频'));
  SXCI18n.text($('batchRange'),rangeError?SXCI18n.raw(rangeError):targets.length?SXCI18n.msg('{first} → {last}',{first:SXCI18n.raw(SXCBatch.label(targets[0])),last:SXCI18n.raw(SXCBatch.label(targets[targets.length-1]))}):SXCI18n.msg('选择文件后显示填充范围'));
  $('batchRange').classList.toggle('error',!!rangeError);
  SXCI18n.text($('batchIgnored'),batchState.ignored?SXCI18n.msg('已跳过 {count} 个隐藏或非音频文件。',{count:batchState.ignored}):'');
  $('batchListEmpty').hidden=!!jobs.length;$('batchTable').hidden=!jobs.length;
  batchState.rows=[];const fragment=document.createDocumentFragment();
  jobs.forEach((job,i)=>{
    const row=document.createElement('tr'),order=document.createElement('td'),fileCell=document.createElement('td'),target=document.createElement('td'),status=document.createElement('td'),action=document.createElement('td');
    order.textContent=String(i+1);order.className='batch-order';
    const name=document.createElement('strong'),detail=document.createElement('small');name.textContent=job.path;name.title=job.path;
    SXCI18n.text(detail,job.info?SXCI18n.msg('{size} · {duration} 秒',{size:size(job.file.size),duration:job.info.duration.toFixed(2)}):size(job.file.size));fileCell.className='batch-file';fileCell.append(name,detail);
    SXCI18n.text(target,targets[i]?SXCI18n.msg('{bank} / {pad}',{bank:pad2(targets[i].bank),pad:pad2(targets[i].pad)}):SXCI18n.msg('超出范围'));target.className='batch-target';
    SXCI18n.text(status,batchLabels[job.status]);status.className='batch-status';status.dataset.state=job.status;if(job.error)SXCI18n.attr(status,'title',SXCI18n.raw(job.error));
    if(targets[i]&&batchState.conflicts.some(t=>t.bank===targets[i].bank&&t.pad===targets[i].pad)){SXCI18n.text(status,SXCI18n.msg('位置已占用'));status.dataset.state='invalid'}
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.className='batch-remove';SXCI18n.attr(remove,'aria-label',SXCI18n.msg('移除 {path}',{path:job.path}));
    remove.onclick=()=>{if(state.busy||batchLocked())return;jobs.splice(i,1);batchState.conflicts=[];batchMessage(SXCI18n.msg('列表已更新，点击重试会重新检查全部目标位置。'));renderBatch()};
    action.append(remove);row.append(order,fileCell,target,status,action);fragment.append(row);batchState.rows.push({row,status,detail,remove});
  });
  $('batchRows').replaceChildren(fragment);syncBatchControls();
}
function updateBatchJob(job){
  const row=batchState.rows[batchState.jobs.indexOf(job)];if(!row)return;
  if(job.status==='uploading'&&!batchState.stop)batchMessage(SXCI18n.msg('空位与音频检查已通过，正在顺序上传。请保持连接；可点击“停止”在当前采样核对完成后暂停。'));
  SXCI18n.text(row.status,batchLabels[job.status]);row.status.dataset.state=job.status;SXCI18n.attr(row.status,'title',SXCI18n.raw(job.error||''));
  SXCI18n.text(row.detail,job.info?SXCI18n.msg('{size} · {duration} 秒',{size:size(job.file.size),duration:job.info.duration.toFixed(2)}):size(job.file.size));
  SXCI18n.text($('batchCount'),SXCI18n.msg('{count} 个采样 · 已完成 {done} 个',{count:batchState.jobs.length,done:batchState.jobs.filter(j=>j.status==='complete').length}));
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
for(let n=1;n<=80;n++){const option=new Option('',String(n));SXCI18n.text(option,SXCI18n.msg('Bank {bank}',{bank:pad2(n)}));$('batchBank').append(option)}
for(let n=1;n<=16;n++){const option=new Option('',String(n));SXCI18n.text(option,SXCI18n.msg('Pad {pad}',{pad:pad2(n)}));$('batchPad').append(option)}
for(const id of ['batchBank','batchPad'])$(id).onchange=()=>{batchState.conflicts=[];renderBatch();batchMessage(SXCI18n.msg('点击上传后会重新检查整个填充范围。'))};
$('batchFilesButton').onclick=()=>$('batchFiles').click();$('batchFolderButton').onclick=()=>$('batchFolder').click();
async function chooseBatch(getSelection){
  if(state.busy||batchState.running||batchState.collecting||batchLocked())return;
  batchState.collecting=true;syncBatchControls();batchMessage(SXCI18n.msg('正在读取文件列表…'));
  try{const selected=await getSelection();batchState.jobs=selected.jobs;batchState.ignored=selected.ignored;batchState.attempted=false;batchState.conflicts=[];batchMessage(SXCI18n.msg('文件已按路径和名称排序。设置起点后，点击“检查并上传”。'))}
  catch(e){batchMessage(SXCI18n.msg('{error} 原有列表未改变。',{error:SXCI18n.raw(e.message)}),true)}
  finally{batchState.collecting=false;renderBatch()}
}
for(const id of ['batchFiles','batchFolder'])$(id).onchange=()=>{const files=[...$(id).files];$(id).value='';if(files.length)chooseBatch(()=>SXCBatch.fromFiles(files))};
$('batchClear').onclick=()=>{if(state.busy||batchState.collecting)return;batchState.jobs=[];batchState.ignored=0;batchState.attempted=false;batchState.conflicts=[];batchMessage(SXCI18n.msg('列表已清空。机器上已经上传的采样会保留。'));renderBatch()};
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
$('batchConnect').onclick=async()=>{if(state.busy)return;await $('connect').onclick();batchMessage(SXCI18n.msg(state.mode==='live'?'已连接。文件列表保留，可以开始或重试上传。':'连接未完成。文件列表保留，请连接机器后重试。'),state.mode!=='live');syncBatchControls()};
$('batchStop').onclick=()=>{batchState.stop=true;batchMessage(SXCI18n.msg('正在停止：如已有采样在传送，将先完成当前 Pad 的加载与核对。'));syncBatchControls()};
$('batchReceipt').onclick=()=>{
  const report={format:'sxc-batch-v1',created_at:new Date().toISOString(),...batchStart(),files:batchState.jobs.map(({path,status,target,info,error,report})=>({path,status,target,info,error,report}))};
  saveBlob(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),SXCI18n.t('SXC-1_批量上传记录_{date}.json',{date:localDate()}));
};
$('batchSubmit').onclick=async()=>{
  if(state.busy||batchState.collecting||state.mode!=='live'||!batchState.jobs.length)return;
  const midi=state.midi;batchState.running=true;batchState.stop=false;batchState.attempted=true;batchState.conflicts=[];state.uploading=true;stopAudio();renderBatch();
  batchMessage(SXCI18n.msg('正在检查连续空位，检查完成前不会写入采样。'));$('batchProgressPanel').hidden=false;let failure=null;
  const batchProgress=(text,pct)=>{progress(text,pct);SXCI18n.text($('batchProgressText'),SXCI18n.raw(text));if(pct==null)$('batchProgress').removeAttribute('value');else $('batchProgress').value=pct};
  try{
    await run(SXCI18n.msg('检查批量上传目标…'),async()=>{
      try{
        await SXCBatch.execute(midi,batchState.jobs,{...batchStart(),
          checkpoint:()=>{checkAbort();if(batchState.stop)throw new SXCBatch.BatchError('cancelled','已停止，文件列表和已完成进度均保留。点击重试可继续剩余采样。')},
          progress:batchProgress,change:updateBatchJob,journal:uploadJournal,
          completed:job=>{if(state.bank!==job.target.bank){state.cache.clear();state.padSettings.clear()}state.bank=job.target.bank;state.entries=job.report.after;state.padSettings.set(state.bank+':'+job.target.pad,SXCPad.parseDb(SXCUpload.defaults()))}
        });
        batchMessage(SXCI18n.msg('批量上传完成：{count} 个采样均已读回核对。',{count:batchState.jobs.length}));notice(SXCI18n.msg('批量上传完成，所有采样均已核对。'));
        await loadBank();
      }catch(e){
        failure=e;batchState.conflicts=e.conflicts||[];
        if(e instanceof SXCBatch.BatchError){
          const invalid=e.code==='audio'&&batchState.jobs.find(job=>job.status==='invalid'&&job.error);
          const message=invalid?SXCI18n.msg('{path}：{error} 尚未开始本轮上传；可移除此文件后重试。',{path:invalid.path,error:SXCI18n.raw(invalid.error)}):SXCI18n.raw(e.message);
          batchMessage(message,e.code!=='cancelled');notice(message,e.code!=='cancelled');
        }
        else{batchMessage(SXCI18n.msg('上传已停止：{error}。列表与已完成进度已保留，请重新连接后重试。',{error:SXCI18n.raw(e.message)}),true);throw e}
      }
    });
  }finally{
    batchState.running=false;state.uploading=false;state.uploadLock=false;$('batchProgressPanel').hidden=true;renderBatch();controls();
    if(!failure&&batchState.jobs.every(j=>j.status==='complete'))SXCI18n.text($('batchSubmit'),SXCI18n.msg('全部完成'));
  }
};
renderBatch();
