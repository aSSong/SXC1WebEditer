'use strict';
let editContext=null,lastEditReport=null;
const editDialog=$('editDialog');
function syncPadControls(){
  const clip=state.clipboard;$('clipboardBar').hidden=!clip;$('clearClipboard').disabled=state.busy;
  if(clip){$('clipboardTitle').textContent=`已复制 Bank ${pad2(clip.bank)} / Pad ${pad2(clip.pad)}`;$('clipboardDetail').textContent=`${clip.files.length} 个原始文件 · ${size(clip.files.reduce((n,f)=>n+f.raw.length,0))} · 选择任意 Bank 的空 Pad 粘贴`}
  if(editDialog.open){for(const el of editDialog.querySelectorAll('input,select,button'))el.disabled=state.busy;$('editSave').disabled=state.busy||state.mode!=='live'}
}
$('clearClipboard').onclick=()=>{if(state.busy)return;state.clipboard=null;render()};
async function copyPad(pad){
  if(state.busy||state.mode!=='live')return;stopAudio();
  await run('读取完整 Pad 到剪贴板…',async()=>{
    const clip=await SXCPad.snapshot(state.midi,{bank:state.bank,pad,audio:true,checkpoint:checkAbort,progress});checkAbort();
    state.clipboard=clip;state.entries=clip.allEntries;state.padSettings.set(state.bank+':'+pad,clip.values);
    for(const f of clip.files)state.cache.set(pad2(pad)+f.suffix,f.raw);
    notice(`已复制 Bank ${pad2(clip.bank)} / Pad ${pad2(pad)}，包含音频、波形和完整 Pad 设置。选择一个空 Pad 粘贴。`);
  });
}
async function pastePad(pad){
  if(state.busy||state.mode!=='live'||!state.clipboard)return;
  if(SXCUpload.occupied(state.entries,pad)){notice('只能粘贴到空 Pad。',true);return}
  stopAudio();const bank=state.bank,clip=state.clipboard;let failure=null;state.uploading=true;
  await run('将完整 Pad 复制到机器…',async()=>{
    try{
      await state.midi.selectBank(bank);checkAbort();
      const result=await SXCPad.paste(state.midi,clip,{bank,pad,checkpoint:checkAbort,progress,journal:uploadJournal});
      state.entries=result.after;state.padSettings.set(bank+':'+pad,clip.values.slice());
      for(const f of clip.files)state.cache.set(pad2(pad)+f.suffix,f.raw);
      notice(`复制完成：Bank ${pad2(clip.bank)} / Pad ${pad2(clip.pad)} → Bank ${pad2(bank)} / Pad ${pad2(pad)}。原始文件与机器加载的设置均已核对。`);
    }catch(e){failure=e.uploadReport;throw e}
  });
  state.uploading=false;state.uploadLock=false;controls();
  if(failure)notice(failure.state==='needs_verification'?'复制的加载结果待核对。请重新连接并检查目标 Pad，记录已保留。':`复制未完成，尚未加载到目标 Pad：${failure.error}`,true);
}
function closeEditor(){if(state.busy)return;editDialog.close();editContext=null}
$('editClose').onclick=closeEditor;$('editCancel').onclick=closeEditor;
editDialog.addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
for(let i=0;i<=16;i++)$('editGroup').append(new Option(i?`Group ${i}`:'0 · 不分组',String(i)));
SXCPad.colors.forEach(([name,color],index)=>{
  const label=document.createElement('label');label.className='color-option';label.style.setProperty('--swatch',color);
  const radio=document.createElement('input');radio.type='radio';radio.name='editColor';radio.value=index;radio.setAttribute('aria-label',`LED ${index+1} ${name}`);
  const swatch=document.createElement('i');swatch.setAttribute('aria-hidden','true');label.append(radio,swatch,document.createTextNode(`${index+1} · ${name}`));$('editColors').append(label);
});
for(const field of ['Level','Pitch','Pan']){
  $('edit'+field+'Range').oninput=()=>{$('edit'+field).value=$('edit'+field+'Range').value;$('editMessage').textContent='尚未保存';$('editMessage').classList.remove('error')};
  $('edit'+field).oninput=()=>{const v=$('edit'+field).valueAsNumber;if(Number.isFinite(v))$('edit'+field+'Range').value=v};
}
async function openEditor(pad){
  if(state.busy||state.mode!=='live')return;stopAudio();let context=null;
  await run('读取 Pad 设置…',async()=>{
    context=await SXCPad.snapshot(state.midi,{bank:state.bank,pad,checkpoint:checkAbort});checkAbort();
    state.entries=context.allEntries;state.padSettings.set(state.bank+':'+pad,context.values);
  });
  if(!context||state.mode!=='live')return;editContext=context;const v=context.values;
  $('editTitle').textContent=`Bank ${pad2(context.bank)} / Pad ${pad2(pad)}`;
  $('editDescription').textContent=`${context.wav.name} · ${size(context.wav.bytes)} · 修改播放与灯光设置，保存后写入机器。`;
  for(const [field,value] of [['Level',v[3]],['Pitch',v[2]-39],['Pan',v[9]-25]]){$('edit'+field).value=value;$('edit'+field+'Range').value=value}
  $('editGroup').value=String(v[4]);$('editBpm').value=v[8];$('editOneshot').checked=!!v[0];$('editLoop').checked=!!v[1];
  for(const radio of document.querySelectorAll('[name="editColor"]'))radio.checked=Number(radio.value)===v[7];
  $('editMessage').textContent='关闭或取消不会写入机器。';$('editMessage').classList.remove('error');editDialog.showModal();syncPadControls();
}
function editPatch(){
  return {0:Number($('editOneshot').checked),1:Number($('editLoop').checked),2:$('editPitch').valueAsNumber+39,3:$('editLevel').valueAsNumber,4:Number($('editGroup').value),7:Number(document.querySelector('[name="editColor"]:checked')?.value),8:$('editBpm').valueAsNumber,9:$('editPan').valueAsNumber+25};
}
function editJournal(report){
  lastEditReport=report;try{localStorage.setItem('sxc-last-edit',JSON.stringify(report))}catch{}
  $('editReceipt').hidden=false;
  $('editReceiptText').textContent=`Bank ${pad2(report.bank)} / Pad ${pad2(report.pad)} · ${report.state==='complete'?'设置已保存并核对':report.state==='needs_verification'?'设置修改结果待核对':report.state==='incomplete'?'未写入设置':'正在保存设置'}`;
  state.editLock=['writing','verifying','needs_verification'].includes(report.state);controls();
}
$('editForm').onsubmit=async event=>{
  event.preventDefault();if(state.busy||state.mode!=='live'||!editContext)return;
  let patch;try{patch=editPatch();SXCPad.patchValues(editContext.values,patch)}catch(e){$('editMessage').textContent=e.message;$('editMessage').classList.add('error');return}
  let result=null,failure=null;state.editSaving=true;$('editMessage').textContent='正在保存并核对机器上的设置…';$('editMessage').classList.remove('error');
  await run('保存 Pad 设置…',async()=>{
    try{result=await SXCPad.save(state.midi,editContext,patch,{checkpoint:checkAbort,progress,journal:editJournal});state.entries=result.snapshot.allEntries;state.cache.delete(result.snapshot.dbName);state.padSettings.set(state.bank+':'+editContext.pad,result.snapshot.values)}
    catch(e){failure=e;throw e}
  });
  state.editSaving=false;state.editLock=false;controls();
  if(result){editDialog.close();notice(`Bank ${pad2(editContext.bank)} / Pad ${pad2(editContext.pad)} 设置已保存，实时参数与机器设置文件均已核对。`);editContext=null}
  else{$('editMessage').classList.add('error');$('editMessage').textContent=failure?.editReport?.state==='needs_verification'?'部分参数可能已写入。请关闭弹窗，重新连接并打开此 Pad 核对；修改前设置保留在编辑记录中。':`${failure?.message||'保存失败'}。未写入参数，请关闭后重新连接读取。`}
};
$('editReceiptDownload').onclick=()=>{if(lastEditReport)saveBlob(new Blob([JSON.stringify(lastEditReport,null,2)+'\n'],{type:'application/json'}),`SXC-1_编辑记录_Bank${pad2(lastEditReport.bank)}_Pad${pad2(lastEditReport.pad)}.json`)};
try{const report=JSON.parse(localStorage.getItem('sxc-last-edit'));if(report?.format==='sxc-pad-edit-v1'&&Number.isInteger(report.bank)&&Number.isInteger(report.pad)){editJournal(report);state.editLock=false}}catch{}
window.addEventListener('beforeunload',e=>{if(state.editSaving){e.preventDefault();e.returnValue=''}});
syncPadControls();
