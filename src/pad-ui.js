'use strict';
let editContext=null,lastEditReport=null;
const editDialog=$('editDialog');
function syncPadControls(){
  const clip=state.clipboard;$('clipboardBar').hidden=!clip;$('clearClipboard').disabled=state.busy;
  if(clip){SXCI18n.text($('clipboardTitle'),SXCI18n.msg('已复制 Bank {bank} / Pad {pad}',{bank:pad2(clip.bank),pad:pad2(clip.pad)}));SXCI18n.text($('clipboardDetail'),SXCI18n.msg('{count} 个原始文件 · {size} · 选择任意 Bank 的空 Pad 粘贴',{count:clip.files.length,size:size(clip.files.reduce((n,f)=>n+f.raw.length,0))}))}
  if(editDialog.open){for(const el of editDialog.querySelectorAll('input,select,button'))el.disabled=state.busy;$('editSave').disabled=state.busy||state.mode!=='live'}
}
$('clearClipboard').onclick=()=>{if(state.busy)return;state.clipboard=null;render()};
async function copyPad(pad){
  if(state.busy||state.mode!=='live')return;stopAudio();
  await run(SXCI18n.msg('读取完整 Pad 到剪贴板…'),async()=>{
    const clip=await SXCPad.snapshot(state.midi,{bank:state.bank,pad,audio:true,checkpoint:checkAbort,progress});checkAbort();
    state.clipboard=clip;state.entries=clip.allEntries;state.padSettings.set(state.bank+':'+pad,clip.values);
    for(const f of clip.files)state.cache.set(pad2(pad)+f.suffix,f.raw);
    notice(SXCI18n.msg('已复制 Bank {bank} / Pad {pad}，包含音频、波形和完整 Pad 设置。选择一个空 Pad 粘贴。',{bank:pad2(clip.bank),pad:pad2(pad)}));
  });
}
async function pastePad(pad){
  if(state.busy||state.mode!=='live'||!state.clipboard)return;
  if(SXCUpload.occupied(state.entries,pad)){notice(SXCI18n.msg('只能粘贴到空 Pad。'),true);return}
  stopAudio();const bank=state.bank,clip=state.clipboard;let failure=null;state.uploading=true;
  await run(SXCI18n.msg('将完整 Pad 复制到机器…'),async()=>{
    try{
      await state.midi.selectBank(bank);checkAbort();
      const result=await SXCPad.paste(state.midi,clip,{bank,pad,checkpoint:checkAbort,progress,journal:uploadJournal});
      state.entries=result.after;state.padSettings.set(bank+':'+pad,clip.values.slice());
      for(const f of clip.files)state.cache.set(pad2(pad)+f.suffix,f.raw);
      notice(SXCI18n.msg('复制完成：Bank {sourceBank} / Pad {sourcePad} → Bank {bank} / Pad {pad}。原始文件与机器加载的设置均已核对。',{sourceBank:pad2(clip.bank),sourcePad:pad2(clip.pad),bank:pad2(bank),pad:pad2(pad)}));
    }catch(e){failure=e.uploadReport;throw e}
  });
  state.uploading=false;state.uploadLock=false;controls();
  if(failure)notice(failure.state==='needs_verification'?SXCI18n.msg('复制的加载结果待核对。请重新连接并检查目标 Pad，记录已保留。'):SXCI18n.msg('复制未完成，尚未加载到目标 Pad：{error}',{error:SXCI18n.raw(failure.error)}),true);
}
function closeEditor(){if(state.busy)return;editDialog.close();editContext=null}
$('editClose').onclick=closeEditor;$('editCancel').onclick=closeEditor;
editDialog.addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
for(let i=0;i<=16;i++){const option=new Option('',String(i));SXCI18n.text(option,i?SXCI18n.msg('Group {group}',{group:i}):SXCI18n.msg('0 · 不分组'));$('editGroup').append(option)}
SXCPad.colors.forEach(([name,color],index)=>{
  const label=document.createElement('label');label.className='color-option';label.style.setProperty('--swatch',color);
  const radio=document.createElement('input');radio.type='radio';radio.name='editColor';radio.value=index;SXCI18n.attr(radio,'aria-label',SXCI18n.msg('LED {number} {color}',{number:index+1,color:SXCI18n.raw(name)}));
  const swatch=document.createElement('i');swatch.setAttribute('aria-hidden','true');const caption=document.createElement('span');SXCI18n.text(caption,SXCI18n.msg('{number} · {color}',{number:index+1,color:SXCI18n.raw(name)}));label.append(radio,swatch,caption);$('editColors').append(label);
});
for(const field of ['Level','Pitch','Pan']){
  $('edit'+field+'Range').oninput=()=>{$('edit'+field).value=$('edit'+field+'Range').value;SXCI18n.text($('editMessage'),SXCI18n.msg('尚未保存'));$('editMessage').classList.remove('error')};
  $('edit'+field).oninput=()=>{const v=$('edit'+field).valueAsNumber;if(Number.isFinite(v))$('edit'+field+'Range').value=v};
}
async function openEditor(pad){
  if(state.busy||state.mode!=='live')return;stopAudio();let context=null;
  await run(SXCI18n.msg('读取 Pad 设置…'),async()=>{
    context=await SXCPad.snapshot(state.midi,{bank:state.bank,pad,checkpoint:checkAbort});checkAbort();
    state.entries=context.allEntries;state.padSettings.set(state.bank+':'+pad,context.values);
  });
  if(!context||state.mode!=='live')return;editContext=context;const v=context.values;
  SXCI18n.text($('editTitle'),SXCI18n.msg('Bank {bank} / Pad {pad}',{bank:pad2(context.bank),pad:pad2(pad)}));
  SXCI18n.text($('editDescription'),SXCI18n.msg('{name} · {size} · 修改播放与灯光设置，保存后写入机器。',{name:context.wav.name,size:size(context.wav.bytes)}));
  for(const [field,value] of [['Level',v[3]],['Pitch',v[2]-39],['Pan',v[9]-25]]){$('edit'+field).value=value;$('edit'+field+'Range').value=value}
  $('editGroup').value=String(v[4]);$('editBpm').value=v[8];$('editOneshot').checked=!!v[0];$('editLoop').checked=!!v[1];
  for(const radio of document.querySelectorAll('[name="editColor"]'))radio.checked=Number(radio.value)===v[7];
  SXCI18n.text($('editMessage'),SXCI18n.msg('关闭或取消不会写入机器。'));$('editMessage').classList.remove('error');editDialog.showModal();syncPadControls();
}
function editPatch(){
  return {0:Number($('editOneshot').checked),1:Number($('editLoop').checked),2:$('editPitch').valueAsNumber+39,3:$('editLevel').valueAsNumber,4:Number($('editGroup').value),7:Number(document.querySelector('[name="editColor"]:checked')?.value),8:$('editBpm').valueAsNumber,9:$('editPan').valueAsNumber+25};
}
function editJournal(report){
  lastEditReport=report;try{localStorage.setItem('sxc-last-edit',JSON.stringify(report))}catch{}
  $('editReceipt').hidden=false;
  SXCI18n.text($('editReceiptText'),SXCI18n.msg('Bank {bank} / Pad {pad} · {result}',{bank:pad2(report.bank),pad:pad2(report.pad),result:SXCI18n.msg(report.state==='complete'?'设置已保存并核对':report.state==='needs_verification'?'设置修改结果待核对':report.state==='incomplete'?'未写入设置':'正在保存设置')}));
  state.editLock=['writing','verifying','needs_verification'].includes(report.state);controls();
}
$('editForm').onsubmit=async event=>{
  event.preventDefault();if(state.busy||state.mode!=='live'||!editContext)return;
  let patch;try{patch=editPatch();SXCPad.patchValues(editContext.values,patch)}catch(e){SXCI18n.text($('editMessage'),SXCI18n.raw(e.message));$('editMessage').classList.add('error');return}
  let result=null,failure=null;state.editSaving=true;SXCI18n.text($('editMessage'),SXCI18n.msg('正在保存并核对机器上的设置…'));$('editMessage').classList.remove('error');
  await run(SXCI18n.msg('保存 Pad 设置…'),async()=>{
    try{result=await SXCPad.save(state.midi,editContext,patch,{checkpoint:checkAbort,progress,journal:editJournal});state.entries=result.snapshot.allEntries;state.cache.delete(result.snapshot.dbName);state.padSettings.set(state.bank+':'+editContext.pad,result.snapshot.values)}
    catch(e){failure=e;throw e}
  });
  state.editSaving=false;state.editLock=false;controls();
  if(result){editDialog.close();notice(SXCI18n.msg('Bank {bank} / Pad {pad} 设置已保存，实时参数与机器设置文件均已核对。',{bank:pad2(editContext.bank),pad:pad2(editContext.pad)}));editContext=null}
  else{$('editMessage').classList.add('error');SXCI18n.text($('editMessage'),failure?.editReport?.state==='needs_verification'?SXCI18n.msg('部分参数可能已写入。请关闭弹窗，重新连接并打开此 Pad 核对；修改前设置保留在编辑记录中。'):SXCI18n.msg('{error}。未写入参数，请关闭后重新连接读取。',{error:SXCI18n.raw(failure?.message||'保存失败')}))}
};
$('editReceiptDownload').onclick=()=>{if(lastEditReport)saveBlob(new Blob([JSON.stringify(lastEditReport,null,2)+'\n'],{type:'application/json'}),SXCI18n.t('SXC-1_编辑记录_Bank{bank}_Pad{pad}.json',{bank:pad2(lastEditReport.bank),pad:pad2(lastEditReport.pad)}))};
try{const report=JSON.parse(localStorage.getItem('sxc-last-edit'));if(report?.format==='sxc-pad-edit-v1'&&Number.isInteger(report.bank)&&Number.isInteger(report.pad)){editJournal(report);state.editLock=false}}catch{}
window.addEventListener('beforeunload',e=>{if(state.editSaving){e.preventDefault();e.returnValue=''}});
syncPadControls();
