// Minified scripts injected into preview iframes by workspace page.
// Do not edit inline — these are separate from the React component tree.

// ─── Inspect infrastructure ──────────────────────────────────────────────────

// Minified script injected into every preview iframe.
// Stays idle until it receives a { type: 'pf-inspect', on: true } postMessage.
export const PF_INSPECT_SCRIPT = `<script data-pf-injected>(function(){
var hl=null,sl=null,sty=document.createElement('style');sty.id='__pf_i';
(document.head||document.body).appendChild(sty);
var BLOCK_TAGS={section:1,article:1,main:1,header:1,footer:1,nav:1,aside:1,form:1,div:1,li:1,ul:1,ol:1,figure:1,blockquote:1};
var MEDIA_TAGS={img:1,picture:1,video:1,canvas:1,svg:1,figure:1};
function pfTb(){return document.getElementById('__pf_tb');}
function inTb(el){var t=pfTb();return !!(t&&el&&t.contains(el));}
function clip(v,max){v=String(v||'').trim();return v.length>max?v.slice(0,max):v;}
function cleanClasses(el){return Array.prototype.slice.call((el&&el.classList)||[]).filter(function(c){return c&&c.length<=60&&c!=='aos-init'&&c!=='aos-animate'&&!/^data-pf-/.test(c);}).slice(0,8);}
function hasBg(el){try{var bg=(window.getComputedStyle(el).backgroundImage||'');return !!(bg&&bg!=='none'&&bg.indexOf('url(')!==-1);}catch(x){return false;}}
function hasDirectMediaChild(el){if(!el||!el.querySelector)return false;try{return !!el.querySelector(':scope > img, :scope > picture, :scope > video, :scope > canvas, :scope > svg');}catch(x){return !!el.querySelector('img,picture,video,canvas,svg');}}
function isMediaTarget(el){if(!el||!el.tagName)return false;var tag=el.tagName.toLowerCase();return !!(MEDIA_TAGS[tag]||hasBg(el)||hasDirectMediaChild(el));}
function nodeId(el){if(!el||!el.tagName)return '';var pf=el.getAttribute('data-pf-id');if(pf)return clip('pf:'+pf,120);if(el.id)return clip('id:'+el.id,120);var p=[],c=el,d=0;while(c&&c.parentElement&&c!==document.body&&d<6){var par=c.parentElement,idx=Array.prototype.indexOf.call(par.children,c);p.unshift(c.tagName.toLowerCase()+':'+idx);c=par;d++;}return clip('body>'+p.join('>'),120);}
function selectorFor(el,cls){if(!el||!el.tagName)return '';var pf=el.getAttribute('data-pf-id');if(pf)return '[data-pf-id="'+clip(pf,80)+'"]';if(el.id)return '#'+clip(el.id,80);return clip(el.tagName.toLowerCase()+(cls.length?'.'+cls.slice(0,3).join('.'):''),240);}
function score(el,preferLow){if(!el||!el.tagName)return -999;var tag=el.tagName.toLowerCase();if(tag==='html'||tag==='body'||tag==='head'||tag==='script'||tag==='style'||tag==='meta'||tag==='link')return -999;var s=0;if(el.hasAttribute('data-pf-id'))s+=6;if(el.id)s+=5;if(BLOCK_TAGS[tag])s+=3;if(MEDIA_TAGS[tag])s+=8;if(hasBg(el))s+=7;if(hasDirectMediaChild(el))s+=4;if(preferLow&&MEDIA_TAGS[tag])s+=4;var html=el.outerHTML||'';if(html.length>8000)s-=8;else if(preferLow&&html.length>4000)s-=3;return s;}
function pickMediaTarget(start){if(!start||!start.tagName)return null;var cur=start,depth=0;while(cur&&cur.tagName&&depth<4){if(isMediaTarget(cur))return cur;cur=cur.parentElement;depth++;}return null;}
function pickTarget(start,preferBroad){if(!start||!start.tagName)return null;var preferLow=!preferBroad;var mediaBase=pickMediaTarget(start);var best=mediaBase||start,bestScore=score(best,preferLow),cur=best,depth=0;while(cur&&cur.parentElement&&cur!==document.body&&depth<4){cur=cur.parentElement;var sc=score(cur,preferLow);var canUse=preferLow?(isMediaTarget(cur)||cur.hasAttribute('data-pf-id')||cur.id):(cur.hasAttribute('data-pf-id')||cur.id);if(canUse&&sc>bestScore){if(preferLow&&(cur.outerHTML||'').length>6000){depth++;continue;}best=cur;bestScore=sc;}depth++;}return bestScore<-100?null:best;}
function mkdata(el,preferBroad){el=pickTarget(el,!!preferBroad);if(!el)return null;var cls=cleanClasses(el);var txt=clip(el.textContent||'',160);var oh=el.outerHTML||'';oh=oh.replace(/ data-pf-[hse](="")?/g,'');oh=oh.replace(/ style=""/g,'');oh=oh.replace(/ (aos-init|aos-animate)/g,'');oh=clip(oh,8000);var selector=selectorFor(el,cls);var stable=nodeId(el);var img=(el.tagName&&el.tagName.toLowerCase()==='img')?el:(el.querySelector?el.querySelector('img'):null);var src=img&&img.getAttribute?clip(img.getAttribute('src')||'',1500):'';var alt=img&&img.getAttribute?clip(img.getAttribute('alt')||'',300):'';var bg='',bgUrl='';try{bg=(window.getComputedStyle(el).backgroundImage||'');}catch(x){}var m=bg&&bg.match(/url\\((['"]?)(.*?)\\1\\)/);if(m&&m[2])bgUrl=clip(m[2],1500);var rectW=0,rectH=0;try{var rect=(img&&img.getBoundingClientRect?img.getBoundingClientRect():el.getBoundingClientRect());rectW=Math.round((rect&&rect.width)||0);rectH=Math.round((rect&&rect.height)||0);}catch(x){}var aspectRatio=rectW>0&&rectH>0?Math.round(rectW/rectH*1000)/1000:undefined;var mediaMode=src?'foreground':(bgUrl?'background':'none');if(!selector||!stable||/^<(html|body)\\b/i.test(oh))return null;return{stableNodeId:stable,selector:selector,tag:el.tagName.toLowerCase(),classes:cls,textSnippet:txt||undefined,outerHtml:oh||undefined,currentSrc:src||undefined,currentAlt:alt||undefined,backgroundImageUrl:bgUrl||undefined,mediaMode:mediaMode,originalWidth:rectW||undefined,originalHeight:rectH||undefined,aspectRatio:aspectRatio||undefined};}
function over(e){if(inTb(e.target))return;var target=pickTarget(e.target,e.altKey||e.shiftKey)||e.target;if(hl&&hl!==target)hl.removeAttribute('data-pf-h');hl=target;if(hl)hl.setAttribute('data-pf-h','');}
function clk(e){if(inTb(e.target))return;var preferBroad=!!(e.altKey||e.shiftKey);var target=pickTarget(e.target,preferBroad);var data=mkdata(target,preferBroad);if(!data||!target)return;e.preventDefault();e.stopPropagation();if(sl)sl.removeAttribute('data-pf-s');sl=target;if(sl)sl.setAttribute('data-pf-s','');try{window.parent.postMessage({type:'pf-select',element:data},'*');}catch(x){}}
function applyMedia(d){if(!d||!d.selector||!d.url)return;try{var el=document.querySelector(d.selector);if(!el)return;var opacity=(typeof d.opacity==='number'&&isFinite(d.opacity))?String(d.opacity):'';var filter=typeof d.filter==='string'&&d.filter?d.filter:'none';if(d.mode==='background'){el.style.backgroundImage='url("'+String(d.url).replace(/"/g,'%22')+'")';el.style.backgroundPosition='center center';el.style.backgroundSize=d.fit==='contain'?'contain':d.fit==='auto'?'auto':'cover';el.style.backgroundRepeat=d.repeat||'no-repeat';if(opacity)el.style.opacity=opacity;el.style.filter=filter;return;}var img=(el.tagName&&el.tagName.toLowerCase()==='img')?el:(el.querySelector?el.querySelector('img'):null);if(img&&img.tagName==='IMG'){var preserveWidth=(typeof d.preserveWidth==='number'&&isFinite(d.preserveWidth)&&d.preserveWidth>0)?Math.round(d.preserveWidth):0;var preserveHeight=(typeof d.preserveHeight==='number'&&isFinite(d.preserveHeight)&&d.preserveHeight>0)?Math.round(d.preserveHeight):0;var aspectRatio=(typeof d.aspectRatio==='number'&&isFinite(d.aspectRatio)&&d.aspectRatio>0)?d.aspectRatio:0;img.src=String(d.url);if(typeof d.alt==='string')img.alt=d.alt;if(opacity)img.style.opacity=opacity;img.style.filter=filter;img.style.objectFit=d.fit==='contain'?'contain':'cover';img.style.maxWidth=img.style.maxWidth||'100%';img.style.display=img.style.display||'block';if(!img.getAttribute('width')&&!img.style.width&&preserveWidth)img.style.width=preserveWidth+'px';if(!img.getAttribute('height')&&!img.style.height&&preserveHeight)img.style.height=preserveHeight+'px';if(aspectRatio&&!img.style.aspectRatio)img.style.aspectRatio=String(aspectRatio);}}catch(x){}}
function on(){sty.textContent='[data-pf-h]{outline:2px solid rgba(99,102,241,.6)!important;cursor:crosshair!important}[data-pf-s]{outline:2px solid #6366f1!important;outline-offset:2px!important}';document.addEventListener('mouseover',over);document.addEventListener('click',clk,true);}
function off(){sty.textContent='';document.removeEventListener('mouseover',over);document.removeEventListener('click',clk,true);if(hl){hl.removeAttribute('data-pf-h');hl=null;}if(sl){sl.removeAttribute('data-pf-s');sl=null;}}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='pf-inspect'){if(e.data.on)on();else off();}if(e.data&&e.data.type==='pf-apply-media'){applyMedia(e.data);}});
})();<\/script>`;

/**
 * EDIT Light script — injected alongside PF_INSPECT_SCRIPT when editMode is active.
 *
 * Text elements become contentEditable on click (with a dashed teal outline).
 * Images respond to click by sending pf-edit-img-click to the parent.
 * A floating toolbar appears on text selection with formatting tools (Canva-style).
 *
 * Messages received from parent:
 *   { type: 'pf-edit', on: bool }         — arm / disarm the script
 *   { type: 'pf-edit-trigger-save' }       — serialise DOM, send pf-edit-save to parent
 *   { type: 'pf-edit-set-img-src', selector, newSrc } — update an img src
 *   { type: 'pf-edit-scroll-to', selector }           — scroll to element + highlight
 *   { type: 'pf-edit-scan-media' }                    — re-scan media assets and send list
 */
export const PF_EDIT_SCRIPT = `<script data-pf-injected>(function(){
var editOn=false,eds=new Set();
var TEXT_TAGS=['P','H1','H2','H3','H4','H5','H6','SPAN','LI','TD','TH','BUTTON','A','LABEL','STRONG','EM','B','I','U','BLOCKQUOTE','FIGCAPTION','CAPTION','DT','DD'];

/* ── Toolbar UI — Canva-style floating bar ── */
var tb=document.createElement('div');
tb.id='__pf_tb';
tb.style.cssText='position:fixed;z-index:999999;display:none;align-items:center;gap:2px;padding:4px 6px;'+
  'background:#1e1e2e;border:1px solid #383850;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.45);'+
  'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;user-select:none;';
var BTNS=[
  {cmd:'bold',      icon:'B',  tip:'Grassetto',s:'font-weight:800'},
  {cmd:'italic',    icon:'I',  tip:'Corsivo',  s:'font-style:italic'},
  {cmd:'underline', icon:'U',  tip:'Sottolineato',s:'text-decoration:underline'},
  {cmd:'strikethrough',icon:'S',tip:'Barrato',s:'text-decoration:line-through'},
  {sep:true},
  {cmd:'formatBlock',arg:'H1',icon:'H1',tip:'Titolo 1',s:'font-weight:700;font-size:13px'},
  {cmd:'formatBlock',arg:'H2',icon:'H2',tip:'Titolo 2',s:'font-weight:700;font-size:12px'},
  {cmd:'formatBlock',arg:'H3',icon:'H3',tip:'Titolo 3',s:'font-weight:600;font-size:11px'},
  {cmd:'formatBlock',arg:'P', icon:'¶', tip:'Paragrafo'},
  {sep:true},
  {cmd:'justifyLeft',  icon:'\u2261',tip:'Allinea a sinistra'},
  {cmd:'justifyCenter',icon:'\u2263',tip:'Centra'},
  {cmd:'justifyRight', icon:'\u2262',tip:'Allinea a destra'},
  {sep:true},
  {cmd:'insertUnorderedList',icon:'\u2022',tip:'Elenco puntato'},
  {cmd:'insertOrderedList', icon:'1.',tip:'Elenco numerato'},
  {sep:true},
  {cmd:'createLink',icon:'\uD83D\uDD17',tip:'Inserisci link'},
  {cmd:'removeFormat',icon:'\u2718',tip:'Rimuovi formattazione'}
];
BTNS.forEach(function(b){
  if(b.sep){
    var sp=document.createElement('span');
    sp.style.cssText='width:1px;height:18px;background:#484860;margin:0 3px;flex-shrink:0;';
    tb.appendChild(sp);return;
  }
  var btn=document.createElement('button');
  btn.type='button';
  btn.title=b.tip||'';
  btn.textContent=b.icon;
  btn.style.cssText='all:unset;display:inline-flex;align-items:center;justify-content:center;'+
    'width:28px;height:28px;border-radius:6px;color:#cdd6f4;cursor:pointer;font-size:12px;'+
    'transition:background .12s;'+(b.s||'');
  btn.addEventListener('mouseenter',function(){this.style.background='#45475a';});
  btn.addEventListener('mouseleave',function(){this.style.background='transparent';});
  btn.addEventListener('mousedown',function(ev){
    ev.preventDefault();ev.stopPropagation();
    var c=b.cmd;
    if(c==='createLink'){
      var url=prompt('URL del link:','https://');
      if(url)document.execCommand('createLink',false,url);
    }else if(c==='formatBlock'){
      document.execCommand('formatBlock',false,'<'+b.arg+'>');
    }else{
      document.execCommand(c,false,null);
    }
    updateActive();
  });
  btn.__pfCmd=b.cmd;
  btn.__pfArg=b.arg||null;
  tb.appendChild(btn);
});
document.body.appendChild(tb);

function updateActive(){
  var btns=tb.querySelectorAll('button');
  btns.forEach(function(btn){
    var c=btn.__pfCmd;if(!c)return;
    var on=false;
    try{
      if(c==='bold'||c==='italic'||c==='underline'||c==='strikethrough'||
         c==='insertUnorderedList'||c==='insertOrderedList'||
         c==='justifyLeft'||c==='justifyCenter'||c==='justifyRight'){
        on=document.queryCommandState(c);
      }else if(c==='formatBlock'&&btn.__pfArg){
        var v=document.queryCommandValue('formatBlock')||'';
        on=v.toLowerCase()===btn.__pfArg.toLowerCase();
      }
    }catch(x){}
    btn.style.background=on?'#585b70':'transparent';
    btn.style.color=on?'#cba6f7':'#cdd6f4';
  });
}

var tbVisible=false;
var activeEditEl=null;
function showTb(anchorRect){
  if(!anchorRect){
    var sel=window.getSelection();
    if(sel&&!sel.isCollapsed&&sel.rangeCount){
      anchorRect=sel.getRangeAt(0).getBoundingClientRect();
    }else if(activeEditEl){
      anchorRect=activeEditEl.getBoundingClientRect();
    }
  }
  if(!anchorRect||!anchorRect.width){hideTb();return;}
  tb.style.display='flex';
  tbVisible=true;
  var tbW=tb.offsetWidth,tbH=tb.offsetHeight;
  var x=anchorRect.left+(anchorRect.width-tbW)/2;
  var y=anchorRect.bottom+8;
  if(x<4)x=4; if(x+tbW>window.innerWidth-4)x=window.innerWidth-tbW-4;
  if(y+tbH>window.innerHeight-4)y=anchorRect.top-tbH-8;
  tb.style.left=x+'px';tb.style.top=y+'px';
  updateActive();
}
function hideTb(){tb.style.display='none';tbVisible=false;activeEditEl=null;}

/* ── Core edit logic ── */
function enableEl(el){if(el.__pfE)return;el.__pfE=true;el.contentEditable='true';
  el.style.outline='2px dashed rgba(34,211,238,0.6)';el.style.outlineOffset='1px';eds.add(el);}
function disableAll(){eds.forEach(function(el){el.contentEditable='false';
  el.style.outline='';el.style.outlineOffset='';el.__pfE=false;});eds.clear();hideTb();}
function cleanClasses(el){return Array.prototype.slice.call((el&&el.classList)||[]).filter(function(c){return c&&c.length<=60&&!/^data-pf-/.test(c);}).slice(0,8);}
function nodeId(el){if(!el||!el.tagName)return '';var pf=el.getAttribute('data-pf-id');if(pf)return ('pf:'+pf).slice(0,120);if(el.id)return ('id:'+el.id).slice(0,120);var p=[],c=el,d=0;while(c&&c.parentElement&&c!==document.body&&d<6){var par=c.parentElement,idx=Array.prototype.indexOf.call(par.children,c);p.unshift(c.tagName.toLowerCase()+':'+idx);c=par;d++;}return ('body>'+p.join('>')).slice(0,120);}
function selectorFor(el,cls){if(!el||!el.tagName)return '';var pf=el.getAttribute('data-pf-id');if(pf)return '[data-pf-id="'+String(pf).slice(0,80)+'"]';if(el.id)return '#'+String(el.id).slice(0,80);return (el.tagName.toLowerCase()+(cls.length?'.'+cls.slice(0,3).join('.'):'' )).slice(0,240);}
function hasBgEdit(el){try{var bg=(window.getComputedStyle(el).backgroundImage||'');return !!(bg&&bg!=='none'&&bg.indexOf('url(')!==-1);}catch(x){return false;}}
function pickMediaEl(start){var cur=start,depth=0;while(cur&&cur.tagName&&depth<4){var tag=cur.tagName.toLowerCase();if(tag==='img'||tag==='picture'||tag==='figure'||tag==='video'||tag==='canvas'||tag==='svg'||hasBgEdit(cur))return cur;cur=cur.parentElement;depth++;}return null;}
function mkMediaData(el){var target=pickMediaEl(el)||el;if(!target||!target.tagName)return null;var cls=cleanClasses(target);var oh=target.outerHTML||'';oh=oh.replace(/ data-pf-[hse](="")?/g,'');oh=oh.replace(/ style=""/g,'');oh=oh.slice(0,8000);var selector=selectorFor(target,cls);var stable=nodeId(target);var img=(target.tagName&&target.tagName.toLowerCase()==='img')?target:(target.querySelector?target.querySelector('img'):null);var src=img&&img.getAttribute?String(img.getAttribute('src')||'').slice(0,1500):'';var alt=img&&img.getAttribute?String(img.getAttribute('alt')||'').slice(0,300):'';var bg='',bgUrl='';try{bg=(window.getComputedStyle(target).backgroundImage||'');}catch(x){}var m=bg&&bg.match(/url\\((['"]?)(.*?)\\1\\)/);if(m&&m[2])bgUrl=String(m[2]).slice(0,1500);var rectW=0,rectH=0;try{var rect=(img&&img.getBoundingClientRect?img.getBoundingClientRect():target.getBoundingClientRect());rectW=Math.round((rect&&rect.width)||0);rectH=Math.round((rect&&rect.height)||0);}catch(x){}var aspectRatio=rectW>0&&rectH>0?Math.round(rectW/rectH*1000)/1000:undefined;var text=((target.textContent||'').trim()).slice(0,160);var mediaMode=src?'foreground':(bgUrl?'background':'none');if(!selector||!stable)return null;return{stableNodeId:stable,selector:selector,tag:target.tagName.toLowerCase(),classes:cls,textSnippet:text||undefined,outerHtml:oh||undefined,currentSrc:src||undefined,currentAlt:alt||undefined,backgroundImageUrl:bgUrl||undefined,mediaMode:mediaMode,originalWidth:rectW||undefined,originalHeight:rectH||undefined,aspectRatio:aspectRatio||undefined};}
function cleanHtml(){var cl=document.documentElement.cloneNode(true);
  cl.querySelectorAll('#__pf_tb,[data-pf-injected],style#__pf_i').forEach(function(e){e.remove();});
  cl.querySelectorAll('[contenteditable]').forEach(function(e){e.removeAttribute('contenteditable');
  e.style.outline='';e.style.outlineOffset='';});
  cl.querySelectorAll('[data-pf-h],[data-pf-s],[data-pf-e]').forEach(function(e){
  e.removeAttribute('data-pf-h');e.removeAttribute('data-pf-s');e.removeAttribute('data-pf-e');});
  return '<!doctype html>'+cl.outerHTML;}
function onClick(e){if(!editOn)return;
  if(tb.contains(e.target))return;
  var el=e.target;
  if(TEXT_TAGS.includes(el.tagName)){enableEl(el);activeEditEl=el;showTb(el.getBoundingClientRect());return;}
  if(!el.children.length&&(el.textContent||'').trim()&&el.tagName!=='SCRIPT'&&el.tagName!=='STYLE'){enableEl(el);activeEditEl=el;showTb(el.getBoundingClientRect());return;}
  var mediaData=mkMediaData(el);
  if(mediaData&&(mediaData.currentSrc||mediaData.backgroundImageUrl||mediaData.tag==='img'||mediaData.tag==='picture'||mediaData.tag==='figure')){e.preventDefault();e.stopPropagation();hideTb();try{window.parent.postMessage({type:'pf-edit-img-click',element:mediaData},'*');}catch(x){}return;}}
document.addEventListener('mouseup',function(){
  if(!editOn)return;setTimeout(function(){showTb();},10);
});
document.addEventListener('keyup',function(e){
  if(!editOn)return;
  if(e.key==='Shift'||e.key.startsWith('Arrow'))setTimeout(showTb,10);
  else if(tbVisible)updateActive();
});
document.addEventListener('mousedown',function(e){
  if(!editOn)return;
  if(!tb.contains(e.target))hideTb();
});
/* ── Media asset scanning — sends thumbnail list to parent ── */
var _scanTimer=null;
function scanMedia(){
  if(_scanTimer)clearTimeout(_scanTimer);
  _scanTimer=setTimeout(function(){_scanTimer=null;_doScan();},200);
}
/* Ensure element has a data-pf-id; assign one on the fly if missing */
function ensurePfId(el){
  if(!el||!el.tagName)return;
  if(!el.getAttribute('data-pf-id')){
    el.setAttribute('data-pf-id','pf-'+Math.random().toString(36).slice(2,8));
  }
}
function _doScan(){
  function safeMediaSrc(raw){
    var value=String(raw||'').trim();
    if(!value)return '';
    /* Generated/project assets are often data: URLs; truncating them breaks the thumbnail. */
    if(/^data:|^blob:/i.test(value))return value;
    return value.slice(0,1500);
  }
  var items=[];var seen=new Set();
  /* foreground images */
  document.querySelectorAll('img').forEach(function(img){
    if(!img.src||img.closest('#__pf_tb,[data-pf-injected]'))return;
    var src=safeMediaSrc(img.src);if(!src||seen.has(src))return;seen.add(src);
    ensurePfId(img);
    var cls=cleanClasses(img);var sel=selectorFor(img,cls);var stable=nodeId(img);
    if(!sel||!stable)return;
    var alt=String(img.getAttribute('alt')||'').slice(0,200);
    var r=img.getBoundingClientRect();
    items.push({selector:sel,stableNodeId:stable,tag:'img',src:src,alt:alt,
      mediaMode:'foreground',w:Math.round(r.width),h:Math.round(r.height)});
  });
  /* background images */
  document.querySelectorAll('*').forEach(function(el){
    if(el.closest('#__pf_tb,[data-pf-injected]'))return;
    if(!hasBgEdit(el))return;
    var bg=window.getComputedStyle(el).backgroundImage||'';
    var m=bg.match(/url\\((['"]?)(.*?)\\1\\)/);if(!m||!m[2])return;
    var bgUrl=safeMediaSrc(m[2]);if(!bgUrl||seen.has(bgUrl))return;seen.add(bgUrl);
    ensurePfId(el);
    var cls=cleanClasses(el);var sel=selectorFor(el,cls);var stable=nodeId(el);
    if(!sel||!stable)return;
    var r=el.getBoundingClientRect();
    items.push({selector:sel,stableNodeId:stable,tag:el.tagName.toLowerCase(),src:bgUrl,alt:'',
      mediaMode:'background',w:Math.round(r.width),h:Math.round(r.height)});
  });
  try{window.parent.postMessage({type:'pf-edit-media-list',items:items},'*');}catch(x){}
}
/* highlight + scroll-to for sidebar selection */
var _hlEl=null;
function scrollToSel(selector){
  try{
    if(_hlEl){_hlEl.style.outline='';_hlEl.style.outlineOffset='';_hlEl=null;}
    var el=document.querySelector(selector);
    /* Fallback: if selector failed, try finding by data-pf-id extracted from the selector string */
    if(!el){
      var pfMatch=selector.match(/data-pf-id=["']([^"']+)["']/);
      if(pfMatch&&pfMatch[1]){
        el=document.querySelector('[data-pf-id="'+pfMatch[1]+'"]');
      }
    }
    if(!el){console.warn('[pf-edit] scrollToSel: element not found for',selector);return;}
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.style.outline='3px solid rgba(99,102,241,0.8)';el.style.outlineOffset='3px';
    _hlEl=el;
    setTimeout(function(){if(_hlEl===el){el.style.outline='';el.style.outlineOffset='';_hlEl=null;}},2500);
    var md=mkMediaData(el);
    if(md)try{window.parent.postMessage({type:'pf-edit-img-click',element:md},'*');}catch(x){}
  }catch(x){console.warn('[pf-edit] scrollToSel error',x);}
}
/* observe DOM mutations to rescan */
var _obs=null;
function startObs(){if(_obs)_obs.disconnect();_obs=new MutationObserver(function(){if(editOn)scanMedia();});
  _obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','style']});}
window.addEventListener('message',function(e){if(!e.data||typeof e.data!=='object')return;
  if(e.data.type==='pf-edit'){editOn=e.data.on;if(!editOn){disableAll();if(_obs)_obs.disconnect();}else{scanMedia();startObs();}}
  if(e.data.type==='pf-edit-trigger-save'){try{window.parent.postMessage({type:'pf-edit-save',html:cleanHtml()},'*');}catch(x){}}
  if(e.data.type==='pf-edit-set-img-src'){try{var img=document.querySelector(e.data.selector);
  if(img&&img.tagName==='IMG')img.src=e.data.newSrc;}catch(x){}}
  if(e.data.type==='pf-edit-scroll-to'){scrollToSel(e.data.selector||e.data.pfId&&'[data-pf-id=\"'+e.data.pfId+'\"]'||'');}
  if(e.data.type==='pf-edit-scan-media'){scanMedia();}});
document.addEventListener('click',onClick,true);
})();<` + `/script>`;
