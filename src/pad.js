'use strict';
const SXCPad = ((S,U)=>{
  const keys=['OS','LP','NT','VL','GR','SS','DS','CL','BP','PA'];
  const editable=[0,1,2,3,4,7,8,9];
  const colors=[['荧光黄','#e8ff00'],['橙色','#ff8a00'],['红色','#ff5147'],['紫色','#ad74f6'],['蓝色','#5285f7'],['浅蓝','#55c7f5'],['绿色','#38cd70'],['浅绿','#a3e876']];
  const p2=n=>String(n).padStart(2,'0'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const fileList=files=>JSON.stringify(files.map(f=>[f.name,f.bytes]).sort());
  function target(bank,pad){if(!Number.isInteger(bank)||bank<1||bank>80||!Number.isInteger(pad)||pad<1||pad>16)throw Error('Pad 位置无效')}
  function validate(values){
    if(!Array.isArray(values)||values.length!==10)throw Error('Pad 设置不完整');
    for(let i=0;i<10;i++)if(i===5||i===6){if(!Number.isInteger(values[i])||values[i]<0||values[i]>0xffffffff)throw Error('起止点设置无效')}else if(!S.validPadValue(i,values[i]))throw Error('Pad 设置超出支持范围');
    return values;
  }
  function parseDb(raw){
    if(!(raw instanceof Uint8Array)||raw.length>65536)throw Error('Pad 设置文件无效');
    const map=new Map();for(const line of S.td.decode(raw).split(/\r?\n/)){
      const m=/^([A-Z][A-Z0-9_]*)\s+(-?\d+)\s*$/.exec(line);if(!m||!keys.includes(m[1]))continue;
      if(map.has(m[1]))throw Error('Pad 设置存在重复字段');map.set(m[1],Number(m[2]));
    }
    // Firmware 1.4.1 writes PA in signed -25..25; older DBs omit it (center).
    return validate(keys.map((k,i)=>i===9?(map.has(k)?map.get(k):0)+25:map.get(k)));
  }
  function patchValues(before,patch){
    validate(before);const after=before.slice();
    for(const [key,value] of Object.entries(patch)){
      const index=Number(key);if(String(index)!==key||!editable.includes(index)||!S.validPadValue(index,value))throw Error('参数值无效；BPM 只能为 0 或 50–200');after[index]=value;
    }
    return validate(after);
  }
  function related(entries,pad){return entries.filter(e=>e.name.toLowerCase().startsWith(p2(pad)+'.'))}
  async function binding(midi,bank,slot){const b=await midi.bankState();if(b.bank!==bank||b.active!==slot||b.mapping[slot]!==bank-1)throw Error('机器的 Bank 已改变，请重新打开此 Pad');return b}
  async function readValues(midi,slot,pad){
    target(1,pad);if(!Number.isInteger(slot)||slot<0||slot>3)throw Error('Bank 槽位无效');
    return validate(await midi.readConfigs(0x04000000+(slot*16+pad-1)*65536,10));
  }
  async function waitDb(midi,bank,pad,expected,checkpoint=()=>{}){
    for(let attempt=0;attempt<8;attempt++){
      checkpoint();const entries=await midi.directory(bank),db=entries.find(e=>e.name.toLowerCase()===p2(pad)+'.wav.db');
      if(!db)throw Error('找不到配套 Pad 设置，不能完整复制或编辑');if(db.bytes>65536)throw Error('Pad 设置文件过大');
      const raw=await midi.read('/bank'+p2(bank-1)+'/'+db.name,db.bytes);
      if(same(parseDb(raw),expected))return {entries,db,raw};await pause(250);
    }
    throw Error('机器尚未保存一致的 Pad 设置，请稍后重新读取');
  }
  async function snapshot(midi,{bank,pad,audio=false,checkpoint=()=>{},progress=()=>{}}){
    target(bank,pad);checkpoint();const b=await midi.selectBank(bank),slot=b.active;
    const values=await readValues(midi,slot,pad),saved=await waitDb(midi,bank,pad,values,checkpoint),entries=related(saved.entries,pad);
    const wav=entries.find(e=>e.name.toLowerCase()===p2(pad)+'.wav');if(!wav)throw Error('这个 Pad 没有采样');
    const files=[];
    if(audio){
      if(entries.reduce((n,e)=>n+e.bytes,0)>128*1024*1024)throw Error('Pad 文件总大小超过 128 MB');
      for(const e of entries){
        checkpoint();if(e.bytes>64*1024*1024)throw Error('复制单个文件最大 64 MB');
        if(!/^\d{2}\.[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(e.name)||e.name.includes('..'))throw Error('该 Pad 的附属文件名暂不支持复制');
        const raw=e.name===saved.db.name?saved.raw:await midi.read('/bank'+p2(bank-1)+'/'+e.name,e.bytes,(n,total)=>{checkpoint();progress('复制到剪贴板 · '+e.name,n/total*100)});
        files.push({suffix:e.name.slice(2),raw:raw.slice(),sha256:await S.sha256(raw)});
      }
    }
    await binding(midi,bank,slot);if(!same(await readValues(midi,slot,pad),values))throw Error('读取期间 Pad 设置改变，请重试');
    const now=await midi.directory(bank);if(fileList(related(now,pad))!==fileList(entries))throw Error('读取期间 Pad 文件改变，请重试');
    return {bank,pad,slot,values,entries,allEntries:saved.entries,wav,dbName:saved.db.name,dbRaw:saved.raw,files,created_at:new Date().toISOString()};
  }
  async function paste(midi,clip,{bank,pad,...options}){
    target(bank,pad);if(!clip?.files?.length)throw Error('请先复制一个 Pad');
    const files=clip.files.map(f=>({name:p2(pad)+f.suffix,raw:f.raw}));
    const result=await U.transferPad(midi,{...options,bank,pad,files,action:'copy',source:{bank:clip.bank,pad:clip.pad,created_at:clip.created_at},sourceName:`Bank ${p2(clip.bank)} / Pad ${p2(clip.pad)}`});
    // Byte-for-byte transfer verification is performed by transferPad. Also verify loading of settings.
    try{result.state='verifying';options.journal?.(result);const b=await midi.selectBank(bank);if(!same(await readValues(midi,b.active,pad),clip.values))throw Error('复制文件已核对，但机器加载的设置不一致，请重新连接检查')}
    catch(e){result.state='needs_verification';result.error=e.message;options.journal?.(result);e.uploadReport=result;throw e}
    result.state='complete';options.journal?.(result);return result;
  }
  async function save(midi,original,patch,{checkpoint=()=>{},progress=()=>{},journal=()=>{}}={}){
    const {bank,pad}=original;target(bank,pad);const desired=patchValues(original.values,patch),changed=editable.filter(i=>desired[i]!==original.values[i]);
    const report={format:'sxc-pad-edit-v1',created_at:new Date().toISOString(),bank,pad,state:'checking',before:original.values.slice(),after:desired,db_before:S.td.decode(original.dbRaw),applied:[],attempted:[]};
    const record=state=>{report.state=state;journal(JSON.parse(JSON.stringify(report)))};
    try{
      checkpoint();const current=await snapshot(midi,{bank,pad,checkpoint});
      if(!same(current.values,original.values)||await S.sha256(current.dbRaw)!==await S.sha256(original.dbRaw)||fileList(current.entries)!==fileList(original.entries))throw Error('Pad 已被其他操作修改，请重新打开编辑窗口');
      if(!changed.length){record('complete');return {report,snapshot:current}}
      checkpoint();record('writing');const expected=current.values.slice(),logical=current.slot*16+pad-1;
      for(const index of changed){
        await binding(midi,bank,current.slot);if(!same(await readValues(midi,current.slot,pad),expected))throw Error('机器参数发生变化，已停止后续修改');
        report.attempted.push(index);journal(JSON.parse(JSON.stringify(report)));
        await midi.setPadParam(logical,index,desired[index]);report.applied.push(index);expected[index]=desired[index];journal(JSON.parse(JSON.stringify(report)));
        progress('保存 Pad 设置…',report.applied.length/changed.length*75);
      }
      record('verifying');await binding(midi,bank,current.slot);
      if(!same(await readValues(midi,current.slot,pad),desired))throw Error('机器参数读回不一致');
      const saved=await waitDb(midi,bank,pad,desired);await binding(midi,bank,current.slot);
      if(!same(await readValues(midi,current.slot,pad),desired))throw Error('保存期间机器参数改变');
      report.db_after=S.td.decode(saved.raw);record('complete');progress('设置已保存并核对',100);
      return {report,snapshot:{...current,values:desired,dbRaw:saved.raw,dbName:saved.db.name,entries:related(saved.entries,pad),allEntries:saved.entries}};
    }catch(e){report.failed_at=report.state;report.error=e.message;record(report.attempted.length?'needs_verification':'incomplete');e.editReport=report;throw e}
  }
  return {keys,editable,colors,parseDb,validate,readValues,patchValues,snapshot,paste,save};
})(typeof module!=='undefined'?require('./core.js'):SXC,typeof module!=='undefined'?require('./upload.js'):SXCUpload);
if(typeof module!=='undefined')module.exports=SXCPad;
