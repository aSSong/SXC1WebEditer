'use strict';
let preparedUpload=null,prepareToken=0,uploadPreviewURL=null,lastUploadReport=null;
const uploadDialog=$('uploadDialog');
function resetUploadPreview(){
  preparedUpload=null;prepareToken++;$('uploadAudio').pause();$('uploadAudio').removeAttribute('src');
  if(uploadPreviewURL)URL.revokeObjectURL(uploadPreviewURL);uploadPreviewURL=null;
  $('uploadPreview').hidden=true;$('uploadSubmit').disabled=true;$('uploadConverted').disabled=true;
}
function closeUpload(){resetUploadPreview();uploadDialog.close()}
function openUpload(target){
  if(state.busy||state.mode!=='live')return;stopAudio();resetUploadPreview();
  const empty=Array.from({length:16},(_,i)=>i+1).filter(p=>!SXCUpload.occupied(state.entries,p));
  if(!empty.length){notice('本页没有空 Pad，请切换 Bank。');return}
  $('uploadTitle').textContent='上传到 Bank '+pad2(state.bank);
  $('uploadTarget').replaceChildren(...empty.map(p=>new Option('Pad '+pad2(p)+' · 空',String(p))));
  $('uploadTarget').value=String(empty.includes(target)?target:empty[0]);
  $('uploadInput').disabled=false;$('uploadTarget').disabled=false;$('uploadInput').value='';$('uploadMessage').textContent='文件只在这台电脑处理。';$('uploadMessage').classList.remove('error');uploadDialog.showModal();
}
$('uploadOpen').onclick=()=>openUpload();$('uploadClose').onclick=closeUpload;
uploadDialog.addEventListener('cancel',e=>{e.preventDefault();closeUpload()});
$('uploadInput').onchange=()=>prepareUploadFile($('uploadInput').files[0]);
async function prepareUploadFile(file,autoUpload=false){
  resetUploadPreview();const token=prepareToken;if(!file)return;
  $('uploadTarget').disabled=autoUpload;$('uploadInput').disabled=autoUpload;
  $('uploadMessage').textContent='正在检查音频并准备试听…';$('uploadMessage').classList.remove('error');
  try{
    if(file.size>SXCUpload.MAX_INPUT)throw Error('文件超过 64 MB，请先裁剪或重新导出。');
    const result=await SXCUpload.prepare(new Uint8Array(await file.arrayBuffer()));
    if(token!==prepareToken)return;
    preparedUpload={...result,name:file.name};const i=result.source;
    $('uploadFilename').textContent=file.name;$('uploadFormat').textContent=`${i.duration.toFixed(2)} 秒 · ${i.rate/1000} kHz · ${i.bits}-bit ${i.format===3?'Float':'PCM'} · ${i.channels===1?'单声道':'双声道'}`;
    waveform($('uploadWave'),result.raw);uploadPreviewURL=URL.createObjectURL(new Blob([result.raw],{type:'audio/wav'}));$('uploadAudio').src=uploadPreviewURL;
    $('uploadPreview').hidden=false;$('uploadSubmit').disabled=false;$('uploadConverted').disabled=false;
    $('uploadMessage').textContent=result.clipped?'已准备好。转换时少量峰值超过满幅并已限制，建议试听确认。':'已准备好，含机器屏幕所需的波形。';
    if(autoUpload)await submitPreparedUpload();
  }catch(e){if(token!==prepareToken)return;$('uploadMessage').textContent=e.message;$('uploadMessage').classList.add('error')}
  finally{if(token===prepareToken){$('uploadTarget').disabled=false;$('uploadInput').disabled=false}}
}
$('uploadConverted').onclick=()=>{if(preparedUpload)saveBlob(new Blob([preparedUpload.raw],{type:'audio/wav'}),preparedUpload.name.replace(/\.wav$/i,'')+'_SXC-48k16.wav')};
function showReceipt(r){
  lastUploadReport=r;$('uploadReceipt').hidden=false;
  const result=r.state==='complete'?(r.action==='copy'?'已复制并核对':'已上传并核对'):state.uploading&&r.state==='staging'?'正在传送':state.uploading&&['registering','verifying'].includes(r.state)?'正在加载并核对':r.state==='needs_verification'||['registering','verifying'].includes(r.state)?'加载结果待核对':'上传未完成';
  $('receiptText').textContent=`Bank ${pad2(r.bank)} / Pad ${pad2(r.pad)} · ${result}`;
}
function uploadJournal(r){
  showReceipt(r);try{localStorage.setItem('sxc-last-upload',JSON.stringify(r))}catch{}
  state.uploadLock=['registering','verifying','needs_verification'].includes(r.state);controls();
}
$('receiptDownload').onclick=()=>{if(lastUploadReport)saveBlob(new Blob([JSON.stringify(lastUploadReport,null,2)+'\n'],{type:'application/json'}),`SXC-1_上传记录_Bank${pad2(lastUploadReport.bank)}_Pad${pad2(lastUploadReport.pad)}.json`)};
$('uploadSubmit').onclick=submitPreparedUpload;
async function submitPreparedUpload(){
  if(!preparedUpload||state.busy||state.mode!=='live')return;
  const input=preparedUpload,bank=state.bank,pad=Number($('uploadTarget').value);let result=null,failure=null;
  closeUpload();state.uploading=true;
  await run('检查目标 Pad…',async()=>{
    try{
      await state.midi.selectBank(bank);checkAbort();
      result=await SXCUpload.upload(state.midi,{bank,pad,raw:input.raw,sourceName:input.name,checkpoint:checkAbort,progress,journal:uploadJournal});
      state.entries=result.after;state.cache.set(pad2(pad)+'.wav',input.raw);
      notice(`上传完成：Bank ${pad2(bank)} / Pad ${pad2(pad)}。音频和设置已从机器读回并核对，可按机器上的 Pad 试听。`);
    }catch(e){failure=e.uploadReport;throw e}
  });
  state.uploading=false;state.uploadLock=false;controls();
  if(failure){
    const uncertain=failure.state==='needs_verification';
    notice(uncertain?`Bank ${pad2(bank)} / Pad ${pad2(pad)} 的加载结果尚未核对完成。请重新连接并刷新该 Bank，先检查现有内容；上传记录已保留。`:`上传${state.aborted?'已取消':'未完成'}，尚未执行 Pad 加载。${state.aborted?'':failure.error+' '}请重新连接后继续；临时文件的位置见上传记录。`,!state.aborted||uncertain);
  }
}
function dragHasFiles(event){return [...(event.dataTransfer?.types||[])].includes('Files')}
function dragPad(event){const card=event.target.closest?.('#pads .pad');return card&&{card,pad:Number(card.dataset.pad)}}
function canDrop(pad){return state.mode==='live'&&!state.busy&&!uploadDialog.open&&Number.isInteger(pad)&&pad>=1&&pad<=16&&!SXCUpload.occupied(state.entries,pad)}
function clearDropMarks(){document.querySelectorAll('.pad.drop-target').forEach(c=>c.classList.remove('drop-target'));$('pads').classList.remove('dragging')}
document.addEventListener('dragover',event=>{
  if(!dragHasFiles(event))return;event.preventDefault();const target=dragPad(event),allowed=target&&canDrop(target.pad);
  event.dataTransfer.dropEffect=allowed?'copy':'none';clearDropMarks();
  if(state.mode==='live'&&!state.busy)$('pads').classList.add('dragging');
  if(allowed)target.card.classList.add('drop-target');
});
document.addEventListener('dragleave',event=>{if(!event.relatedTarget)clearDropMarks()});
document.addEventListener('dragend',clearDropMarks);
document.addEventListener('drop',event=>{
  if(!dragHasFiles(event))return;event.preventDefault();clearDropMarks();const target=dragPad(event);
  if(!target)return;
  if(!canDrop(target.pad)){notice(state.busy?'请等待当前操作完成。':state.mode!=='live'?'请先连接 SXC-1。':'这个 Pad 已有内容，仅空 Pad 接受拖入。',true);return}
  const files=[...event.dataTransfer.files];
  if(files.length!==1){notice('每次请拖入一个 WAV 文件。',true);return}
  if(!/\.wav$/i.test(files[0].name)){notice('请拖入 WAV 文件。',true);return}
  openUpload(target.pad);prepareUploadFile(files[0],true);
});
try{const r=JSON.parse(localStorage.getItem('sxc-last-upload'));if(r?.format==='sxc-upload-v1'&&Number.isInteger(r.bank)&&Number.isInteger(r.pad))showReceipt(r)}catch{}
window.addEventListener('beforeunload',e=>{if(state.uploading){e.preventDefault();e.returnValue=''}});
