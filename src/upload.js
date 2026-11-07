'use strict';
const SXCUpload = ((S) => {
  const MAX_SECONDS=60, MAX_INPUT=64*1024*1024;
  const pad=n=>String(n).padStart(2,'0');
  function inspect(raw){
    if(!(raw instanceof Uint8Array)||raw.length<44||raw.length>MAX_INPUT)throw Error('请选择 64 MB 以内的 WAV 文件。');
    const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),ascii=(p,n)=>String.fromCharCode(...raw.subarray(p,p+n));
    if(ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE'||v.getUint32(4,true)+8!==raw.length)throw Error('WAV 文件不完整，或不是标准 RIFF / WAVE 格式。');
    let fmt=null,data=null,p=12;
    for(;p+8<=raw.length;){const id=ascii(p,4),n=v.getUint32(p+4,true),end=p+8+n;if(end>raw.length)throw Error('WAV 数据被截断。');
      if(id==='fmt '){if(fmt||n<16)throw Error('WAV 格式信息无效。');fmt={format:v.getUint16(p+8,true),channels:v.getUint16(p+10,true),rate:v.getUint32(p+12,true),byteRate:v.getUint32(p+16,true),align:v.getUint16(p+20,true),bits:v.getUint16(p+22,true)}}
      if(id==='data'){if(data)throw Error('暂不支持多个音频数据段。');data={start:p+8,length:n}}
      p=end+(n&1);
    }
    if(p!==raw.length||!fmt||!data)throw Error('WAV 文件结构无效。');
    if(![1,2].includes(fmt.channels))throw Error('目前支持单声道或双声道 WAV。');
    if(!((fmt.format===1&&[8,16,24,32].includes(fmt.bits))||(fmt.format===3&&fmt.bits===32)))throw Error('请选择 PCM 8/16/24/32-bit 或 Float 32-bit WAV；暂不支持压缩 WAV 和扩展格式。');
    if(fmt.rate<8000||fmt.rate>192000||fmt.align!==fmt.channels*fmt.bits/8||fmt.byteRate!==fmt.rate*fmt.align||data.length%fmt.align||!data.length)throw Error('WAV 采样率、声道或数据长度无效。');
    const frames=data.length/fmt.align,duration=frames/fmt.rate;
    if(duration>MAX_SECONDS)throw Error('首版上传限每个采样 60 秒，请先在电脑上裁剪。');
    return {...fmt,...data,frames,duration};
  }
  function decodePCM(raw,info=inspect(raw)){
    const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),channels=Array.from({length:2},()=>new Float32Array(info.frames));
    for(let f=0;f<info.frames;f++)for(let c=0;c<info.channels;c++){
      const p=info.start+f*info.align+c*info.bits/8;let x;
      if(info.format===3)x=v.getFloat32(p,true);
      else if(info.bits===8)x=(v.getUint8(p)-128)/128;
      else if(info.bits===16)x=v.getInt16(p,true)/32768;
      else if(info.bits===24){let n=v.getUint8(p)|(v.getUint8(p+1)<<8)|(v.getUint8(p+2)<<16);if(n&0x800000)n-=0x1000000;x=n/8388608}
      else x=v.getInt32(p,true)/2147483648;
      if(!Number.isFinite(x)||x < -1||x > 1)throw Error('音频中有无效或超出满幅的数值，请先调整电平并重新导出。');
      channels[c][f]=x;if(info.channels===1)channels[1][f]=x;
    }
    return channels;
  }
  function encodePCM(channels){
    if(channels.length!==2||!channels[0].length||channels[0].length!==channels[1].length||channels[0].length>MAX_SECONDS*48000)throw Error('转换后的音频长度无效');
    const n=channels[0].length,raw=new Uint8Array(44+n*4),v=new DataView(raw.buffer);raw.set(S.te.encode('RIFF'),0);v.setUint32(4,raw.length-8,true);raw.set(S.te.encode('WAVEfmt '),8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,192000,true);v.setUint16(32,4,true);v.setUint16(34,16,true);raw.set(S.te.encode('data'),36);v.setUint32(40,n*4,true);
    let clipped=0;
    for(let f=0;f<n;f++)for(let c=0;c<2;c++){const x=channels[c][f];if(!Number.isFinite(x))throw Error('音频转换失败');if(x < -1||x > 1)clipped++;v.setInt16(44+f*4+c*2,Math.max(-32768,Math.min(32767,Math.round(x*32768))),true)}
    return {raw,clipped};
  }
  async function prepare(raw){
    const source=inspect(raw);let channels=decodePCM(raw,source);
    if(source.rate!==48000){
      if(!globalThis.OfflineAudioContext)throw Error('此浏览器不能转换采样率，请先导出 48 kHz WAV。');
      const ctx=new OfflineAudioContext(2,Math.max(1,Math.round(source.duration*48000)),48000),buffer=ctx.createBuffer(2,source.frames,source.rate);
      channels.forEach((a,c)=>buffer.copyToChannel(a,c));const node=ctx.createBufferSource();node.buffer=buffer;node.connect(ctx.destination);node.start();const rendered=await ctx.startRendering();channels=[rendered.getChannelData(0),rendered.getChannelData(1)];
    }
    const encoded=encodePCM(channels);
    return {...encoded,raw:deviceWaveforms(encoded.raw),source};
  }
  function deviceWaveforms(raw){
    const info=inspect(raw);
    if(info.format!==1||info.bits!==16||info.channels!==2||info.rate!==48000)throw Error('生成机器波形需要 48 kHz / 16-bit 双声道音频');
    const pcm=raw.subarray(info.start,info.start+info.length),v=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength);
    const outline=count=>{
      const out=new Uint8Array(count*2);
      for(let x=0;x<count;x++){
        const first=Math.floor(x*info.frames/count),last=Math.min(info.frames,Math.max(first+1,Math.floor((x+1)*info.frames/count)));let hi=0,lo=0;
        for(let f=first;f<last;f++)for(let c=0;c<2;c++){const n=v.getInt16(f*4+c*2,true);hi=Math.max(hi,n);lo=Math.min(lo,n)}
        out[x*2]=Math.floor(hi/256)&255;out[x*2+1]=Math.floor(lo/256)&255;
      }
      return out;
    };
    const chunk=(id,data)=>{const header=new Uint8Array(8);header.set(S.te.encode(id));new DataView(header.buffer).setUint32(4,data.length,true);return S.concat(header,data)};
    // Firmware stops scanning after fmt + data. Both CSwf chunks must precede data.
    const fmt=new Uint8Array(16),f=new DataView(fmt.buffer);f.setUint16(0,1,true);f.setUint16(2,2,true);f.setUint32(4,48000,true);f.setUint32(8,192000,true);f.setUint16(12,4,true);f.setUint16(14,16,true);
    const body=S.concat(S.te.encode('WAVE'),chunk('fmt ',fmt),chunk('CSwf',outline(124)),chunk('CSwf',outline(4096)),chunk('data',pcm));
    const head=new Uint8Array(8);head.set(S.te.encode('RIFF'));new DataView(head.buffer).setUint32(4,body.length,true);return S.concat(head,body);
  }
  const occupied=(entries,p)=>entries.some(e=>e.name.toLowerCase().startsWith(pad(p)+'.'));
  const inventory=entries=>JSON.stringify(entries.map(e=>[e.name,e.bytes]).sort((a,b)=>a[0].localeCompare(b[0])));
  const defaults=()=>S.te.encode('OS 1\nLP 0\nNT 39\nVL 100\nGR 0\nSS 0\nDS 0\nCL 0\nBP 0\n');
  async function upload(midi,options){
    const {raw,pad:target}=options,info=inspect(raw);
    if(info.format!==1||info.bits!==16||info.channels!==2||info.rate!==48000)throw Error('上传音频格式无效');
    return transferPad(midi,{...options,files:[{name:pad(target)+'.wav',raw},{name:pad(target)+'.wav.db',raw:defaults()}]});
  }
  async function transferPad(midi,{bank,pad:target,files,sourceName='',action='upload',source=null,checkpoint=()=>{},progress=()=>{},journal=()=>{}}){
    if(!Number.isInteger(bank)||bank<1||bank>80||!Number.isInteger(target)||target<1||target>16)throw Error('上传目标无效');
    if(!Array.isArray(files)||!files.length||files.length>32||new Set(files.map(f=>f.name.toLowerCase())).size!==files.length)throw Error('Pad 文件列表无效');
    for(const f of files)if(!f.name.startsWith(pad(target)+'.')||!/^\d{2}\.[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(f.name)||f.name.includes('..')||!(f.raw instanceof Uint8Array)||!f.raw.length||f.raw.length>64*1024*1024)throw Error('Pad 文件无效或超过 64 MB');
    if(!files.some(f=>f.name.toLowerCase()===pad(target)+'.wav')||!files.some(f=>f.name.toLowerCase()===pad(target)+'.wav.db'))throw Error('复制需要同时保留音频和 Pad 设置');
    if(files.reduce((n,f)=>n+f.raw.length,0)>128*1024*1024)throw Error('Pad 文件总大小超过 128 MB');
    const stage='/app/sxcup-'+[...crypto.getRandomValues(new Uint8Array(12))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const report={format:'sxc-upload-v1',created_at:new Date().toISOString(),bank,pad:target,action,source,source_name:sourceName,stage,state:'checking',files:[]};
    const record=phase=>{report.state=phase;journal(JSON.parse(JSON.stringify(report)))};
    try{
      checkpoint();report.before=await midi.directory(bank);
      if(occupied(report.before,target))throw Error('目标 Pad 已有文件，请选择空 Pad。');
      for(const f of files)report.files.push({name:f.name,bytes:f.raw.length,sha256:await S.sha256(f.raw)});
      checkpoint();record('staging');await midi.createStage(stage);
      for(let i=0;i<files.length;i++){
        const f=files[i];checkpoint();progress('传送 '+f.name,5+i*60/files.length);
        await midi.write(stage+'/'+f.name,f.raw,(n,total)=>{checkpoint();progress('传送 '+f.name,5+(i+n/total*.5)*60/files.length)});
        checkpoint();const back=await midi.read(stage+'/'+f.name,f.raw.length,(n,total)=>{checkpoint();progress('核对 '+f.name,5+(i+.5+n/total*.5)*60/files.length)});
        if(await S.sha256(back)!==report.files[i].sha256)throw Error('临时文件校验失败，尚未放入 Pad。');
      }
      checkpoint();if(inventory(await midi.list(stage))!==inventory(report.files))throw Error('临时文件列表不一致，尚未放入 Pad。');
      const beforeCommit=await midi.directory(bank);checkpoint();
      if(occupied(beforeCommit,target)||inventory(beforeCommit)!==inventory(report.before))throw Error('机器上的采样列表发生了变化，已停止上传，请刷新后重试。');
      // Registration moves files. Once sent, cancellation cannot promise rollback.
      record('registering');progress('正在加载到 Pad，请保持连接…',70);await midi.register(stage,bank);
      record('verifying');report.after=await midi.directory(bank);
      if(inventory(report.after)!==inventory([...report.before,...report.files]))throw Error('加载后的文件列表不符，需要重新连接核对。');
      for(let i=0;i<files.length;i++){
        const f=files[i],back=await midi.read('/bank'+pad(bank-1)+'/'+f.name,f.raw.length,(n,total)=>progress('核对 Pad 上的 '+f.name,75+(i+n/total)*24/files.length));
        if(await S.sha256(back)!==report.files[i].sha256)throw Error('Pad 上的文件校验不符，需要重新连接核对。');
      }
      record('complete');progress('上传完成，音频与设置均已核对',100);return report;
    }catch(e){report.failed_at=report.state;report.error=e.message;report.state=['registering','verifying'].includes(report.state)?'needs_verification':'incomplete';journal(report);e.uploadReport=report;throw e}
  }
  return {MAX_SECONDS,MAX_INPUT,inspect,decodePCM,encodePCM,prepare,deviceWaveforms,occupied,upload,transferPad,defaults};
})(typeof module!=='undefined'?require('./core.js'):SXC);
if(typeof module!=='undefined')module.exports=SXCUpload;
