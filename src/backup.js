'use strict';
// Content export only: this module never selects a Bank or writes to the sampler.
const SXCBackup = ((S) => {
  const BANKS=80,MAX_FILE_BYTES=256*1024*1024,MAX_ENTRIES=512,MAX_PAD_FILES=32;
  const pad=n=>String(n).padStart(2,'0');
  const messages={
    'invalid-options':'Invalid backup options.',
    'invalid-folder':'Use a new, safe backup folder name.',
    'folder-exists':'The backup folder already exists. Choose a new name.',
    'invalid-directory':'The sampler returned an invalid directory.',
    'invalid-entry':'The sampler returned an unsafe file name or invalid file size.',
    'duplicate-entry':'The sampler directory contains duplicate file names.',
    'file-too-large':'A sampler file exceeds the 256 MiB backup limit.',
    'too-many-entries':'A sampler Bank has too many directory entries.',
    'too-many-sidecars':'A Pad has more than 32 related files.',
    'directory-changed':'The sampler directory changed during backup. Treat this backup as incomplete.',
    'invalid-wave':'A nonempty WAV file is malformed. Treat this backup as incomplete.',
    'invalid-read':'The sampler returned an unexpected file length or invalid read progress.',
    'disk-verification':'A saved file failed read-back verification. Treat this backup as incomplete.'
  };
  class BackupError extends Error {
    constructor(code,details={}){super(messages[code]||code);this.name='BackupError';this.code=code;Object.assign(this,details)}
  }
  const fail=(code,details)=>{throw new BackupError(code,details)};
  function safeName(name){
    return typeof name==='string'&&name.length>0&&S.te.encode(name).length<=255&&
      !/[\/\\\x00-\x1f\x7f]/.test(name)&&!name.includes('..')&&name!=='.'&&!/[. ]$/.test(name);
  }
  function validateEntries(entries,bank){
    if(!Array.isArray(entries))fail('invalid-directory',{bank});
    if(entries.length>MAX_ENTRIES)fail('too-many-entries',{bank});
    const names=new Set(),copy=[];
    for(const entry of entries){
      if(!entry||!safeName(entry.name)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)fail('invalid-entry',{bank});
      if(entry.bytes>MAX_FILE_BYTES)fail('file-too-large',{bank,name:entry.name});
      // Conservatively cover caseless aliases (including ß/SS and σ/ς), as
      // well as canonically equivalent names on common case-insensitive disks.
      const folded=entry.name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
      if(names.has(folded))fail('duplicate-entry',{bank,name:entry.name});
      names.add(folded);copy.push({name:entry.name,bytes:entry.bytes});
    }
    return copy.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  }
  const inventory=entries=>JSON.stringify(entries.map(e=>[e.name,e.bytes]));
  // Only a well-formed RIFF/WAVE with an actual zero-length data chunk is empty.
  // Sample values are never examined: an all-zero (silent) recording is retained.
  function waveDataBytes(raw){
    if(!(raw instanceof Uint8Array)||raw.length<12)fail('invalid-wave');
    const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    const tag=p=>String.fromCharCode(...raw.subarray(p,p+4));
    if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)+8!==raw.length)fail('invalid-wave');
    let position=12,format=null,data=null;
    while(position<raw.length){
      if(position+8>raw.length)fail('invalid-wave');
      const id=tag(position),length=view.getUint32(position+4,true),start=position+8,end=start+length;
      if(end>raw.length||end+(length&1)>raw.length)fail('invalid-wave');
      if(id==='fmt '){
        if(format||length<16)fail('invalid-wave');
        format={code:view.getUint16(start,true),channels:view.getUint16(start+2,true),rate:view.getUint32(start+4,true),byteRate:view.getUint32(start+8,true),align:view.getUint16(start+12,true),bits:view.getUint16(start+14,true)};
        if(!format.code||!format.channels||!format.rate||!format.align||!format.byteRate)fail('invalid-wave');
        if([1,3].includes(format.code)&&(!format.bits||format.bits%8||format.align!==format.channels*format.bits/8||format.byteRate!==format.rate*format.align))fail('invalid-wave');
      }
      if(id==='data'){if(data!==null)fail('invalid-wave');data=length}
      position=end+(length&1);
    }
    if(!format||data===null||([1,3].includes(format.code)&&data%format.align))fail('invalid-wave');
    return data;
  }
  function plan(entries,bank){
    const samples=[];
    for(let number=1;number<=16;number++){
      const prefix=pad(number)+'.',audio=entries.find(e=>e.name.toLowerCase()===prefix+'wav');
      if(!audio)continue;
      const related=entries.filter(e=>e.bytes>0&&e.name.toLowerCase().startsWith(prefix));
      if(related.length>MAX_PAD_FILES)fail('too-many-sidecars',{bank,pad:number});
      samples.push({pad:number,audio,sidecars:related.filter(e=>e!==audio)});
    }
    return samples;
  }
  async function backupAll(midi,parent,options={}){
    if(!options||typeof options!=='object')fail('invalid-options');
    const {folderName,checkpoint=()=>{},progress=()=>{},now=()=>new Date()}=options;
    if(!midi||typeof midi.directory!=='function'||typeof midi.read!=='function'||
      !parent||typeof parent.getDirectoryHandle!=='function'||typeof parent.getFileHandle!=='function'||
      typeof checkpoint!=='function'||typeof progress!=='function'||typeof now!=='function')fail('invalid-options');
    if(typeof folderName!=='string'||!safeName(folderName)||folderName.length>120||!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(folderName))fail('invalid-folder');
    const stamp=()=>{try{const date=now();if(date&&typeof date.toISOString==='function')return date.toISOString()}catch{}fail('invalid-options')};
    const started=stamp(),snapshots=[],plans=[],bankHandles=new Map();
    const manifest={format:'sxc-backup-v1',state:'incomplete',source:'SXC-1 device',scope:'sound-bank-samples-and-sidecars',
      created_at:started,started_at:started,updated_at:started,folder_name:folderName,scanned_banks:0,
      skipped_banks:[],skipped_samples:[],banks:[],files:[],completed_files:0,completed_bytes:0};
    let root=null,ownsRoot=false,manifestSaved=false,context={phase:'scan'},persistenceError=null;
    const result=empty=>({manifest,folderName:ownsRoot?folderName:null,scannedBanks:manifest.scanned_banks,
      skippedBanks:manifest.skipped_banks.slice(),skippedSamples:manifest.skipped_samples.slice(),empty,manifestSaved,
      ...(persistenceError?{persistenceError}: {})});
    const emit=(phase,details={})=>{
      context={phase,...details};progress({...context,scannedBanks:manifest.scanned_banks,totalBanks:BANKS,
        completedFiles:manifest.completed_files,completedBytes:manifest.completed_bytes});
    };
    const wait=async(action,recovery=false)=>{if(!recovery)checkpoint();const value=await action();if(!recovery)checkpoint();return value};
    async function absent(directory,name,recovery=false){
      for(const method of ['getDirectoryHandle','getFileHandle']){
        if(!recovery)checkpoint();let missing=false;
        try{await directory[method](name)}
        catch(error){if(error?.name==='NotFoundError')missing=true;else if(error?.name==='TypeMismatchError')fail('folder-exists',{name});else throw error}
        // Only the filesystem operation's NotFoundError means "absent"; a
        // cancellation/checkpoint exception must keep its original identity.
        if(!recovery)checkpoint();if(!missing)fail('folder-exists',{name});
      }
    }
    async function writeClosed(handle,data,recovery=false){
      let writable=null,closed=false;
      try{
        if(!recovery)checkpoint();writable=await handle.createWritable();if(!recovery)checkpoint();
        await wait(()=>writable.write(data),recovery);
        if(!recovery)checkpoint();await writable.close();closed=true;if(!recovery)checkpoint();
      }catch(error){
        if(writable&&!closed&&typeof writable.abort==='function')try{await writable.abort()}catch{}
        throw error;
      }
    }
    async function verifyFile(handle,expected,recovery=false){
      const file=await wait(()=>handle.getFile(),recovery);
      if(file.size!==expected.bytes)fail('disk-verification',{output:expected.output});
      let bytes=new Uint8Array(await wait(()=>file.arrayBuffer(),recovery));
      if(bytes.length!==expected.bytes||S.crc32(bytes).toString(16).padStart(8,'0')!==expected.crc32||
        await wait(()=>S.sha256(bytes),recovery)!==expected.sha256)fail('disk-verification',{output:expected.output});
      bytes=null;
    }
    async function writeMetadata(name,text,recovery=false){
      const data=S.te.encode(text),expected={output:name,bytes:data.length,crc32:S.crc32(data).toString(16).padStart(8,'0'),sha256:await wait(()=>S.sha256(data),recovery)};
      const handle=await wait(()=>root.getFileHandle(name,{create:true}),recovery);
      await writeClosed(handle,data,recovery);await verifyFile(handle,expected,recovery);
    }
    async function saveManifest(recovery=false){
      if(recovery){try{manifest.updated_at=stamp()}catch{}}
      else manifest.updated_at=stamp();
      manifestSaved=false;await writeMetadata('manifest.json',JSON.stringify(manifest,null,2)+'\n',recovery);manifestSaved=true;
    }
    const sums=()=>manifest.files.map(f=>f.sha256+'  '+f.output).join('\n')+(manifest.files.length?'\n':'');
    async function ensureRoot(){
      if(root)return;
      // The picker API has no exclusive-create flag. Recheck immediately before
      // creating the caller's timestamp/UUID name, and never reuse an existing one.
      await absent(parent,folderName);
      checkpoint();root=await parent.getDirectoryHandle(folderName,{create:true});checkpoint();
      if(typeof root.entries!=='function')fail('invalid-options');
      const iterator=root.entries();
      const first=await wait(()=>iterator.next());
      if(!first.done)fail('folder-exists',{name:folderName});
      ownsRoot=true;
      await saveManifest();
    }
    async function sameDirectory(bank,stage){
      emit('scan',{bank,stage});
      const current=validateEntries(await wait(()=>midi.directory(bank)),bank);
      if(inventory(current)!==inventory(snapshots[bank-1]))fail('directory-changed',{bank,stage});
    }
    async function saveEntry(bank,number,entry,audio){
      const path='/bank'+pad(bank-1)+'/'+entry.name,output='Bank'+pad(bank)+'/'+entry.name;
      emit('read',{bank,pad:number,name:entry.name,loaded:0,total:entry.bytes});
      let raw=await wait(()=>midi.read(path,entry.bytes,(loaded,total)=>{
        checkpoint();if(!Number.isSafeInteger(loaded)||loaded<0||loaded>entry.bytes||total!==entry.bytes)fail('invalid-read',{bank,pad:number,name:entry.name});
        emit('read',{bank,pad:number,name:entry.name,loaded,total});
      }));
      if(!(raw instanceof Uint8Array)||raw.length!==entry.bytes)fail('invalid-read',{bank,pad:number,name:entry.name});
      if(audio&&waveDataBytes(raw)===0){manifest.skipped_samples.push({bank,pad:number,reason:'empty-audio'});raw=null;return false}
      const record={bank,pad:number,name:entry.name,output,bytes:raw.length,
        sha256:await wait(()=>S.sha256(raw)),crc32:S.crc32(raw).toString(16).padStart(8,'0')};
      await ensureRoot();manifest.pending_file={...record,state:'writing'};await saveManifest();
      let directory=bankHandles.get(bank);
      if(!directory){directory=await wait(()=>root.getDirectoryHandle('Bank'+pad(bank),{create:true}));bankHandles.set(bank,directory)}
      await absent(directory,entry.name);
      const handle=await wait(()=>directory.getFileHandle(entry.name,{create:true}));
      emit('save',{bank,pad:number,name:entry.name,loaded:0,total:entry.bytes});
      await writeClosed(handle,raw);raw=null;
      manifest.pending_file.state='verifying';
      emit('verify',{bank,pad:number,name:entry.name,loaded:entry.bytes,total:entry.bytes});
      await verifyFile(handle,record);
      manifest.files.push(record);manifest.completed_files=manifest.files.length;manifest.completed_bytes+=record.bytes;
      let bankRecord=manifest.banks.find(b=>b.number===bank);
      if(!bankRecord){bankRecord={number:bank,path:'Bank'+pad(bank),samples:[],files:[]};manifest.banks.push(bankRecord)}
      if(audio)bankRecord.samples.push(number);bankRecord.files.push(record);
      delete manifest.pending_file;await saveManifest();
      return true;
    }
    try{
      await absent(parent,folderName);
      // Validate every Bank before the first file read or local output creation.
      for(let bank=1;bank<=BANKS;bank++){
        emit('scan',{bank,stage:'initial'});
        const entries=validateEntries(await wait(()=>midi.directory(bank)),bank);
        snapshots.push(entries);plans.push(plan(entries,bank));manifest.scanned_banks=bank;
      }
      for(let bank=1;bank<=BANKS;bank++){
        const samples=plans[bank-1];let retained=0;
        if(samples.some(s=>s.audio.bytes>0))await sameDirectory(bank,'before');
        for(const sample of samples){
          checkpoint();
          if(sample.audio.bytes===0){manifest.skipped_samples.push({bank,pad:sample.pad,reason:'zero-file'});continue}
          if(!await saveEntry(bank,sample.pad,sample.audio,true))continue;
          retained++;
          for(const sidecar of sample.sidecars)await saveEntry(bank,sample.pad,sidecar,false);
        }
        if(samples.some(s=>s.audio.bytes>0))await sameDirectory(bank,'after');
        if(!retained)manifest.skipped_banks.push(bank);
      }
      // Also revisit initially empty Banks: later additions must not disappear
      // silently from a supposedly complete export. Snapshots compare names/sizes.
      for(let bank=1;bank<=BANKS;bank++)await sameDirectory(bank,'final');
      checkpoint();
      if(!root){manifest.state='complete';manifest.updated_at=stamp();emit('empty');return result(true)}
      await writeMetadata('SHA256SUMS.txt',sums());
      manifest.state='complete';delete manifest.error;await saveManifest();
      // No cancellation checkpoint follows the successful final commit.
      emit('complete');return result(false);
    }catch(error){
      manifest.state='incomplete';
      manifest.error={code:String(error?.code||error?.name||'error'),message:String(error?.message||error).slice(0,4096),...context};
      if(root&&ownsRoot){
        try{await writeMetadata('SHA256SUMS.txt',sums(),true)}catch(recoveryError){persistenceError=String(recoveryError?.message||recoveryError)}
        try{await saveManifest(true)}catch(recoveryError){manifestSaved=false;persistenceError=String(recoveryError?.message||recoveryError)}
      }
      const partial=result(false);
      // Diagnostics and recovery must never replace the original failure.
      try{error.backupResult=partial;error.backupManifest=manifest;error.folderName=partial.folderName}catch{}
      try{emit('incomplete',{bank:context.bank,pad:context.pad,name:context.name})}catch{}
      throw error;
    }
  }
  return {BANKS,MAX_FILE_BYTES,MAX_ENTRIES,MAX_PAD_FILES,BackupError,validateEntries,waveDataBytes,backupAll};
})(typeof module!=='undefined'?require('./core.js'):SXC);
if(typeof module!=='undefined')module.exports=SXCBackup;
