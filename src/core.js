'use strict';
const SXC = (() => {
  const te=new TextEncoder(), td=new TextDecoder('utf-8',{fatal:true});
  const concat=(...a)=>{let r=new Uint8Array(a.reduce((n,b)=>n+b.length,0)),p=0; for(const b of a){r.set(b,p);p+=b.length} return r};
  function crc16(a,init=0){let c=init;for(const b of a){c^=b<<8;for(let i=0;i<8;i++)c=((c<<1)^((c&32768)?0x1021:0))&65535}return c}
  const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
  function crc32(a){let c=0xffffffff;for(const b of a)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
  function pack(a){const p=(7-a.length%7)%7,r=new Uint8Array((a.length+p)/7*8+3);for(let i=0,j=0;i<a.length;i+=7,j+=8){for(let k=0;k<7;k++){let b=a[i+k]||0;r[j+k]=b&127;r[j+7]|=(b>>>7)<<(6-k)}}let c=crc16(a);r.set([p|((c>>>14)<<5),(c>>>7)&127,c&127],r.length-3);return r}
  function unpack(a){if(a.length<3||(a.length-3)%8||a.some(b=>b>127))throw Error('通信数据长度错误');const tag=a[a.length-3],pad=tag&7,n=(a.length-3)/8*7-pad;if(pad===7||n<0)throw Error('通信填充错误');const r=new Uint8Array(n);for(let i=0,j=0;i<a.length-3;i+=8,j+=7)for(let k=0;k<7&&j+k<n;k++)r[j+k]=a[i+k]|(((a[i+7]>>>(6-k))&1)<<7);if(crc16(r,tag&8?65535:0)!==(((tag>>>5)&3)<<14|a[a.length-2]<<7|a[a.length-1]))throw Error('分片校验失败，请重新读取');return r}
  function str(s){if(s.includes('\0'))throw Error('文件名无效');return concat(Uint8Array.of(2),te.encode(s),Uint8Array.of(0))}
  function uint(n){const b=new Uint8Array(5);b[0]=1;new DataView(b.buffer).setUint32(1,n,true);return b}
  function fields(a){let p=0,r=[];while(p<a.length){let t=a[p++];if(t===1){if(p+4>a.length)throw Error('整数不完整');r.push(new DataView(a.buffer,a.byteOffset+p,4).getUint32(0,true));p+=4}else if(t===2){let q=a.indexOf(0,p);if(q<0)throw Error('字符串不完整');r.push(td.decode(a.subarray(p,q)));p=q+1}else if(t===3){if(p+3>a.length)throw Error('字段不完整');let n=a[p]|a[p+1]<<8|a[p+2]<<16;p+=3;if(p+n>a.length)throw Error('字段长度不符');r.push(a.slice(p,p+n));p+=n}else throw Error('未知字段类型')}return r}
  const PAD_RANGES={0:[0,1],1:[0,1],2:[15,63],3:[0,100],4:[0,16],7:[0,7],8:[0,200],9:[0,50]};
  function validPadValue(index,value){const range=PAD_RANGES[index];return Number.isInteger(value)&&!!range&&value>=range[0]&&value<=range[1]&&(index!==8||value===0||value>=50)}
  function request(cmd,data=new Uint8Array()){
    if(![0,7,8,9,10,11,15,27,28,31].includes(cmd))throw Error('命令未开放');
    if(cmd===28){
      if(data.length!==12||data[0]!==3||data[1]!==8||data[2]||data[3])throw Error('参数控制数据无效');
      const v=new DataView(data.buffer,data.byteOffset+4,8),id=v.getUint32(0,true),value=v.getUint32(4,true);
      const bank=(id>=0x03000000&&id<=0x03000003&&value<80)||(id===0x03000013&&value<4);
      const sound=(id&0xff00ff00)===0x04000000&&((id>>>16)&255)<64&&validPadValue(id&255,value);
      if(!bank&&!sound)throw Error('仅开放 Bank 选择和已验证的 Pad 参数');
    }
    return concat(Uint8Array.of(240,68,48,1,1,cmd),data.length?pack(data):data,Uint8Array.of(247));
  }
  function decode(a){if(a.length<6||a[0]!==240||a[1]!==68||a[2]!==48||a[3]!==2||a.at(-1)!==247||a.subarray(1,-1).some(x=>x>127))throw Error('设备响应无效');let k=a[4];if(k===0||k===5){if(a.length!==6)throw Error('控制帧无效');return {kind:k,code:null,data:new Uint8Array()}}if(a.length<7)throw Error('设备响应不完整');return {kind:k,code:a[5],data:a.length>7?unpack(a.subarray(6,-1)):new Uint8Array()}}
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const stageDir=p=>/^\/app\/sxcup-[0-9a-f]{24}$/.test(p);
  const stageFile=p=>/^\/app\/sxcup-[0-9a-f]{24}\/(0[1-9]|1[0-6])\.[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(p)&&!p.includes('..');
  const safePath=p=>{if((!/^\/(bank\d{2}\/[^/\\\0]+|app\/SoundBankName\.txt|sampler\.db)$/.test(p)&&!stageFile(p))||p.includes('..'))throw Error('读取路径无效');return p};
  class Midi {
    constructor(){this.q=[];this.pending=null;this.dead=false;this.lastRead=0}
    async connect(){
      if(!navigator.requestMIDIAccess)throw Error('此浏览器不能连接 MIDI。请使用 Chrome 或 Edge 打开本页；也可以查看本地备份。');
      if(!globalThis.isSecureContext)throw Error('连接设备需要 HTTPS 网页或 localhost 本地服务，请使用在线版的 HTTPS 地址，或通过本地启动器打开。');
      this.access=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.permissionReject=null;reject(Error('等待 MIDI 权限超时。请用 Chrome 或 Edge 重试，并允许设备访问。'))},45000);this.permissionReject=e=>{clearTimeout(timer);this.permissionReject=null;reject(e)};navigator.requestMIDIAccess({sysex:true}).then(a=>{clearTimeout(timer);this.permissionReject=null;if(this.dead){reject(Error('读取已取消'));return}resolve(a)},e=>{clearTimeout(timer);this.permissionReject=null;reject(Error('未获得 MIDI 访问权限。请在浏览器中允许本页访问设备后重试。'))})});
      if(!this.access.sysexEnabled)throw Error('需要允许 MIDI / SysEx 访问才能读取采样。');
      let ins=[...this.access.inputs.values()].filter(p=>p.state==='connected'&&p.name==='SXC-1'),outs=[...this.access.outputs.values()].filter(p=>p.state==='connected'&&p.name==='SXC-1');
      if(ins.length!==1||outs.length!==1)throw Error(ins.length>1||outs.length>1?'检测到多台 SXC-1，请只连接一台。':'没有找到 SXC-1。请正常开机，并将 DATA 接口连接到电脑。');
      this.input=ins[0];this.output=outs[0];
      await this.input.open();await this.output.open();
      this.input.onmidimessage=e=>{const a=new Uint8Array(e.data);if(a[0]!==240||a[1]!==68||a[2]!==48||a[3]!==2)return;try{const m=decode(a);if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(m)}else{if(this.q.length>64)throw Error('设备响应积压');this.q.push(m)}}catch(e){this.fail(e)}};
      this.access.onstatechange=()=>{if(this.input.state!=='connected'||this.output.state!=='connected'){this.fail(Error('设备连接已断开，请重新连接。'));if(this.onDisconnect)this.onDisconnect()}};
      const m=await this.command(0);return JSON.parse(fields(m)[0]);
    }
    fail(e){this.dead=true;this.error=e;if(this.permissionReject)this.permissionReject(e);if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(e);this.pending=null}}
    send(a){if(this.dead)throw this.error||Error('连接已关闭');this.output.send(a)}
    receive(){if(this.dead)return Promise.reject(this.error||Error('连接已关闭'));if(this.q.length)return Promise.resolve(this.q.shift());if(this.pending)return Promise.reject(Error('请等待当前读取结束'));return new Promise((resolve,reject)=>{this.pending={resolve,reject,timer:setTimeout(()=>{this.pending=null;reject(Error('设备响应超时，请重新连接后重试。'))},8000)}})}
    async command(c,p){await sleep(Math.max(0,150-(Date.now()-this.lastRead)));this.send(request(c,p));const m=await this.receive();if(m.kind!==2)throw Error('设备响应顺序错误');if(m.code)throw Object.assign(Error(`设备操作失败（${m.code}）`),{status:m.code});return m.data}
    async readConfigs(id,count){
      if(!Number.isInteger(id)||!Number.isInteger(count)||count<1||count>64)throw Error('参数读取范围无效');
      const f=fields(await this.command(27,concat(uint(id),uint(count))));
      if(f.length!==1||!(f[0] instanceof Uint8Array)||f[0].length!==count*4)throw Error('机器参数不完整');
      const v=new DataView(f[0].buffer,f[0].byteOffset,f[0].byteLength);return Array.from({length:count},(_,i)=>v.getUint32(i*4,true));
    }
    async bankState(){
      const active=(await this.readConfigs(0x03000013,1))[0],mapping=await this.readConfigs(0x03000000,4);
      if(active>3||mapping.some(n=>n>79&&n!==0xffffffff))throw Error('机器 Bank 状态无效');
      return {active,mapping,bank:mapping[active]===0xffffffff?null:mapping[active]+1};
    }
    async setConfig(id,value){
      if(!Number.isInteger(id)||!Number.isInteger(value)||value<0||value>0xffffffff)throw Error('参数值无效');
      const b=new Uint8Array(12);b.set([3,8,0,0]);const v=new DataView(b.buffer);v.setUint32(4,id,true);v.setUint32(8,value,true);await this.command(28,b);this.lastRead=Date.now();
    }
    async setBankParam(id,value){if(!((id>=0x03000000&&id<=0x03000003)||id===0x03000013))throw Error('仅开放 Bank 选择参数');await this.setConfig(id,value)}
    async setPadParam(logical,index,value){
      if(!Number.isInteger(logical)||logical<0||logical>=64||!Number.isInteger(index)||!validPadValue(index,value))throw Error('Pad 参数值无效');
      await this.setConfig(0x04000000+logical*65536+index,value);
    }
    async selectBank(bank){
      if(!Number.isInteger(bank)||bank<1||bank>80)throw Error('Bank 编号无效');const before=await this.bankState();
      if(before.bank===bank)return before;
      // Reuse an already loaded A/B/C/D slot; otherwise remap only the active slot.
      const loaded=before.mapping.indexOf(bank-1);
      if(loaded>=0)await this.setBankParam(0x03000013,loaded);
      else await this.setBankParam(0x03000000+before.active,bank-1);
      const after=await this.bankState();if(after.bank!==bank)throw Error('机器未切换到目标 Bank，请重新连接核对');return after;
    }
    async directory(bank){if(!Number.isInteger(bank)||bank<1||bank>80)throw Error('Bank 编号无效');return this.list('/bank'+String(bank-1).padStart(2,'0'))}
    async list(path){if(!/^\/bank[0-7]\d$/.test(path)&&!stageDir(path))throw Error('目录路径无效');let r=[];for(let i=0;i<512;i++){try{const a=fields(await this.command(i?11:10,i?undefined:str(path)));if(a.length!==3||!Number.isInteger(a[0])||!Number.isInteger(a[1])||typeof a[2]!=='string')throw Error('目录数据不完整');if(a[0]&32){safePath('/bank00/'+a[2]);r.push({name:a[2],bytes:a[1]})}}catch(e){if(e.status===15)return r;throw e}}throw Error('目录条目过多，读取未完成')}
    async createStage(path){if(!stageDir(path))throw Error('临时目录无效');await this.command(9,str(path));this.lastRead=Date.now()}
    async write(path,raw,onProgress=()=>{}){
      if(!stageFile(path)||!(raw instanceof Uint8Array)||!raw.length||raw.length>64*1024*1024)throw Error('上传文件无效');
      await this.command(15,str(path));this.lastRead=Date.now();await this.command(8,concat(str(path),uint(0)));let seq=0;
      for(let p=0;p<raw.length;p+=1024){this.send(concat(Uint8Array.of(240,68,48,1,3,seq%16),pack(raw.subarray(p,p+1024)),Uint8Array.of(247)));const ack=await this.receive();if(ack.kind!==5)throw Error('上传分片未被确认，已停止');seq++;onProgress(Math.min(raw.length,p+1024),raw.length)}
      this.send(concat(Uint8Array.of(240,68,48,1,7,seq%16),pack(uint(crc32(raw))),Uint8Array.of(247)));
      const ack=await this.receive();if(ack.kind!==5)throw Error('上传结束未被确认');const end=await this.receive();if(end.kind!==2||end.code!==0)throw Error('机器未通过上传文件校验');this.lastRead=Date.now();
    }
    async register(path,bank){if(!stageDir(path)||!Number.isInteger(bank)||bank<1||bank>80)throw Error('上传目标无效');await this.command(31,concat(str(path),uint(bank-1)));this.lastRead=Date.now()}
    async read(path,expected,onProgress=()=>{}){
      safePath(path);if(!Number.isSafeInteger(expected)||expected<0||expected>256*1024*1024)throw Error('单个文件超过 256 MB，请使用原生备份工具。');
      await sleep(Math.max(0,120-(Date.now()-this.lastRead)));
      await this.command(7,concat(str(path),uint(0),uint(0)));
      const result=new Uint8Array(expected);let n=0,seq=0;
      for(;;){let m=await this.receive();if(m.kind===3){if(m.code!==seq%16||n+m.data.length>expected)throw Error('文件片段顺序或长度不符，请刷新后重试');result.set(m.data,n);n+=m.data.length;seq++;this.send(Uint8Array.of(240,68,48,1,5,247));onProgress(n,expected)}else if(m.kind===7){let f=fields(m.data),final=await this.receive();if(final.kind!==2||final.code!==0||n!==expected||f.length!==1||f[0]!==crc32(result))throw Error('整文件校验失败，未提供下载');this.lastRead=Date.now();return result}else throw Error('文件传输中断')}
    }
    async close(reset=false){if(reset&&this.output?.state==='connected'){try{this.output.send(Uint8Array.of(240,68,48,1,0,247))}catch{}}this.fail(Error('读取已取消'));if(this.access)this.access.onstatechange=null;if(this.input)this.input.onmidimessage=null;await Promise.allSettled([this.input?.close(),this.output?.close()]);this.q=[]}
  }
  function zip(entries){
    let offset=0,centralSize=0,parts=[],central=[];const seen=new Set();
    for(const {name,data} of entries){if(seen.has(name)||name.startsWith('/')||name.split('/').includes('..'))throw Error('压缩包文件名无效');seen.add(name);const n=te.encode(name);if(n.length>65535||data.length>0xffffffff)throw Error('压缩包过大');const c=crc32(data),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,c,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);h.set(n,30);
      const ch=new Uint8Array(46+n.length),cv=new DataView(ch.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,c,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);ch.set(n,46);central.push(ch);centralSize+=ch.length;parts.push(h,data);offset+=h.length+data.length;
    }
    if(offset+centralSize>0xffffffff||entries.length>65535)throw Error('压缩包过大');let end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
  }
  async function sha256(a){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',a))].map(x=>x.toString(16).padStart(2,'0')).join('')}
  function waveInfo(a){try{let d=new DataView(a.buffer,a.byteOffset,a.byteLength);if(td.decode(a.subarray(0,4))!=='RIFF'||td.decode(a.subarray(8,12))!=='WAVE')return null;let fmt=null,data=null;for(let p=12;p+8<=a.length;){const id=td.decode(a.subarray(p,p+4)),n=d.getUint32(p+4,true);if(p+8+n>a.length)return null;if(id==='fmt '&&n>=16)fmt={format:d.getUint16(p+8,true),channels:d.getUint16(p+10,true),rate:d.getUint32(p+12,true),align:d.getUint16(p+20,true),bits:d.getUint16(p+22,true)};if(id==='data')data={start:p+8,length:n};p+=8+n+(n&1)}if(!fmt||!data||!fmt.align||!fmt.rate)return null;return {...fmt,...data,duration:data.length/fmt.align/fmt.rate}}catch{return null}}
  return {validPadValue,PAD_RANGES,concat,crc16,crc32,pack,unpack,str,uint,fields,request,decode,Midi,zip,sha256,waveInfo,te,td};
})();
if(typeof module!=='undefined')module.exports=SXC;
