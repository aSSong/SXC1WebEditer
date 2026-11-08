const assert=require('node:assert/strict'),B=require('./batch.js'),U=require('./upload.js');
if(!globalThis.crypto)globalThis.crypto=require('node:crypto').webcrypto;
const raw=U.encodePCM([new Float32Array(480).fill(.25),new Float32Array(480).fill(-.25)]).raw;
const file=(name,bytes=raw)=>({name,size:bytes.length,type:'audio/wav',arrayBuffer:async()=>bytes.slice().buffer});
const jobs=n=>B.fromFiles(Array.from({length:n},(_,i)=>file(`sound${i+1}.wav`))).jobs;
class Machine{
  constructor(){this.files=new Map();this.writes=0;this.switches=0;this.registers=0;this.directories=[]}
  async directory(bank){this.directories.push(bank);return this.list('/bank'+String(bank-1).padStart(2,'0'))}
  async list(folder){return [...this.files].filter(([path])=>path.startsWith(folder+'/')).map(([path,data])=>({name:path.slice(folder.length+1),bytes:data.length}))}
  async selectBank(){this.switches++}
  async createStage(){this.writes++}
  async write(path,data,cb){this.writes++;this.files.set(path,data.slice());cb(data.length,data.length)}
  async read(path,bytes,cb=()=>{}){const data=this.files.get(path);assert(data);assert.equal(data.length,bytes);cb(bytes,bytes);return data.slice()}
  async register(stage,bank){
    this.registers++;for(const [path,data] of [...this.files])if(path.startsWith(stage+'/')){this.files.set('/bank'+String(bank-1).padStart(2,'0')+path.slice(stage.length),data);this.files.delete(path)}
    if(this.failRegister===this.registers)throw Error('Connection lost after registration');
  }
}
module.exports=(async()=>{
  const passed=[];
  assert.deepEqual(B.plan(3,15,16),[{bank:15,pad:16},{bank:16,pad:1},{bank:16,pad:2}]);
  assert.deepEqual(B.plan(1,80,16),[{bank:80,pad:16}]);
  for(const args of [[2,80,16],[0,1,1],[1281,1,1],[1,81,1],[1,1,17]])assert.throws(()=>B.plan(...args),B.BatchError);
  passed.push('numbering crosses Bank boundaries and rejects overflow');
  const sorted=B.fromFiles([file('10.wav'),file('2.wav'),file('.hidden.wav'),{...file('notes.txt'),type:'text/plain'}]);
  assert.deepEqual(sorted.jobs.map(j=>j.path),['2.wav','10.wav']);assert.equal(sorted.ignored,2);
  const entry=name=>({name,isFile:true,file:resolve=>resolve(file(name))});
  const pages=[Array.from({length:100},(_,i)=>entry(`${i+1}.wav`)),[entry('101.wav'),{name:'nested',isDirectory:true,createReader(){let read=false;return {readEntries(resolve){resolve(read?[]:[entry('child.wav')]);read=true}}}}],[]];
  const directory={name:'Folder',isDirectory:true,createReader:()=>({readEntries:resolve=>resolve(pages.shift())})};
  const collected=await B.fromDrop({items:[{entry:directory}],files:[]});assert.equal(collected.jobs.length,102);assert(collected.jobs.some(j=>j.path==='Folder/nested/child.wav'));
  passed.push('numeric filename ordering, filtering, recursive folders and all directory pages');
  const blocked=new Machine(),q=jobs(3),firstFile=q[0].file;blocked.files.set('/bank15/02.wav.db',new Uint8Array([1]));
  await assert.rejects(()=>B.execute(blocked,q,{bank:15,pad:16}),e=>e.code==='occupied'&&e.consecutive===2&&e.conflicts[0].bank===16);
  assert.equal(blocked.writes,0);assert.equal(blocked.switches,0);assert.equal(q[0].file,firstFile);
  blocked.files.clear();await B.execute(blocked,q,{bank:15,pad:16});assert(q.every(j=>j.status==='complete'));assert.equal(blocked.registers,3);
  assert(blocked.files.has('/bank14/16.wav'));assert(blocked.files.has('/bank15/01.wav'));assert(blocked.files.has('/bank15/02.wav'));
  passed.push('later-Bank settings-only conflict causes zero writes; retry uses original files');
  const invalid=new Machine(),bad=jobs(3);let calls=0;
  await assert.rejects(()=>B.execute(invalid,bad,{bank:1,pad:1,prepare:async f=>{if(++calls===3)throw Error('invalid audio');return B.prepareFile(f)}}),e=>e.code==='audio');
  assert.equal(invalid.writes,0);assert.equal(invalid.switches,0);assert.equal(bad[2].status,'invalid');
  passed.push('every audio is validated before any device mutation');
  const raced=new Machine();let prepared=0;
  await assert.rejects(()=>B.execute(raced,jobs(2),{bank:1,pad:1,prepare:async f=>{if(++prepared===2)raced.files.set('/bank00/02.wav.db',new Uint8Array([1]));return B.prepareFile(f)}}),e=>e.code==='occupied');
  assert.equal(raced.writes,0);assert.equal(raced.switches,0);
  passed.push('whole span is checked again after audio preparation');
  const broken=new Machine(),resume=jobs(3);broken.failRegister=2;
  await assert.rejects(()=>B.execute(broken,resume,{bank:2,pad:1}),/Connection lost/);
  assert.deepEqual(resume.map(j=>j.status),['complete','uncertain','ready']);assert.equal(broken.registers,2);
  broken.failRegister=null;await B.execute(broken,resume,{bank:2,pad:1});assert.equal(broken.registers,3);assert(resume.every(j=>j.status==='complete'));assert.equal(resume[1].report.recovered,true);
  passed.push('interrupted registration is read back before retry; completed Pads are never resent');
  const mismatch=new Machine(),uncertain=jobs(1);mismatch.failRegister=1;
  await assert.rejects(()=>B.execute(mismatch,uncertain,{bank:3,pad:1}));mismatch.files.set('/bank02/01.wav.db',new Uint8Array([8]));
  const before=mismatch.writes;
  await assert.rejects(()=>B.execute(mismatch,uncertain,{bank:3,pad:1}),e=>e.code==='occupied');assert.equal(mismatch.writes,before);
  mismatch.files.delete('/bank02/01.wav');mismatch.files.delete('/bank02/01.wav.db');mismatch.failRegister=null;
  await B.execute(mismatch,uncertain,{bank:3,pad:1});assert.equal(uncertain[0].status,'complete');
  passed.push('unconfirmed conflicting content is protected; explicitly cleared destination can retry');
  const stopped=new Machine(),remaining=jobs(3);let stop=false;
  const checkpoint=()=>{if(stop)throw new B.BatchError('cancelled','stop')};
  await assert.rejects(()=>B.execute(stopped,remaining,{bank:4,pad:1,checkpoint,completed:()=>{stop=true}}),e=>e.code==='cancelled');
  assert.equal(stopped.registers,1);assert.equal(remaining[0].status,'complete');
  await assert.rejects(()=>B.execute(stopped,remaining,{bank:5,pad:1}),e=>e.code==='range');
  stop=false;await B.execute(stopped,remaining,{bank:4,pad:1,checkpoint});assert.equal(stopped.registers,3);
  passed.push('stopping preserves progress; resume keeps original destinations and skips completed files');
  return passed;
})();
module.exports.catch(e=>{console.error(e);process.exitCode=1});

if(require.main===module)module.exports.then(results=>console.log(results.map(s=>'PASS: '+s).join('\n'))).catch(()=>{});
