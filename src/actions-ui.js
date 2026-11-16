'use strict';
const libraryActionMenus=[...document.querySelectorAll('.action-menu')];
function syncLibraryActions(){
  for(const menu of libraryActionMenus){
    const summary=menu.querySelector('summary');
    const disabled=state.busy;
    summary.setAttribute('aria-disabled',String(disabled));
    if(disabled)menu.open=false;
  }
  const hint=$('backupConnectionHint');
  hint.hidden=state.mode==='live';
  SXCI18n.text(hint,state.mode==='archive'?SXCI18n.msg('当前正在浏览本地备份。可导出当前 Bank 的 ZIP；备份机器的全部 Bank 需要连接 SXC-1。'):SXCI18n.msg('连接 SXC-1 后即可备份机器上的采样。'));
}
for(const menu of libraryActionMenus){
  const summary=menu.querySelector('summary');
  summary.addEventListener('click',event=>{if(summary.getAttribute('aria-disabled')==='true')event.preventDefault()});
  menu.addEventListener('toggle',()=>{if(menu.open)for(const other of libraryActionMenus)if(other!==menu)other.open=false});
  menu.addEventListener('focusout',event=>{if(event.relatedTarget&&!menu.contains(event.relatedTarget))menu.open=false});
}
document.addEventListener('click',event=>{
  for(const menu of libraryActionMenus){
    const action=event.target.closest?.('.action-options button');
    if(!menu.contains(event.target)||action&&!action.disabled)menu.open=false;
  }
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const menu=libraryActionMenus.find(menu=>menu.open);
  if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus()}
});
syncLibraryActions();
