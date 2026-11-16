'use strict';
let backupPicking=false;
function syncBackupControls(){
  $('backupAll').disabled=state.busy||backupPicking||state.mode!=='live';
  if(typeof syncLibraryActions==='function')syncLibraryActions();
}
function backupProgress(event){
  const {phase,stage,bank,pad,name,loaded=0,total=0,scannedBanks=0}=event;
  const target={bank:pad2(bank||1),pad:pad2(pad||1),name:name||''};
  if(phase==='scan'){
    const source=stage==='final'?'正在复查 Bank {bank} / 80…':stage==='initial'?'正在检查 Bank {bank} / 80…':'正在核对 Bank {bank} 是否变化…';
    progress(SXCI18n.msg(source,{bank:pad2(bank||scannedBanks)}),stage==='initial'?scannedBanks/80*100:stage==='final'?bank/80*100:null);
  }
  else if(phase==='read')progress(SXCI18n.msg('正在备份 Bank {bank} / Pad {pad} · {name} · {loaded} / {total}',{...target,loaded:size(loaded),total:size(total)}),total?loaded/total*100:null);
  else if(phase==='save')progress(SXCI18n.msg('正在保存 Bank {bank} / Pad {pad} · {name}',target),null);
  else if(phase==='verify')progress(SXCI18n.msg('正在核对备份文件 · {name}',target),null);
}
function backupError(error){
  const messages={
    'invalid-options':'备份选项无效。',
    'invalid-folder':'备份文件夹名称无效。',
    'folder-exists':'目标备份子文件夹已存在。请重新开始以创建新文件夹。',
    'invalid-directory':'设备目录响应无效。',
    'invalid-entry':'设备文件名或长度无效。',
    'duplicate-entry':'设备目录包含重复文件名。',
    'file-too-large':'文件超过 256 MB，无法通过此读取器备份。',
    'too-many-entries':'设备目录条目过多。',
    'too-many-sidecars':'采样关联文件过多。',
    'directory-changed':'备份期间设备目录发生变化。请停止编辑或录音后重试。',
    'invalid-wave':'采样 WAV 文件无效，已停止备份。',
    'invalid-read':'设备返回的文件类型或长度不符。',
    'disk-verification':'已保存文件的校验失败。请检查目标磁盘。'
  };
  const message=Object.hasOwn(messages,error?.code)?SXCI18n.msg(messages[error.code]):SXCI18n.raw(error?.message||String(error));
  const context=error?.backupManifest?.error,bank=context?.bank||error?.bank;
  const path=error?.output||(Number.isInteger(bank)?'Bank'+pad2(bank)+(context?.name?'/'+context.name:''):'');
  return path?SXCI18n.msg('{error} · {path}',{error:message,path}):message;
}
$('backupAll').onclick=async()=>{
  if(state.busy||backupPicking||state.mode!=='live')return;
  if(typeof window.showDirectoryPicker!=='function'){
    notice(SXCI18n.msg('此浏览器无法保存整个备份文件夹。请在 Chrome 或 Edge 中打开本页。'),true);return;
  }
  const midi=state.midi;let parent;
  backupPicking=true;syncBackupControls();
  try{parent=await window.showDirectoryPicker({mode:'readwrite',id:'sxc-all-bank-backup'})}
  catch(error){if(error.name!=='AbortError')notice(SXCI18n.msg('无法打开备份目标文件夹：{error}',{error:backupError(error)}),true);return}
  finally{backupPicking=false;syncBackupControls()}
  if(state.busy||state.mode!=='live'||state.midi!==midi){notice(SXCI18n.msg('连接已改变。请重新开始备份。'),true);return}
  const folderName='SXC-1_AllBanks_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,8);
  let result,failure;
  await run(SXCI18n.msg('正在检查全部 80 个 Bank…'),async()=>{
    stopAudio();
    try{result=await SXCBackup.backupAll(midi,parent,{folderName,checkpoint:checkAbort,progress:backupProgress})}
    catch(error){failure=error;throw error}
  });
  if(result?.empty)notice(SXCI18n.msg('已检查全部 80 个 Bank，没有非空采样。未创建备份文件夹。'));
  else if(result){
    notice(SXCI18n.msg('备份完成：{banks} 个 Bank，{samples} 个采样，{files} 个已核对文件。已跳过 {skipped} 个空 Bank。保存位置：{folder}',{
      banks:result.manifest.banks.length,samples:result.manifest.files.filter(file=>/\/(0[1-9]|1[0-6])\.wav$/i.test(file.output)).length,files:result.manifest.files.length,skipped:result.skippedBanks.length,folder:result.folderName
    }));
  }else if(failure){
    const folder=failure.backupResult?.folderName||failure.folderName;
    notice(folder?SXCI18n.msg('备份未完成：{error} 已保存的文件保留在 {folder}。请将此备份视为不完整。',{error:backupError(failure),folder}):SXCI18n.msg('备份未完成：{error} 未创建备份文件夹。',{error:backupError(failure)}),!state.aborted);
  }
  syncBackupControls();
};
SXCI18n.attr($('backupAll'),'title',SXCI18n.msg('将有音频的 Bank 保存到电脑上的新文件夹；跳过空 Pad。不包含 Pattern 或全局设置。'));
syncBackupControls();
