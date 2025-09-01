// ===== Utils =====
const log = (...a)=>{ try{ console.log('[game]',...a); }catch(_){} };
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// Elements
const loading = $('#loading');
const landing = $('#landing');
const popup = $('#popup');
const resultImg = $('#resultImg');
const actionBtnCt = $('#actionButton');
const boom1 = $('#boomSound1');
const boom2 = $('#boomSound2');
const win1  = $('#winSound1');
const win2  = $('#winSound2');
const bgm   = $('#bgMusic');
const players = $$('.player');

// ========== AUDIO ==========
function makePool(el, size=2){
  const src = el.currentSrc || el.src;
  const items = Array.from({length:size}, ()=>{ const a=new Audio(src); a.preload='none'; return a; });
  let i=0; return {
    play(){ const a=items[i++%items.length]; try{ a.currentTime=0; a.play(); }catch(e){ log('sfx play',e); } },
    setVolume(v){ items.forEach(a=>a.volume=v); }
  };
}
const sfx = {
  click:new Audio('./assets/button-click.mp3'),
  tap:new Audio('./assets/tap.mp3'),
  boomA:makePool(boom1,2),
  boomB:makePool(boom2,2),
  winA: makePool(win1,2),
  winB: makePool(win2,2),
};
function clickSfx(){ try{sfx.click.currentTime=0; sfx.click.play();}catch(e){} }
function tapSfx(){ try{sfx.tap.currentTime=0; sfx.tap.play();}catch(e){} }
function playBoom(){ sfx.boomA.play(); sfx.boomB.play(); }
function playWin(){  sfx.winA.play();  sfx.winB.play();  }

// ===== UI boot fast =====
function showUI(){ loading.style.display='none'; landing.classList.remove('hidden'); }
document.addEventListener('DOMContentLoaded', showUI);
setTimeout(()=>{ if(landing.classList.contains('hidden')) showUI(); }, 1500);

// ===== BGM (autoplay + fade + gesture fallback) =====
bgm.volume = 0;
function fadeTo(target=0.35, ms=700){
  const start=bgm.volume, diff=target-start, t0=performance.now();
  const step=t=>{ const p=Math.min(1,(t-t0)/ms); bgm.volume=start+diff*p; if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function startBgm(){ try{ await bgm.play(); fadeTo(0.35,800);}catch{} }
document.addEventListener('DOMContentLoaded', startBgm);
const tryUnlock = ()=>{ startBgm(); window.removeEventListener('pointerdown', tryUnlock); window.removeEventListener('keydown', tryUnlock); };
window.addEventListener('pointerdown', tryUnlock, {once:true, passive:true});
window.addEventListener('keydown', tryUnlock, {once:true});
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ try{bgm.pause();}catch{}} else if(bgm.paused){ startBgm(); }});

// ===== Lazy confetti =====
let confettiLoading=false;
function withConfetti(run){
  if(window.confetti) return run();
  if(confettiLoading){ const id=setInterval(()=>{ if(window.confetti){ clearInterval(id); run(); }},40); return; }
  confettiLoading=true;
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
  s.async=true; s.onload=run; document.head.appendChild(s);
}

// ===== Pixel (Meta) =====
function trackPurchase(value=2.00, currency='USD'){
  try{ if(typeof fbq==='function') fbq('track','Purchase',{value,currency}); }catch(_){}
  try{ if(typeof fbq==='function') fbq('trackCustom','ClaimClick'); }catch(_){}
}

// ===== Per-pixel hit test using the same GIF =====
const alphaMap = new Map(); // el -> {canvas,ctx,w,h}
function prepareAlpha(el){
  const src = el.dataset.img; if(!src) return;
  const img=new Image(); img.crossOrigin='anonymous'; img.src=src;
  img.onload=()=>{ el._alphaImg=img; renderAlpha(el); };
}
function renderAlpha(el){
  const img=el._alphaImg; if(!img) return;
  const r=el.getBoundingClientRect(), w=Math.max(1,Math.round(r.width)), h=Math.max(1,Math.round(r.height));
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h; const ctx=cvs.getContext('2d');
  const sx=w/img.naturalWidth, sy=h/img.naturalHeight, s=Math.min(sx,sy);
  const dw=Math.round(img.naturalWidth*s), dh=Math.round(img.naturalHeight*s);
  const dx=Math.round((w-dw)/2), dy=h-dh; // center X, bottom Y
  try{ ctx.drawImage(img,dx,dy,dw,dh); alphaMap.set(el,{canvas:cvs,ctx,w,h}); }catch(e){ alphaMap.delete(el); }
}
function isPixelHit(el, clientX, clientY){
  const data=alphaMap.get(el); if(!data) return true;
  const r=el.getBoundingClientRect(), x=Math.floor(clientX-r.left), y=Math.floor(clientY-r.top);
  if(x<0||y<0||x>=data.w||y>=data.h) return false;
  try{ return data.ctx.getImageData(x,y,1,1).data[3]>10; }catch{ return true; }
}
let resizeT; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>players.forEach(renderAlpha),120); });

// ===== State machine with AbortController per round =====
let round = 1;                  // 1 = lose on first round, 2 = win on second
let controller = null;          // AbortController for current round
let state = 'idle';             // 'idle' | 'spinning' | 'modal'

function enablePlayers(){
  players.forEach(p=>{ p.classList.add('zoom'); p.style.pointerEvents='auto'; });
}
function disablePlayers(){
  players.forEach(p=>{ p.classList.remove('zoom'); p.style.pointerEvents='none'; });
}
function hardResetSprites(){
  players.forEach(p=>{
    p.classList.remove('spin3d','impact','afterglow');
    p.style.backgroundImage=`url('${p.dataset.img}')`;
    p.style.transform='';
  });
}

function delay(ms, signal){
  return new Promise((res, rej)=>{
    const t=setTimeout(res, ms);
    if(signal) signal.addEventListener('abort', ()=>{ clearTimeout(t); rej('aborted'); }, {once:true});
  });
}
function waitAnim(el, name, signal){
  return new Promise((res, rej)=>{
    const onEnd=(e)=>{ if(e.animationName===name){ el.removeEventListener('animationend',onEnd); res(); } };
    el.addEventListener('animationend', onEnd);
    if(signal) signal.addEventListener('abort', ()=>{ el.removeEventListener('animationend',onEnd); rej('aborted'); }, {once:true});
  });
}

// Popup helpers (single owner, no overlap)
function showLose(signal){
  resultImg.src='./assets/popup-lose.webp';
  actionBtnCt.innerHTML=`<img id="try-again-btn" src="./assets/try-again-button.gif" alt="Try again">`;
  popup.classList.add('show');
  return new Promise((res, rej)=>{
    const btn=$('#try-again-btn');
    const onClick=()=>{ clickSfx(); popup.classList.remove('show'); res(); };
    btn?.addEventListener('click', onClick, {once:true});
    if(signal) signal.addEventListener('abort', ()=>{ btn?.removeEventListener('click', onClick); popup.classList.remove('show'); rej('aborted'); }, {once:true});
  });
}
function showWin(signal){
  resultImg.src='./assets/popup-win-2usd.webp';
  actionBtnCt.innerHTML=`
    <a id="claim-btn" href="https://t.me/FAFA558khwin" target="_blank" rel="noopener">
      <img src="./assets/claim-button.gif" alt="Claim">
    </a>`;
  popup.classList.add('show');
  const btn=$('#claim-btn');
  btn?.addEventListener('click', (ev)=>{
    ev.preventDefault();
    clickSfx();
    trackPurchase(2.00,'USD');
    const url=btn.href; setTimeout(()=>window.open(url,'_blank','noopener'),300);
  }, {once:true});
  return new Promise((res, rej)=>{
    // Resolve when popup is shown (we don't need to block game on claim)
    if(signal) signal.addEventListener('abort', ()=>{ popup.classList.remove('show'); rej('aborted'); }, {once:true});
    res();
  });
}

// Core round runner — EVERYTHING in one linear, abortable flow
async function runRound(p){
  // Cancel any previous round instantly
  controller?.abort();
  controller = new AbortController();
  const {signal} = controller;

  state = 'spinning';
  disablePlayers();

  // start spin
  p.classList.add('spin3d');
  await waitAnim(p, 'spinY360', signal); // only when spin ends
  p.classList.remove('spin3d');

  if (round === 1){
    // ===== LOSE ROUND =====
    p.style.backgroundImage = "url('./assets/sad.png')";
    playBoom();
    p.classList.add('impact','afterglow');

    // Wait for impact end (deterministic, no timers)
    await waitAnim(p, 'impactPop', signal).catch(()=>{});
    state = 'modal';
    await showLose(signal);             // blocks until Try Again
    p.classList.remove('afterglow');

    // Cleanup + prep next round
    hardResetSprites();
    round = 2;
    state = 'idle';
    enablePlayers();
    players.forEach(renderAlpha);

  } else {
    // ===== WIN ROUND =====
    p.style.backgroundImage = "url('./assets/star.gif')";
    playWin();
    p.classList.add('impact','afterglow');

    await waitAnim(p, 'impactPop', signal).catch(()=>{});
    state = 'modal';
    await showWin(signal);
    withConfetti(()=>{
      window.confetti({ particleCount: 80, spread: 360, startVelocity: 45, ticks: 90, origin: { y: 0.5 } });
      setTimeout(()=> window.confetti({ particleCount: 60, spread: 320, startVelocity: 35, ticks: 80, origin: { y: 0.4 } }), 900);
    });

    // (Optionally) lock game after win; or reset to round 1:
    // round = 1; hardResetSprites(); enablePlayers(); state='idle';
  }
}

// Init sprites + alpha maps
document.addEventListener('DOMContentLoaded', ()=>{
  players.forEach(p=>{
    p.style.backgroundImage = `url('${p.dataset.img}')`;
    p.style.pointerEvents='auto';
    p.classList.add('zoom');
    prepareAlpha(p);
  });
  enablePlayers();
  round = 1; state = 'idle';
});

// Eat events on overlay
['pointerdown','click','touchstart'].forEach(evt=>{
  popup.addEventListener(evt, e=> e.stopPropagation(), {passive:true});
});

// Player interaction — pointerdown only (mobile-safe)
players.forEach(p=>{
  p.addEventListener('pointerdown', (ev)=>{
    // Only on visible pixels of GIF
    if (!isPixelHit(p, ev.clientX, ev.clientY)) return;
    if (state !== 'idle') return;            // ignore if not ready
    ev.preventDefault();
    tapSfx();
    runRound(p).catch(err=> log('round aborted/err', err));
  }, {passive:false});
});
