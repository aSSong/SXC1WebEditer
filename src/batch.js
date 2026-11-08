'use strict';
const SXCBatch = ((S,U) => {
  const MAX_FILES=80*16, AUDIO=/\.(wav|wave|mp3|m4a|aac|flac|ogg|oga|opus|aif|aiff|webm)$/i;
  const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  const label=t=>`Bank ${String(t.bank).padStart(2,'0')} / Pad ${String(t.pad).padStart(2,'0')}`;
  class BatchError extends Error {constructor(code,message,details={}){super(message);this.code=code;Object.assign(this,details)}}
  function plan(count,bank,pad){
    if(!Number.isInteger(count)||count<1||count>MAX_FILES)throw new BatchError('range',`请选择 1–${MAX_FILES} 个音频文件。`);
    if(!Number.isInteger(bank)||bank<1||bank>80||!Number.isInteger(pad)||pad<1||pad>16)throw new BatchError('range','起始 Bank 为 1–80，Pad 为 1–16。');
    const start=(bank-1)*16+pad-1,available=MAX_FILES-start;
    if(count>available)throw new BatchError('range',`需要 ${count} 个连续 Pad，但从 ${label({bank,pad})} 到机器末尾只有 ${available} 个位置。未上传任何文件，请减少文件或调整起点。`,{available});
    return Array.from({length:count},(_,i)=>({bank:Math.floor((start+i)/16)+1,pad:(start+i)%16+1}));
  }
  function selection(items){
    let ignored=0;
    const jobs=items.filter(({file,path})=>{
      const accepted=!path.split('/').some(s=>s.startsWith('.'))&&(AUDIO.test(file.name)||file.type?.startsWith('audio/'));
      if(!accepted)ignored++;return accepted;
    }).map(({file,path})=>({file,path,status:'queued'}));
    jobs.sort((a,b)=>collator.compare(a.path,b.path)||(a.path<b.path?-1:a.path>b.path?1:0));
    if(!jobs.length)throw new BatchError('files','没有找到可导入的音频。请选择 WAV、MP3、FLAC、M4A 等音频文件。');
    if(jobs.length>MAX_FILES)throw new BatchError('files',`共找到 ${jobs.length} 个音频，单次最多 ${MAX_FILES} 个，请分批选择。`);
    return {jobs,ignored};
  }
  function fromFiles(files){return selection([...files].map(file=>({file,path:file.webkitRelativePath||file.name})))}
  // Capture entry handles synchronously in the drop event, before its data store closes.
  function captureDrop(transfer){
    return {items:[...(transfer.items||[])].filter(i=>i.kind==='file').map(i=>({entry:i.webkitGetAsEntry?.()||null,file:i.getAsFile?.()||null})),files:[...(transfer.files||[])]};
  }
  async function fromDrop(capture){
    const files=[];let visited=0;
    async function visit(entry,prefix='',depth=0){
      if(++visited>20000||depth>32)throw new BatchError('files','文件夹内容过多或层级太深，请选择更小的采样文件夹。');
      if(entry.name.startsWith('.'))return;
      const path=prefix+entry.name;
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));files.push({file,path})}
      else if(entry.isDirectory){
        const reader=entry.createReader();
        // Chromium returns directory entries in pages, often 100 at a time.
        for(;;){const entries=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!entries.length)break;for(const child of entries)await visit(child,path+'/',depth+1)}
      }
    }
    if(!capture.items.length)return fromFiles(capture.files);
    for(const {entry,file} of capture.items){if(entry)await visit(entry);else if(file)files.push({file,path:file.name});else throw new BatchError('files','浏览器无法读取拖入的文件夹，请使用“选择文件夹”。')}
    return selection(files);
  }
  async function prepareFile(file){
    if(!file.size||file.size>U.MAX_INPUT)throw Error('请选择非空且不超过 64 MB 的音频。');
    const buffer=await file.arrayBuffer(),raw=new Uint8Array(buffer);
    if(/\.(wav|wave)$/i.test(file.name)||(S.td.decode(raw.subarray(0,4))==='RIFF'&&S.td.decode(raw.subarray(8,12))==='WAVE'))return U.prepare(raw);
    if(!globalThis.OfflineAudioContext)throw Error('此浏览器不支持解码此格式，请转换为 WAV 后导入。');
    let decoded;
    try{decoded=await new OfflineAudioContext(2,1,48000).decodeAudioData(buffer)}catch{throw Error('浏览器无法解码此音频，请转换为 PCM WAV 后导入。')}
    if(!decoded.length||decoded.duration>U.MAX_SECONDS)throw Error('每个采样最长 60 秒，请先裁剪。');
    if(![1,2].includes(decoded.numberOfChannels))throw Error('只支持单声道或双声道音频。');
    const a=decoded.getChannelData(0),b=decoded.getChannelData(decoded.numberOfChannels===1?0:1),result=U.encodePCM([a,b]);
    return {...result,raw:U.deviceWaveforms(result.raw),source:{duration:decoded.duration,channels:decoded.numberOfChannels,rate:48000}};
  }
  async function preflight(midi,targets,{checkpoint=()=>{},progress=()=>{}}={}){
    const banks=[...new Set(targets.map(t=>t.bank))],directories=new Map();
    for(let i=0;i<banks.length;i++){checkpoint();progress(`检查 Bank ${String(banks[i]).padStart(2,'0')} 的空位…`,i/banks.length*100);directories.set(banks[i],await midi.directory(banks[i]));checkpoint()}
    const conflicts=targets.filter(t=>U.occupied(directories.get(t.bank),t.pad));
    if(conflicts.length){
      const first=conflicts[0],free=targets.findIndex(t=>t.bank===first.bank&&t.pad===first.pad);
      throw new BatchError('occupied',`还需 ${targets.length} 个连续空 Pad，起点后只有 ${free} 个连续空位；${label(first)} 已有采样或设置文件。尚未开始本轮上传。请处理占用位置或调整起点，再点击“重试上传”；已选文件会保留。`,{conflicts,consecutive:free});
    }
    return directories;
  }
  async function recover(midi,job,checkpoint){
    const entries=await midi.directory(job.target.bank);checkpoint();
    if(!U.occupied(entries,job.target.pad)){job.status='queued';job.report=null;return}
    const expected=job.report?.files||[],prefix=String(job.target.pad).padStart(2,'0')+'.',actual=entries.filter(e=>e.name.toLowerCase().startsWith(prefix));
    let matches=expected.length>0&&actual.length===expected.length;
    for(const f of expected){
      checkpoint();if(!matches)break;
      const entry=actual.find(e=>e.name===f.name&&e.bytes===f.bytes);
      if(!entry){matches=false;break}
      const raw=await midi.read('/bank'+String(job.target.bank-1).padStart(2,'0')+'/'+f.name,f.bytes);
      matches=await S.sha256(raw)===f.sha256;
    }
    if(!matches)throw new BatchError('occupied',`${label(job.target)} 上次上传的结果尚未确认，现有内容与记录不一致。请先检查或清空这个 Pad，再重试。文件列表已保留。`,{conflicts:[job.target]});
    job.status='complete';job.report={...job.report,state:'complete',recovered:true,after:entries};
  }
  async function execute(midi,jobs,{bank,pad,checkpoint=()=>{},progress=()=>{},change=()=>{},journal=()=>{},completed=()=>{},prepare=prepareFile,upload=U.upload}={}){
    const targets=plan(jobs.length,bank,pad);
    jobs.forEach((job,i)=>{
      if(['complete','uncertain'].includes(job.status)&&job.target&&(job.target.bank!==targets[i].bank||job.target.pad!==targets[i].pad))throw new BatchError('range','本批次已开始写入，不能改变原有起点或文件顺序。');
      job.target=targets[i];job.error=null;
    });
    for(const job of jobs.filter(j=>j.status==='uncertain')){checkpoint();progress('核对上次中断的 '+label(job.target)+'…',null);await recover(midi,job,checkpoint);change(job);if(job.status==='complete')completed(job)}
    const pending=jobs.filter(j=>j.status!=='complete');
    if(!pending.length)return;
    await preflight(midi,pending.map(j=>j.target),{checkpoint,progress});
    // Decode every file before the first write. Keep File handles, not an entire
    // bank of decoded PCM in RAM. Re-prepare one file at a time while uploading.
    for(let i=0;i<pending.length;i++){
      checkpoint();const job=pending[i];job.status='checking';change(job);progress(`校验音频 ${i+1}/${pending.length} · ${job.path}`,i/pending.length*100);
      try{const result=await prepare(job.file);job.info={duration:result.source.duration,bytes:result.raw.length,clipped:result.clipped};job.status='ready';change(job)}
      catch(e){job.status='invalid';job.error=e.message;change(job);throw new BatchError('audio',`${job.path}：${e.message} 尚未开始本轮上传；可移除此文件后重试。`)}
      checkpoint();
    }
    // Audio preparation can take time. Re-read the entire span before any Bank
    // switch, temporary write, or registration. Each single upload checks again.
    await preflight(midi,pending.map(j=>j.target),{checkpoint,progress});
    for(const job of pending){
      checkpoint();job.status='uploading';change(job);
      try{
        const prepared=await prepare(job.file);checkpoint();
        await midi.selectBank(job.target.bank);checkpoint();
        job.report=await upload(midi,{...job.target,raw:prepared.raw,sourceName:job.path,
          progress:(text,pct)=>progress(`${jobs.filter(j=>j.status==='complete').length+1}/${jobs.length} · ${label(job.target)} · ${text}`,pct),
          journal:report=>{job.report=report;journal(report)}});
        job.status='complete';change(job);completed(job);
      }catch(e){job.report=e.uploadReport||job.report;job.status=job.report?.state==='needs_verification'?'uncertain':'failed';job.error=e.message;change(job);throw e}
      // Cancellation waits for the current Pad to finish registration + readback.
      checkpoint();
    }
  }
  return {MAX_FILES,AUDIO,BatchError,label,plan,fromFiles,captureDrop,fromDrop,prepareFile,preflight,execute};
})(typeof module!=='undefined'?require('./core.js'):SXC,typeof module!=='undefined'?require('./upload.js'):SXCUpload);
if(typeof module!=='undefined')module.exports=SXCBatch;
