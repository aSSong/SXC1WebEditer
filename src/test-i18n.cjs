'use strict';

// Offline localization contracts. No editor application or transport is executed.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');

const engine=fs.readFileSync(path.join(__dirname,'i18n.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'locales/en.json'),'utf8'));
const marker='/*EN_MESSAGES*/{}';
const fixture={
  '连接 SXC-1':'Connect SXC-1',
  '采样管理器':'Sample manager',
  '本地采样管理器':'Local sample manager',
  '试听 Pad {pad}':'Preview pad {pad}',
  '文件“{name}”无效':'Invalid file “{name}”',
  '已读取 {done} / {total} 字节':'Read {done} / {total} bytes',
  '操作失败：{error}':'Operation failed: {error}',
  '读取失败：{error}':'Read failed: {error}',
  '{operation}失败：{error}':'{operation} failed: {error}',
  '文件损坏':'Corrupt file',
  '传送 {filename}':'Transferring {filename}',
  '{detail} · {name}':'{detail} · {name}',
  '{completed}/{total} · {target} · {progress}':'{completed}/{total} · {target} · {progress}'
};

class Element{
  constructor(tag='div',attributes={}){
    this.tagName=tag.toUpperCase();this.attributes=new Map(Object.entries(attributes));
    this.children=[];this.listeners=new Map();this.textContent='';this.value='';
  }
  setAttribute(name,value){this.attributes.set(name,String(value))}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null}
  hasAttribute(name){return this.attributes.has(name)}
  matches(selector){
    return selector.split(',').some(part=>{
      const match=/^\[([^\]]+)\]$/.exec(part.trim());
      return !!match&&this.hasAttribute(match[1]);
    });
  }
  querySelectorAll(selector){
    return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);
  }
  appendChild(child){this.children.push(child);return child}
  addEventListener(type,callback){
    const list=this.listeners.get(type)||[];list.push(callback);this.listeners.set(type,list);
  }
  dispatchEvent(event){for(const callback of this.listeners.get(event.type)||[])callback.call(this,event)}
  set innerHTML(_value){throw Error('Localization must not interpret message or filename HTML')}
}

class Document extends Element{
  constructor(){
    super('#document');this.documentElement=this.appendChild(new Element('html'));
    this.head=this.documentElement.appendChild(new Element('head'));
    this.titleElement=this.head.appendChild(new Element('title',{'data-i18n':'采样管理器'}));
    this.description=this.head.appendChild(new Element('meta',{
      name:'description',content:'本地采样管理器','data-i18n-content':'本地采样管理器'
    }));
    this.body=this.documentElement.appendChild(new Element('body'));
    this.select=this.body.appendChild(new Element('select',{id:'language'}));
  }
  get title(){return this.titleElement.textContent}
  getElementById(id){
    const visit=element=>element.getAttribute('id')===id?element:element.children.map(visit).find(Boolean);
    return visit(this);
  }
}

function load({messages=fixture,languages=['en-US'],saved,storageFailure,document}={}){
  const calls={device:0,network:0,reload:0,storage:[]};
  const denied=type=>(..._args)=>{calls[type]++;throw Error(`Unexpected ${type} access in localization`)};
  const context={
    console,document,navigator:{languages,language:languages[0],requestMIDIAccess:denied('device'),
      usb:{requestDevice:denied('device'),getDevices:denied('device')}},
    fetch:denied('network'),WebSocket:denied('network'),XMLHttpRequest:denied('network'),
    location:{reload:denied('reload')},
    localStorage:{
      getItem(key){calls.storage.push(['get',key]);if(storageFailure==='get')throw Error('Storage unavailable');return saved??null},
      setItem(key,value){calls.storage.push(['set',key,value]);if(storageFailure==='set')throw Error('Storage unavailable')}
    }
  };
  if(storageFailure==='property')Object.defineProperty(context,'localStorage',{get(){throw Error('Storage unavailable')}});
  vm.createContext(context);
  assert.equal(engine.split(marker).length,2,'The engine must have one catalog build marker');
  new vm.Script(engine.replace(marker,JSON.stringify(messages)),{filename:'i18n.fixture.js'}).runInContext(context);
  return {i18n:context.SXCI18n,calls,context};
}

test('language detection respects a valid saved choice and the first browser language',()=>{
  const {i18n}=load();
  for(const [languages,saved,expected] of [
    [['zh-CN'],'en','en'],[['en-US'],'zh-CN','zh-CN'],
    [['zh-TW'],'invalid','zh-CN'],[['ZH-hk'],null,'zh-CN'],[['zh'],undefined,'zh-CN'],
    [['en-US','zh-CN'],null,'en'],[['fr-FR','zh-CN'],undefined,'en'],
    [[],null,'en'],[undefined,'invalid','en']
  ])assert.equal(i18n.detectLanguage(languages,saved),expected);
  assert.equal(load({languages:['zh-Hant']}).i18n.getLanguage(),'zh-CN');
  assert.equal(load({languages:['en-US'],saved:'zh-CN'}).i18n.getLanguage(),'zh-CN');
  assert.equal(load({languages:['zh-CN'],saved:'en'}).i18n.getLanguage(),'en');
});

test('language preference persists and inaccessible storage never prevents switching',()=>{
  const {i18n,calls}=load();i18n.setLanguage('zh-CN');i18n.setLanguage('en');
  assert.deepEqual(calls.storage,[['get','sxc-language'],['set','sxc-language','zh-CN'],['set','sxc-language','en']]);
  for(const failure of ['get','set','property']){
    const test=load({languages:['zh-CN'],saved:'en',storageFailure:failure});
    assert.equal(test.i18n.getLanguage(),failure==='set'?'en':'zh-CN');
    assert.doesNotThrow(()=>test.i18n.setLanguage('en'));assert.equal(test.i18n.getLanguage(),'en');
    assert.doesNotThrow(()=>test.i18n.setLanguage('zh-CN'));assert.equal(test.i18n.getLanguage(),'zh-CN');
  }
  for(const invalid of ['fr','zh','EN','',null,undefined]){
    const language=i18n.getLanguage();
    assert.throws(()=>i18n.setLanguage(invalid),error=>error.name==='RangeError');
    assert.equal(i18n.getLanguage(),language,'Invalid preferences cannot mutate language');
  }
});

test('Chinese and English templates have identical named placeholders',()=>{
  assert.equal(typeof catalog,'object');assert(!Array.isArray(catalog));
  const entries=Object.entries(catalog);assert(entries.length>0,'The production English catalog must not be empty');
  const placeholders=value=>[...value.matchAll(/\{([A-Za-z]\w*)\}/g)].map(match=>match[1]).sort();
  for(const [source,english] of entries){
    assert(source.trim(),'Empty Chinese source key');
    assert.equal(typeof english,'string',`English message is not a string: ${source}`);
    assert(english.trim(),`Empty English message: ${source}`);
    assert.deepEqual(placeholders(source),placeholders(english),`Placeholder mismatch: ${source}`);
  }
});

test('every annotated static page message has an English translation',()=>{
  const page=fs.readFileSync(path.join(__dirname,'page.html'),'utf8');
  const messages=[...page.matchAll(/\bdata-i18n(?:-(?:aria-label|title|content))?="([^"]*)"/g)].map(match=>match[1]);
  assert(messages.length>0,'The page must expose localization annotations');
  for(const source of messages)assert(Object.hasOwn(catalog,source),`Missing static translation: ${source}`);
});

test('placeholder values stay literal, including Chinese names and HTML-like content',()=>{
  const {i18n}=load();
  for(const name of ['连接 SXC-1','采样/鼓声 02.wav','<img src=x onerror="resetDevice()">','{done} / {error}','line1\n文件.wav']){
    assert.equal(i18n.t('文件“{name}”无效',{name}),`Invalid file “${name}”`);
    assert.equal(i18n.format(i18n.raw(`文件“${name}”无效`)),`Invalid file “${name}”`);
  }
  assert.equal(i18n.t('已读取 {done} / {total} 字节',{done:0,total:2048}),'Read 0 / 2048 bytes');
  assert.equal(i18n.t('已读取 {done} / {total} 字节',{done:3}),'Read 3 / {total} bytes');
  const message=i18n.msg('操作失败：{error}',{error:i18n.msg('文件“{name}”无效',{name:'连接 SXC-1'})});
  assert.equal(i18n.format(message),'Operation failed: Invalid file “连接 SXC-1”');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.format(message),'操作失败：文件“连接 SXC-1”无效');
});

test('raw errors recover known templates and preserve unknown native errors',()=>{
  const {i18n}=load();
  assert.equal(i18n.format(i18n.raw('读取失败：文件损坏')),'Read failed: Corrupt file');
  assert.equal(i18n.format(i18n.raw('操作失败：读取失败：文件损坏')),'Operation failed: Read failed: Corrupt file');
  for(const unknown of ['DOMException: permission denied','JSON parse error at position7','未知浏览器错误','读取失败'])
    assert.equal(i18n.format(i18n.raw(unknown)),unknown);
  assert.equal(i18n.format(i18n.raw('操作失败：<b>未识别错误</b>')),'Operation failed: <b>未识别错误</b>');
  const descriptor=i18n.msg('文件“{name}”无效',{name:'中文.wav'});
  assert.equal(i18n.raw(descriptor),descriptor,'An existing descriptor retains its original parameters');
});

test('raw batch progress localizes its nested status while preserving the filename',()=>{
  const {i18n}=load();
  const filename='采样/连接 SXC-1 <b>鼓</b>.wav';
  const raw=`1/2 · Bank 02 / Pad 03 · 传送 ${filename}`;
  const message=i18n.raw(raw);
  assert.equal(i18n.format(message),`1/2 · Bank 02 / Pad 03 · Transferring ${filename}`);
  i18n.setLanguage('zh-CN');assert.equal(i18n.format(message),raw);
  i18n.setLanguage('en');
  assert.equal(i18n.format(i18n.raw('● SXC-1 · 1.4.1')),'● SXC-1 · 1.4.1','Generic presentation templates cannot capture arbitrary device strings');
  assert.equal(i18n.format(i18n.raw('采样/连接 SXC-1.wav · 备份')),'采样/连接 SXC-1.wav · 备份','Unknown archive names stay literal');
});

test('explicit batch audio errors preserve colon-bearing filenames and raw ambiguous wrappers stay literal',()=>{
  const {i18n}=load({messages:catalog});
  const source='{path}：{error} 尚未开始本轮上传；可移除此文件后重试。';
  for(const path of ['连接已关闭：鼓.wav','子目录/连接已关闭：<b>鼓</b>.wav']){
    for(const [error,english] of [
      ['连接已关闭','Connection closed'],
      ['设备操作失败（13）','Device operation failed (13)'],
      ['DOMException: unknown port <b>未分类</b>','DOMException: unknown port <b>未分类</b>']
    ]){
      const message=i18n.msg(source,{path,error:i18n.raw(error)});
      const original=`${path}：${error} 尚未开始本轮上传；可移除此文件后重试。`;
      i18n.setLanguage('en');
      assert.equal(i18n.format(message),`${path}: ${english} This upload attempt has not started. Remove this file and try again.`);
      assert.equal(i18n.format(i18n.raw(original)),original,'A raw ambiguous wrapper must not split or reinterpret the filename');
      i18n.setLanguage('zh-CN');
      assert.equal(i18n.format(message),original);
      assert.equal(i18n.format(i18n.raw(original)),original);
    }
  }
});

test('live toggles update text, ARIA, metadata and html lang without replacing nodes',()=>{
  const document=new Document();
  const connect=document.body.appendChild(new Element('button',{'data-i18n':'连接 SXC-1'}));
  const preview=document.body.appendChild(new Element('button'));
  const filename=document.body.appendChild(new Element('span'));
  filename.textContent='连接 SXC-1.wav';
  const {i18n,calls}=load({document});
  const callback=()=>{};preview.addEventListener('click',callback);
  i18n.text(preview,i18n.msg('文件“{name}”无效',{name:'<b>鼓.wav</b>'}));
  i18n.attr(preview,'aria-label',i18n.msg('试听 Pad {pad}',{pad:'02'}));
  i18n.attr(preview,'title',i18n.msg('试听 Pad {pad}',{pad:'02'}));
  assert.equal(connect.textContent,'Connect SXC-1');
  assert.equal(preview.textContent,'Invalid file “<b>鼓.wav</b>”');
  assert.equal(preview.getAttribute('aria-label'),'Preview pad 02');
  assert.equal(document.title,'Sample manager');
  assert.equal(document.description.getAttribute('content'),'Local sample manager');
  assert.equal(document.documentElement.lang,'en');assert.equal(document.select.value,'en');
  i18n.setLanguage('zh-CN');
  assert.equal(connect.textContent,'连接 SXC-1');
  assert.equal(preview.textContent,'文件“<b>鼓.wav</b>”无效');
  assert.equal(preview.getAttribute('aria-label'),'试听 Pad 02');
  assert.equal(preview.getAttribute('title'),'试听 Pad 02');
  assert.equal(document.title,'采样管理器');
  assert.equal(document.description.getAttribute('content'),'本地采样管理器');
  assert.equal(document.documentElement.lang,'zh-CN');assert.equal(document.select.value,'zh-CN');
  document.select.value='en';document.select.dispatchEvent({type:'change'});
  assert.equal(i18n.getLanguage(),'en');assert.equal(preview.getAttribute('aria-label'),'Preview pad 02');
  assert.equal(document.body.children[2],preview,'Toggle preserves the existing button');
  assert.equal(preview.listeners.get('click')[0],callback,'Toggle preserves event handlers');
  assert.equal(filename.textContent,'连接 SXC-1.wav','Unbound user data is untouched');
  assert.equal(calls.device,0);assert.equal(calls.network,0);assert.equal(calls.reload,0);
});

test('apply can localize a subtree and subsequently refresh an explicit binding',()=>{
  const document=new Document(),{i18n}=load({document});
  const subtree=document.body.appendChild(new Element('section'));
  const label=subtree.appendChild(new Element('label',{'data-i18n':'连接 SXC-1','data-i18n-aria-label':'连接 SXC-1'}));
  i18n.apply(subtree);assert.equal(label.textContent,'Connect SXC-1');
  assert.equal(label.getAttribute('aria-label'),'Connect SXC-1');
  const transient=new Element('div');i18n.text(transient,i18n.msg('试听 Pad {pad}',{pad:4}));
  assert.equal(transient.textContent,'Preview pad 4');
  i18n.setLanguage('zh-CN');i18n.apply(transient);
  assert.equal(transient.textContent,'试听 Pad 4');
  assert.equal(label.textContent,'连接 SXC-1');
});

test('explicit dynamic text and ARIA bindings supersede static annotations across toggles',()=>{
  const document=new Document();
  const button=document.body.appendChild(new Element('button',{
    'data-i18n':'连接 SXC-1',
    'data-i18n-aria-label':'连接 SXC-1',
    'data-i18n-title':'连接 SXC-1'
  }));
  const {i18n}=load({document});
  assert.equal(button.textContent,'Connect SXC-1');
  i18n.text(button,i18n.msg('文件“{name}”无效',{name:'连接 SXC-1.wav'}));
  i18n.attr(button,'aria-label',i18n.msg('试听 Pad {pad}',{pad:'07'}));
  for(let index=0;index<10;index++){
    const english=index%2===0;i18n.setLanguage(english?'en':'zh-CN');i18n.apply(document);
    assert.equal(button.textContent,english?'Invalid file “连接 SXC-1.wav”':'文件“连接 SXC-1.wav”无效');
    assert.equal(button.getAttribute('aria-label'),english?'Preview pad 07':'试听 Pad 07');
    assert.equal(button.getAttribute('title'),english?'Connect SXC-1':'连接 SXC-1','An untouched static attribute continues to localize');
  }
});

test('header and all three dialog language selectors stay synchronized',()=>{
  const document=new Document();document.select.setAttribute('data-language-select','');
  const selectors=[document.select];
  for(let index=0;index<3;index++){
    const dialog=document.body.appendChild(new Element('dialog'));
    selectors.push(dialog.appendChild(new Element('select',{'data-language-select':''})));
  }
  const {i18n,calls}=load({document,saved:'zh-CN'});
  assert(selectors.every(select=>select.value==='zh-CN'));
  for(const select of selectors)assert.equal(select.listeners.get('change').length,1,'A selector is bound once even when found by both ID and attribute');
  for(let index=0;index<selectors.length;index++){
    const next=index%2?'zh-CN':'en';selectors[index].value=next;
    selectors[index].dispatchEvent({type:'change'});
    assert.equal(i18n.getLanguage(),next);
    assert(selectors.every(select=>select.value===next),'Changing a dialog selector updates all other selectors');
    assert.equal(document.documentElement.lang,next);
    assert.equal(document.title,next==='en'?'Sample manager':'采样管理器');
  }
  assert.equal(calls.device,0);assert.equal(calls.network,0);assert.equal(calls.reload,0);
});

test('localization never touches MIDI, USB, network or reload APIs',()=>{
  const document=new Document(),{i18n,calls}=load({document});
  const target=document.body.appendChild(new Element());
  for(let index=0;index<50;index++){
    i18n.text(target,i18n.msg('已读取 {done} / {total} 字节',{done:index,total:50}));
    i18n.setLanguage(index%2?'en':'zh-CN');i18n.apply(document);
  }
  assert.equal(calls.device,0);assert.equal(calls.network,0);assert.equal(calls.reload,0);
});

test('two generated single-file builds are byte-identical and contain the injected catalog',()=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'sxc-i18n-build-'));
  try{
    const outputs=[path.join(scratch,'one.html'),path.join(scratch,'two.html')];
    for(const output of outputs){
      const result=spawnSync('python3',['-B',path.join(__dirname,'build.py'),'--output',output],{encoding:'utf8',timeout:20000});
      assert.equal(result.status,0,`Build failed: ${result.stderr||result.error||result.stdout}`);
    }
    const first=fs.readFileSync(outputs[0]),second=fs.readFileSync(outputs[1]);assert.deepEqual(first,second);
    const html=first.toString('utf8');
    assert(!html.includes(marker),'English catalog marker was not substituted');
    assert(!html.includes('/*I18N*/'),'Localization engine was not inserted');
    assert(html.includes('SXCI18n'),'Generated page lacks the localization API');
    const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
    const generatedEngine=scripts.find(script=>script.includes("const marker=Symbol('sxc-message')"));
    assert(generatedEngine,'The generated page must contain the catalog-bearing engine');
    const context={navigator:{languages:['en-US']}};vm.createContext(context);
    new vm.Script(generatedEngine,{filename:'generated-i18n.js'}).runInContext(context);
    for(const [source,english] of Object.entries(catalog))assert.equal(context.SXCI18n.t(source),english);
  }finally{fs.rmSync(scratch,{recursive:true,force:true})}
});
