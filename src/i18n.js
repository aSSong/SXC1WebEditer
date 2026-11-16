'use strict';
// Source messages remain Chinese. The build embeds the English catalog here.
(function(root){
  const english=/*EN_MESSAGES*/{};
  const marker=Symbol('sxc-message'),bindings=new WeakMap();
  const nested=new Set(['error','progress','reason','detail']);
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function detectLanguage(languages,stored){
    if(stored==='en'||stored==='zh-CN')return stored;
    const first=Array.isArray(languages)?languages[0]:languages;
    return typeof first==='string'&&/^zh(?:-|$)/i.test(first)?'zh-CN':'en';
  }
  let saved;try{saved=root.localStorage?.getItem('sxc-language')}catch{}
  let language=detectLanguage(root.navigator?.languages||[root.navigator?.language],saved);
  // Generic UI templates use explicit descriptors. Only recognize raw messages
  // from the unchanged device modules, plus their specific batch-progress wrapper.
  const batchPattern='{completed}/{total} · {target} · {progress}';
  // Paths can contain the same colon as this error wrapper. The batch UI binds
  // its known path and error separately instead of guessing that boundary.
  const batchAudioError='{path}：{error} 尚未开始本轮上传；可移除此文件后重试。';
  const patterns=Object.keys(english).filter(source=>source!==batchAudioError&&/\{[a-zA-Z]\w*\}/.test(source)&&(/[\u3400-\u9fff]/.test(source)||source===batchPattern)).map(source=>{
    const names=[];let last=0,pattern='^',match;
    const token=/\{([a-zA-Z]\w*)\}/g;
    while((match=token.exec(source))){
      let capture='[\\s\\S]*?';
      if(source===batchPattern)capture=match[1]==='target'?'Bank \\d{2} / Pad \\d{2}':match[1]==='progress'?capture:'\\d+';
      pattern+=escape(source.slice(last,match.index))+'('+capture+')';names.push(match[1]);last=token.lastIndex;
    }
    pattern+=escape(source.slice(last))+'$';
    return {source,names,regex:new RegExp(pattern),specificity:source.replace(token,'').length};
  }).sort((a,b)=>b.specificity-a.specificity||a.names.length-b.names.length);
  function msg(source,params={}){return Object.freeze({[marker]:true,source:String(source),params:Object.freeze({...params})})}
  function raw(value,depth=0){
    if(value&&value[marker])return value;
    const source=String(value??'');
    if(own(english,source))return msg(source);
    if(depth<8)for(const entry of patterns){
      const match=entry.regex.exec(source);if(!match)continue;
      const params={};entry.names.forEach((name,i)=>{params[name]=nested.has(name)?raw(match[i+1],depth+1):match[i+1]});
      return msg(entry.source,params);
    }
    return msg(source);
  }
  function format(value){
    if(!value||!value[marker])return String(value??'');
    const template=language==='en'&&own(english,value.source)?english[value.source]:value.source;
    return template.replace(/\{([a-zA-Z]\w*)\}/g,(token,name)=>own(value.params,name)?format(value.params[name]):token);
  }
  const t=(source,params)=>format(msg(source,params));
  function languageSelects(){
    const document=root.document;if(!document)return [];
    return [...new Set([document.getElementById('language'),...document.querySelectorAll('[data-language-select]')].filter(Boolean))];
  }
  function remember(element){
    let binding=bindings.get(element);
    if(!binding){binding={attributes:new Map()};bindings.set(element,binding);element.setAttribute('data-i18n-bound','')}
    return binding;
  }
  function text(element,value,params){
    const message=params===undefined?raw(value):msg(value,params);
    remember(element).text=message;element.textContent=format(message);return element;
  }
  function attr(element,name,value,params){
    const message=params===undefined?raw(value):msg(value,params);
    remember(element).attributes.set(name,message);element.setAttribute(name,format(message));return element;
  }
  function apply(scope=root.document){
    if(!scope?.querySelectorAll)return;
    const elements=[...(scope.matches?.('[data-i18n],[data-i18n-bound],[data-i18n-aria-label],[data-i18n-title],[data-i18n-content]')?[scope]:[]),...scope.querySelectorAll('[data-i18n],[data-i18n-bound],[data-i18n-aria-label],[data-i18n-title],[data-i18n-content]')];
    for(const element of elements){
      const existing=bindings.get(element);
      if(element.hasAttribute('data-i18n')&&!existing?.text)text(element,element.getAttribute('data-i18n'));
      for(const name of ['aria-label','title','content'])if(element.hasAttribute('data-i18n-'+name)&&!existing?.attributes.has(name))attr(element,name,element.getAttribute('data-i18n-'+name));
      const binding=bindings.get(element);if(!binding)continue;
      if(binding.text)element.textContent=format(binding.text);
      for(const [name,message] of binding.attributes)element.setAttribute(name,format(message));
    }
    if(root.document){root.document.documentElement.lang=language;for(const select of languageSelects())select.value=language}
  }
  function setLanguage(next){
    if(next!=='en'&&next!=='zh-CN')throw new RangeError('Unsupported language');
    language=next;try{root.localStorage?.setItem('sxc-language',language)}catch{}
    apply();
  }
  root.SXCI18n=Object.freeze({msg,t,raw,format,text,attr,apply,setLanguage,getLanguage:()=>language,detectLanguage});
  if(root.document){apply();for(const select of languageSelects())select.addEventListener('change',()=>setLanguage(select.value))}
})(globalThis);
