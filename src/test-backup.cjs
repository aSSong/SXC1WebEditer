'use strict';

// Synthetic filesystem and MIDI implementations only. These tests never request
// browser permissions, contact a device, or write backup data to the host disk.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
const B=require('./backup.js');
const encoder=new TextEncoder();
const folderName='SXC-1_Backup_TEST';
const now=()=>new Date('2026-11-16T18:00:00.000Z');
const padded=value=>String(value).padStart(2,'0');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function crc32(bytes){
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0)}
  return ((value^0xffffffff)>>>0).toString(16).padStart(8,'0');
}
function wav(samples=[0,0]){
  assert.equal(samples.length%2,0);
  const bytes=new Uint8Array(44+samples.length*2),view=new DataView(bytes.buffer);
  bytes.set(encoder.encode('RIFF'));view.setUint32(4,bytes.length-8,true);bytes.set(encoder.encode('WAVEfmt '),8);
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
  view.setUint32(24,48000,true);view.setUint32(28,192000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);
  bytes.set(encoder.encode('data'),36);view.setUint32(40,samples.length*2,true);
  samples.forEach((sample,index)=>view.setInt16(44+index*2,sample,true));return bytes;
}
function withWaveformChunks(audio){
  const chunks=[new Uint8Array([1,2,3,4]),new Uint8Array([5,6,7,8,9,10])],total=chunks.reduce((sum,bytes)=>sum+8+bytes.length,0);
  const output=new Uint8Array(audio.length+total);output.set(audio.subarray(0,36));let offset=36;
  for(const bytes of chunks){
    output.set(encoder.encode('CSwf'),offset);new DataView(output.buffer).setUint32(offset+4,bytes.length,true);
    output.set(bytes,offset+8);offset+=8+bytes.length;
  }
  output.set(audio.subarray(36),offset);new DataView(output.buffer).setUint32(4,output.length-8,true);return output;
}
function namedError(name,message=name){return Object.assign(new Error(message),{name})}
async function dataBytes(value){
  if(typeof value==='string')return encoder.encode(value);
  if(value instanceof Uint8Array)return value.slice();
  if(value instanceof ArrayBuffer)return new Uint8Array(value.slice(0));
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
  if(value&&typeof value.arrayBuffer==='function')return new Uint8Array(await value.arrayBuffer());
  throw new TypeError('Unsupported synthetic filesystem write');
}

class MemoryFile{
  constructor(name,fullPath,audit){this.kind='file';this.name=name;this.path=fullPath;this.audit=audit;this.bytes=new Uint8Array()}
  async getFile(){
    const bytes=this.bytes.slice();return {name:this.name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,text:async()=>new TextDecoder().decode(bytes)};
  }
  async createWritable(){
    this.audit.check('open',this.path);const file=this;let pending=new Uint8Array(),position=0,closed=false;
    return {
      async write(value){
        assert(!closed,'Cannot write a closed stream');
        if(value&&typeof value==='object'&&value.type==='seek'){position=value.position;return}
        if(value&&typeof value==='object'&&value.type==='truncate'){
          const resized=new Uint8Array(value.size);resized.set(pending.subarray(0,value.size));pending=resized;return;
        }
        if(value&&typeof value==='object'&&value.type==='write'){position=value.position??position;value=value.data}
        const bytes=await dataBytes(value);file.audit.check('write',file.path,bytes);
        const combined=new Uint8Array(Math.max(pending.length,position+bytes.length));combined.set(pending);combined.set(bytes,position);
        pending=combined;position+=bytes.length;
      },
      async close(){
        assert(!closed,'Cannot close twice');file.audit.check('close',file.path,pending);
        file.bytes=pending.slice();closed=true;
      },
      async abort(){closed=true}
    };
  }
}
class MemoryDirectory{
  constructor(name='',fullPath='',audit){
    this.kind='directory';this.name=name;this.path=fullPath;this.children=new Map();
    this.audit=audit||{operations:[],failure:null,check(operation,filePath,data){
      this.operations.push({operation,path:filePath,bytes:data?.length});
      const error=this.failure?.(operation,filePath,data);if(error)throw error;
    }};
  }
  childPath(name){
    if(!name||name==='.'||name==='..'||/[\\/\0]/.test(name))throw namedError('TypeError','Unsafe child name');
    return this.path?`${this.path}/${name}`:name;
  }
  async getDirectoryHandle(name,{create=false}={}){
    const fullPath=this.childPath(name),existing=this.children.get(name);
    if(existing){if(existing.kind!=='directory')throw namedError('TypeMismatchError');return existing}
    if(!create)throw namedError('NotFoundError');this.audit.check('mkdir',fullPath);
    const child=new MemoryDirectory(name,fullPath,this.audit);this.children.set(name,child);return child;
  }
  async getFileHandle(name,{create=false}={}){
    const fullPath=this.childPath(name),existing=this.children.get(name);
    if(existing){if(existing.kind!=='file')throw namedError('TypeMismatchError');return existing}
    if(!create)throw namedError('NotFoundError');this.audit.check('create',fullPath);
    const child=new MemoryFile(name,fullPath,this.audit);this.children.set(name,child);return child;
  }
  async *entries(){yield* this.children.entries()}
  async *values(){yield* this.children.values()}
  async queryPermission(){return 'granted'}
  async requestPermission(){return 'granted'}
  lookup(relative){return relative.split('/').reduce((current,name)=>current?.children?.get(name),this)}
  allFiles(prefix=''){
    const result=new Map();for(const [name,child] of this.children){
      const fullPath=prefix?`${prefix}/${name}`:name;
      if(child.kind==='file')result.set(fullPath,child.bytes.slice());
      else for(const entry of child.allFiles(fullPath))result.set(...entry);
    }return result;
  }
}
class MemoryMidi{
  constructor(){this.files=new Map();this.directoryCalls=[];this.readCalls=[];this.onDirectory=null;this.onRead=null;this.mutations=[]}
  put(bank,name,bytes){this.files.set(`/bank${padded(bank-1)}/${name}`,bytes.slice());return this}
  async directory(bank){
    assert(Number.isInteger(bank)&&bank>=1&&bank<=80);this.directoryCalls.push(bank);await this.onDirectory?.(bank,this);
    const prefix=`/bank${padded(bank-1)}/`;
    return [...this.files].filter(([filePath])=>filePath.startsWith(prefix)).map(([filePath,bytes])=>({name:filePath.slice(prefix.length),bytes:bytes.length}));
  }
  async read(filePath,expected,onProgress=()=>{}){
    this.readCalls.push(filePath);await this.onRead?.(filePath,this);
    const bytes=this.files.get(filePath);assert(bytes,`Unexpected sample read: ${filePath}`);assert.equal(expected,bytes.length);
    onProgress(bytes.length,bytes.length);return bytes.slice();
  }
  forbidden(name){this.mutations.push(name);throw Error(`A backup cannot call ${name}`)}
  async selectBank(){return this.forbidden('selectBank')}
  async setConfig(){return this.forbidden('setConfig')}
  async setBankParam(){return this.forbidden('setBankParam')}
  async setPadParam(){return this.forbidden('setPadParam')}
  async write(){return this.forbidden('write')}
  async register(){return this.forbidden('register')}
  async createStage(){return this.forbidden('createStage')}
}

const backup=(midi,parent,options={})=>B.backupAll(midi,parent,{folderName,now,...options});
const readJSON=(parent,relative)=>JSON.parse(new TextDecoder().decode(parent.lookup(relative).bytes));
function assertIncomplete(parent){
  const manifests=[...parent.allFiles()].filter(([name])=>name.endsWith('/manifest.json'));
  assert.equal(manifests.length,1,'A started export retains its manifest');
  const manifest=JSON.parse(new TextDecoder().decode(manifests[0][1]));
  assert.equal(manifest.state,'incomplete','A failed export never publishes a complete manifest');return manifest;
}
function currentImporter(){
  const app=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
  const validation=app.slice(app.indexOf('function validateManifest('),app.indexOf('\nasync function setArchive('));
  const entries=app.slice(app.indexOf('function bankEntries('),app.indexOf('\nasync function loadBank('));
  assert(validation.startsWith('function validateManifest('));assert(entries.startsWith('function bankEntries('));
  const context={state:{bank:1,manifest:null},pad2:padded};vm.createContext(context);
  new vm.Script(`${validation}\n${entries}`).runInContext(context);return context;
}

test('all 80 banks are scanned and only real pad audio with nonzero associated files is retained',async()=>{
  const midi=new MemoryMidi(),parent=new MemoryDirectory(),audio=wav([123,-123]);
  midi.put(1,'01.wav',audio).put(1,'01.wav.db',encoder.encode('OS 1\nLP 0\n'))
    .put(1,'01.extra',new Uint8Array([1,2])).put(1,'01.zero',new Uint8Array())
    .put(1,'02.wav',new Uint8Array()).put(1,'02.wav.db',encoder.encode('OS 1\n'))
    .put(1,'03.wav.db',encoder.encode('OS 1\n')).put(1,'17.wav',audio).put(1,'00.wav',audio).put(1,'1.wav',audio)
    .put(2,'01.wav.db',encoder.encode('OS 1\n')).put(80,'16.WAV',audio).put(80,'16.WAV.db',encoder.encode('OS 1\n'));
  const result=await backup(midi,parent),manifest=readJSON(parent,`${folderName}/manifest.json`);
  assert.equal(result.empty,false);assert.equal(result.scannedBanks,80);
  assert.deepEqual([...new Set(midi.directoryCalls)].sort((a,b)=>a-b),Array.from({length:80},(_,index)=>index+1));
  assert.deepEqual(manifest.banks.map(bank=>bank.number),[1,80]);
  assert.deepEqual(manifest.files.map(file=>file.output).sort(),['Bank01/01.extra','Bank01/01.wav','Bank01/01.wav.db','Bank80/16.WAV','Bank80/16.WAV.db']);
  assert(!midi.readCalls.some(filePath=>/(?:\/02\.|\/03\.|\/17\.|\/00\.|\/1\.wav$)/.test(filePath)),'Empty/orphan/out-of-range pads are not exported');
  assert.deepEqual(midi.mutations,[]);
});

test('a zero-audio WAV header is omitted but an intentionally silent recording is preserved',async()=>{
  const midi=new MemoryMidi(),parent=new MemoryDirectory(),emptyHeader=wav([]),silence=wav([0,0,0,0]);
  midi.put(3,'01.wav',emptyHeader).put(3,'01.wav.db',encoder.encode('OS 1\n'))
    .put(4,'01.wav',silence).put(4,'01.wav.db',encoder.encode('OS 1\n'));
  const result=await backup(midi,parent),manifest=readJSON(parent,`${folderName}/manifest.json`);
  assert.deepEqual(manifest.banks.map(bank=>bank.number),[4]);
  assert.deepEqual(parent.lookup(`${folderName}/Bank04/01.wav`).bytes,silence);
  assert(result.skippedSamples.some(sample=>sample.bank===3&&sample.pad===1&&sample.reason==='empty-audio'));
  assert(!parent.lookup(`${folderName}/Bank03`));
});

test('same short filenames in different banks retain distinct bytes and independently consumed checksums',async()=>{
  const midi=new MemoryMidi(),parent=new MemoryDirectory(),first=withWaveformChunks(wav([100,-100])),second=wav([222,-222]);
  midi.put(1,'01.wav',first).put(2,'01.wav',second);
  await backup(midi,parent);
  const manifest=readJSON(parent,`${folderName}/manifest.json`),importer=currentImporter();
  assert.equal(manifest.format,'sxc-backup-v1');assert.equal(manifest.state,'complete');
  assert.deepEqual(Array.from(importer.validateManifest(manifest)),[1,2]);
  const sums=new TextDecoder().decode(parent.lookup(`${folderName}/SHA256SUMS.txt`).bytes);
  let total=0;
  for(const record of manifest.files){
    const actual=parent.lookup(`${folderName}/${record.output}`).bytes;
    assert.equal(record.bytes,actual.length);assert.equal(record.sha256,sha256(actual));assert.equal(record.crc32,crc32(actual));
    assert(sums.split(/\r?\n/).includes(`${sha256(actual)}  ${record.output}`));total+=actual.length;
  }
  assert.equal(manifest.completed_files,manifest.files.length);assert.equal(manifest.completed_bytes,total);
  for(const bank of [1,2]){
    importer.state.manifest=manifest;importer.state.bank=bank;
    const entries=importer.bankEntries();assert.equal(entries.length,1);assert.equal(entries[0].name,'01.wav');
    assert.equal(entries[0].output,`Bank${padded(bank)}/01.wav`);
  }
  assert.deepEqual(parent.lookup(`${folderName}/Bank01/01.wav`).bytes,first);
  assert.deepEqual(parent.lookup(`${folderName}/Bank02/01.wav`).bytes,second);
  assert.notEqual(manifest.files[0].sha256,manifest.files[1].sha256);
  assert.deepEqual(midi.mutations,[]);
});

test('all-empty and settings-only devices produce no output folder or manifest',async()=>{
  for(const decorate of [()=>{},midi=>midi.put(7,'01.wav.db',encoder.encode('OS 1\n')),midi=>midi.put(7,'01.wav',wav([])),midi=>midi.put(7,'01.wav',withWaveformChunks(wav([])))]){
    const midi=new MemoryMidi(),parent=new MemoryDirectory();decorate(midi);
    const result=await backup(midi,parent);
    assert.equal(result.empty,true);assert.equal(result.folderName,null);assert.equal(result.scannedBanks,80);
    assert.equal(parent.children.size,0);assert.equal(parent.audit.operations.length,0);
    assert.equal(new Set(midi.directoryCalls).size,80);
  }
});

test('existing directory or file roots are refused without changing their bytes',async()=>{
  for(const kind of ['directory','file']){
    const midi=new MemoryMidi().put(1,'01.wav',wav([3,-3])),parent=new MemoryDirectory();
    if(kind==='directory'){
      const existing=await parent.getDirectoryHandle(folderName,{create:true});
      const marker=await existing.getFileHandle('owner-data.txt',{create:true});marker.bytes=encoder.encode('keep me');
    }else{const marker=await parent.getFileHandle(folderName,{create:true});marker.bytes=encoder.encode('keep me')}
    const before=[...parent.allFiles()].map(([name,bytes])=>[name,Array.from(bytes)]);parent.audit.operations=[];
    await assert.rejects(()=>backup(midi,parent));
    assert.deepEqual([...parent.allFiles()].map(([name,bytes])=>[name,Array.from(bytes)]),before);
    assert.equal(parent.audit.operations.length,0,'A colliding root must never be opened for writing');
  }
});

test('a nonempty root appearing during creation is never adopted or modified',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([3,-3])),parent=new MemoryDirectory();
  const getDirectory=parent.getDirectoryHandle.bind(parent);let injected=false;
  parent.getDirectoryHandle=async(name,options={})=>{
    if(name===folderName&&options.create&&!injected){
      injected=true;
      const other=new MemoryDirectory(folderName,folderName,parent.audit);
      const marker=new MemoryFile('owner-data.txt',`${folderName}/owner-data.txt`,parent.audit);marker.bytes=encoder.encode('keep me');
      other.children.set(marker.name,marker);parent.children.set(folderName,other);
    }
    return getDirectory(name,options);
  };
  await assert.rejects(()=>backup(midi,parent),error=>{
    assert.equal(error.code,'folder-exists');
    assert.equal(error.backupResult.folderName,null,'A refused folder must not be reported as this export’s saved output');
    return true;
  });
  assert.equal(injected,true);
  assert.deepEqual([...parent.allFiles()].map(([name,bytes])=>[name,new TextDecoder().decode(bytes)]),[[`${folderName}/owner-data.txt`,'keep me']]);
  assert(!parent.audit.operations.some(operation=>['open','write','close','create'].includes(operation.operation)),'Collision recovery must not write into another directory');
});

test('a changed bank inventory aborts instead of publishing complete',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([4,-4])),parent=new MemoryDirectory();let changed=false;
  midi.onRead=(filePath,machine)=>{if(!changed){changed=true;machine.put(1,'02.wav',wav([5,-5]))}};
  await assert.rejects(()=>backup(midi,parent));
  if(parent.children.size)assertIncomplete(parent);
  assert.deepEqual(midi.mutations,[]);
});

test('the final scan catches an initially empty bank gaining a sample during export',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([4,-4])),parent=new MemoryDirectory();let changed=false;
  midi.onRead=(_filePath,machine)=>{if(!changed){changed=true;machine.put(80,'01.wav',wav([5,-5]))}};
  await assert.rejects(()=>backup(midi,parent));assertIncomplete(parent);
});

test('a directory query failure cannot be misreported as an empty bank',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([1,-1])),parent=new MemoryDirectory(),failure=new Error('Synthetic Bank45 directory failure');
  midi.onDirectory=bank=>{if(bank===45)throw failure};
  await assert.rejects(()=>backup(midi,parent),error=>error===failure);
  assert.equal(parent.children.size,0,'Preflight scan failure creates no output');
});

test('device read errors propagate and leave any started backup incomplete',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([1,-1])).put(2,'01.wav',wav([2,-2])),parent=new MemoryDirectory();
  const failure=new Error('Synthetic MIDI read failure');midi.onRead=filePath=>{if(filePath==='/bank01/01.wav')throw failure};
  await assert.rejects(()=>backup(midi,parent),error=>error===failure);
  assertIncomplete(parent);assert.equal(failure.backupResult.manifest.state,'incomplete');
});

test('a disk write failure retains an incomplete manifest and never claims successful files',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([11,-11])),parent=new MemoryDirectory(),failure=new Error('Synthetic disk full');
  parent.audit.failure=(operation,filePath)=>operation==='write'&&filePath.endsWith('/Bank01/01.wav')?failure:null;
  await assert.rejects(()=>backup(midi,parent),error=>error===failure);
  const manifest=assertIncomplete(parent);assert.equal(manifest.completed_files,0);
  assert.equal(failure.backupResult.manifest.state,'incomplete');
});

test('failure closing SHA256SUMS prevents complete finalization',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([21,-21])),parent=new MemoryDirectory(),failure=new Error('Synthetic checksum close failure');
  parent.audit.failure=(operation,filePath)=>operation==='close'&&filePath.endsWith('/SHA256SUMS.txt')?failure:null;
  await assert.rejects(()=>backup(midi,parent),error=>error===failure);assertIncomplete(parent);
});

test('failure closing the final manifest cannot replace its earlier incomplete state',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([21,-21])),parent=new MemoryDirectory(),failure=new Error('Synthetic final manifest close failure');
  parent.audit.failure=(operation,filePath,bytes)=>{
    if(operation==='close'&&filePath.endsWith('/manifest.json')&&JSON.parse(new TextDecoder().decode(bytes)).state==='complete')return failure;
    return null;
  };
  await assert.rejects(()=>backup(midi,parent),error=>error===failure);assertIncomplete(parent);
});

test('wrong-length reads and malformed positive WAV files never produce a complete archive',async()=>{
  for(const malformed of [false,true]){
    const midi=new MemoryMidi().put(1,'01.wav',wav([1,-1])).put(2,'01.wav',malformed?new Uint8Array([1,2,3,4]):wav([2,-2]));
    const parent=new MemoryDirectory(),read=midi.read.bind(midi);
    if(!malformed)midi.read=async(...args)=>{const bytes=await read(...args);return args[0]==='/bank01/01.wav'?bytes.slice(1):bytes};
    await assert.rejects(()=>backup(midi,parent));assertIncomplete(parent);
  }
});

test('filesystem read-back detects silently corrupted saved bytes',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([22,-22])),parent=new MemoryDirectory();
  parent.audit.failure=(operation,filePath,bytes)=>{
    if(operation==='close'&&filePath.endsWith('/Bank01/01.wav'))bytes[bytes.length-1]^=0xff;
    return null;
  };
  await assert.rejects(()=>backup(midi,parent),error=>error.code==='disk-verification');assertIncomplete(parent);
});

test('cancellation after a completed file preserves that file and an incomplete report',async()=>{
  const first=wav([31,-31]),midi=new MemoryMidi().put(1,'01.wav',first).put(2,'01.wav',wav([32,-32])),parent=new MemoryDirectory();
  const failure=namedError('AbortError','Synthetic user cancellation');
  const checkpoint=()=>{
    const stored=parent.lookup(`${folderName}/manifest.json`)?.bytes;
    if(stored?.length&&JSON.parse(new TextDecoder().decode(stored)).completed_files>=1)throw failure;
  };
  await assert.rejects(()=>backup(midi,parent,{checkpoint}),error=>error===failure);
  assert.deepEqual(parent.lookup(`${folderName}/Bank01/01.wav`).bytes,first);assertIncomplete(parent);
  assert.equal(failure.backupResult.manifest.state,'incomplete');assert.equal(failure.backupResult.manifest.completed_files,1);
  assert.deepEqual(midi.mutations,[]);
});

test('unsafe or ambiguous inventory entries are rejected before any backup payload is written',async()=>{
  for(const entries of [
    [{name:'../01.wav',bytes:48}],
    [{name:'01.wav/child',bytes:48}],
    [{name:'01.wav\0',bytes:48}],
    [{name:'01.wav',bytes:-1}],
    [{name:'01.wav',bytes:1.5}],
    [{name:'01.wav',bytes:NaN}],
    [{name:'01.wav',bytes:256*1024*1024+1}],
    [{name:'01.wav',bytes:48},{name:'01.WAV',bytes:48}],
    [{name:'01.wav',bytes:48},{name:'01.wav',bytes:48}],
    [{name:'01.ß',bytes:1},{name:'01.ss',bytes:1}],
    [{name:'01.Σ',bytes:1},{name:'01.ς',bytes:1}],
    [{name:'01.e\u0301',bytes:1},{name:'01.é',bytes:1}]
  ]){
    const midi=new MemoryMidi(),parent=new MemoryDirectory();midi.directory=async bank=>bank===1?entries:[];
    await assert.rejects(()=>backup(midi,parent));assert.equal(parent.children.size,0);
  }
});

test('directory and per-pad file bounds are enforced before reading or creating output',async()=>{
  for(const [entries,code] of [
    [Array.from({length:513},(_,index)=>({name:`orphan${index}.db`,bytes:1})),'too-many-entries'],
    [[{name:'01.wav',bytes:48},...Array.from({length:32},(_,index)=>({name:`01.sidecar${index}`,bytes:1}))],'too-many-sidecars']
  ]){
    const midi=new MemoryMidi(),parent=new MemoryDirectory();midi.directory=async bank=>bank===1?entries:[];
    await assert.rejects(()=>backup(midi,parent),error=>error.code===code);
    assert.equal(midi.readCalls.length,0);assert.equal(parent.children.size,0);assert.equal(parent.audit.operations.length,0);
  }
  const midi=new MemoryMidi(),parent=new MemoryDirectory();
  midi.directory=async bank=>bank===1?Array.from({length:512},(_,index)=>({name:`orphan${index}.db`,bytes:1})):[];
  assert.equal((await backup(midi,parent)).empty,true,'The documented directory limit remains inclusive');
  assert.equal(parent.children.size,0);
});

test('failure persisting the recovery manifest preserves the original error and reports persistence failure',async()=>{
  const midi=new MemoryMidi().put(1,'01.wav',wav([41,-41])).put(2,'01.wav',wav([42,-42])),parent=new MemoryDirectory();
  const original=new Error('Synthetic original device error'),recovery=new Error('Synthetic recovery disk failure');let recovering=false;
  midi.onRead=filePath=>{if(filePath==='/bank01/01.wav'){recovering=true;throw original}};
  parent.audit.failure=(operation,filePath)=>recovering&&operation==='write'&&filePath.endsWith('/manifest.json')?recovery:null;
  await assert.rejects(()=>backup(midi,parent),error=>error===original);
  assertIncomplete(parent);
  assert.equal(original.backupResult.manifest.state,'incomplete');
  assert.equal(original.backupResult.manifestSaved,false);
  assert.equal(original.backupResult.persistenceError,recovery.message);
});

test('a checkpoint NotFoundError is not mistaken for a missing output folder',async()=>{
  const midi=new MemoryMidi(),parent=new MemoryDirectory(),failure=namedError('NotFoundError','Synthetic checkpoint cancellation');
  let checkpoints=0,lookups=0;
  for(const method of ['getDirectoryHandle','getFileHandle']){
    const original=parent[method].bind(parent);
    parent[method]=async(...args)=>{lookups++;return original(...args)};
  }
  await assert.rejects(()=>backup(midi,parent,{checkpoint(){checkpoints++;throw failure}}),error=>error===failure);
  assert.equal(checkpoints,1);assert.equal(lookups,0);assert.equal(midi.directoryCalls.length,0);assert.equal(parent.children.size,0);
});
