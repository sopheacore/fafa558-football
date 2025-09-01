// ===== Small helpers =====
const log = (...a)=>{ try{ console.log('[game]',...a); }catch(_){} };
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ===== Elements =====
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

// ===== Audio pools =====
function makePool(el, size=2){
  const src = el.currentSrc || el.src;
  const items = Array.from({length:size}, ()=> { const a=new Audio(src); a.preload='none'; return a; });
  let i=0;
  return {
    play(){ const a=items[i++%items.length]; try{ a.currentTime=0; a.play(); }catch(e){ log('sfx play', e); } },
    setVolume(v){ items.forEach(a=> a.volume=v); }
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
function clickSfx(){ try{sfx.click.currentTime=0; sfx.click.play();}catch{} }
function tapSfx(){   try{sfx.tap.currentTime=0;   sfx.tap.play();}catch{} }
function playBoom(){ sfx.boomA.play(); sfx.boomB.play(); }
function playWin(){  sfx.winA.play();  sfx.winB.play();  }

// ===== Fast boot =====
function showUI(){ loading.style.display='none'; landing.classList.remove('hidden'); }
document.addEventListener('DOMContentLoaded', showUI);
setTimeout(()=>{ if(landing.classList.contains('hidden')) showUI(); }, 1500);

// ===== BGM =====
bgm.volume = 0;
function fadeTo(target=0.35, ms=700){
  const start=bgm.volume, diff=target-start, t0=performance.now();
  const step=t=>{ const p=Math.min(1,(t-t0)/ms); bgm.volume=start+diff*p; if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function startBgm(){ try{ await bgm.play(); fadeTo(0.35,800); }catch{} }
document.addEventListener('DOMContentLoaded', startBgm);
const tryUnlock=()=>{ startBgm(); window.removeEventListener('pointerdown',tryUnlock); window.removeEventListener('keydown',tryUnlock); };
window.addEventListener('pointerdown', tryUnlock, {once:true, passive:true});
window.addEventListener('keydown', tryUnlock, {once:true});
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ try{bgm.pause();}catch{}} else if(bgm.paused){ startBgm(); } });

// ===== Lazy confetti =====
let confettiLoading=false;
function withConfetti(run){
  if(window.confetti) return run();
  if(confettiLoading){ const id=setInterval(()=>{ if(window.confetti){ clearInterval(id); run(); }}, 40); return; }
  confettiLoading=true;
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
  s.async=true; s.onload=run; document.head.appendChild(s);
}

// ===== Pixel / Meta =====
function trackPurchase(value=2.00,currency='USD'){
  try{ if(typeof fbq==='function') fbq('track','Purchase',{value,currency}); }catch(_){}
  try{ if(typeof fbq==='function') fbq('trackCustom','ClaimClick'); }catch(_){}
}

// ===== Per-pixel hit using the same GIF =====
const alphaMap = new Map(); // el -> {canvas,ctx,w,h}
function prepareAlpha(el){
  const src = el.dataset.img; if(!src) return;
  const img = new Image();
  img.crossOrigin='anonymous'; // harmless same-origin; needed if CDN allows CORS
  img.src = src;
  img.onload = ()=>{ el._alphaImg=img; renderAlpha(el); };
  img.onerror = ()=>{ log('alpha image failed', src); };
}
function renderAlpha(el){
  const img = el._alphaImg; if(!img) return;
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  const cvs = document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const ctx = cvs.getContext('2d');
  // match CSS background: contain; center-bottom
  const sx=w/img.naturalWidth, sy=h/img.naturalHeight, s=Math.min(sx,sy);
  const dw=Math.round(img.naturalWidth*s), dh=Math.round(img.naturalHeight*s);
  const dx=Math.round((w-dw)/2), dy=h-dh;
  try{
    ctx.clearRect(0,0,w,h);
    ctx.drawImage(img, dx, dy, dw, dh);
    alphaMap.set(el,{canvas:cvs,ctx,w,h});
  }catch(e){
    // tainted canvas (no CORS) -> fallback to rectangular hit
    alphaMap.delete(el);
  }
}
function isPixelHit(el, clientX, clientY){
  const data=alphaMap.get(el); if(!data) return true;
  const r=el.getBoundingClientRect();
  const x=Math.floor(clientX-r.left), y=Math.floor(clientY-r.top);
  if(x<0||y<0||x>=data.w||y>=data.h) return false;
  try{ return data.ctx.getImageData(x,y,1,1).data[3] > 10; }catch{ return true; }
}
let resizeT; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>players.forEach(renderAlpha),120); });

// ===== Round / Popup state =====
let round = 1;                 // 1 = lose on first, 2 = win on second
let phase = 'idle';            // 'idle' | 'spinning' | 'popup'
let controller = null;         // AbortController for current round

function enablePlayers(){ players.forEach(p=>{ p.classList.add('zoom'); p.style.pointerEvents='auto'; }); }
function disablePlayers(){ players.forEach(p=>{ p.classList.remove('zoom'); p.style.pointerEvents='none'; }); }
function hardResetSprites(){
  players.forEach(p=>{
    p.classList.remove('spin3d','impact','afterglow');
    p.style.backgroundImage=`url('${p.dataset.img}')`;
    p.style.transform='';
  });
}

// ======= NEW: Auto-kill any stray LOSE popup during round 2 =======
function killLosePopupIfRound2(){
  if (round === 2 && /popup-lose/i.test(resultImg.src)) {
    popup.classList.remove('show');
    actionBtnCt.innerHTML = '';
  }
}
// Reactive watcher: if *anything* shows the popup-lose during round 2, hide it instantly.
(function setupPopupAutoKiller(){
  const obs = new MutationObserver(()=>{
    if (popup.classList.contains('show')) {
      killLosePopupIfRound2();
    }
  });
  obs.observe(popup, { attributes:true, attributeFilter:['class'] });
})();

// ===== Async utilities =====
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

// ===== Popup helpers =====
function showLose(signal){
  // If we've already advanced to round 2, immediately no-op & ensure hidden.
  if (round !== 1){ killLosePopupIfRound2(); return Promise.resolve(); }
  resultImg.src='./assets/popup-lose.webp';
  actionBtnCt.innerHTML=`<img id="try-again-btn" src="./assets/try-again-button.gif" alt="Try again">`;
  popup.classList.add('show');
  // Also ensure auto-kill still applies if round flips mid-frame
  killLosePopupIfRound2();

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

  // If any stale lose popup tries to appear, nuke it.
  killLosePopupIfRound2();

  // resolve immediately; we don't wait for claim to close
  return Promise.resolve();
}

// ===== Round runner =====
async function runRound(p){
  controller?.abort();
  controller = new AbortController();
  const {signal} = controller;

  // proactively remove any stray lose popup if we are already on round 2
  killLosePopupIfRound2();

  phase = 'spinning';
  disablePlayers();

  p.classList.add('spin3d');
  await waitAnim(p, 'spinY360', signal).catch(()=>{});
  p.classList.remove('spin3d');

  if (round === 1){
    // --- LOSE ---
    p.style.backgroundImage = "url('./assets/sad.png')";
    playBoom();
    p.classList.add('impact','afterglow');

    await waitAnim(p, 'impactPop', signal).catch(()=>{});
    phase = 'popup';
    await showLose(signal).catch(()=>{});

    p.classList.remove('afterglow');
    hardResetSprites();
    round = 2;                    // next click is WIN
    phase = 'idle';
    enablePlayers();
    players.forEach(renderAlpha);

  } else {
    // --- WIN ---
    p.style.backgroundImage = "url('./assets/star.gif')";
    playWin();
    p.classList.add('impact','afterglow');

    await waitAnim(p, 'impactPop', signal).catch(()=>{});
    phase = 'popup';
    await showWin(signal).catch(()=>{});

    withConfetti(()=>{
      window.confetti({ particleCount: 80, spread: 360, startVelocity: 45, ticks: 90, origin: { y: 0.5 } });
      setTimeout(()=> window.confetti({ particleCount: 60, spread: 320, startVelocity: 35, ticks: 80, origin: { y: 0.4 } }), 900);
    });

    // (optional) lock game after win, or reset if you prefer
    // round = 1; hardResetSprites(); enablePlayers(); phase = 'idle';
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', ()=>{
  players.forEach(p=>{
    p.style.backgroundImage = `url('${p.dataset.img}')`;
    p.style.pointerEvents='auto';
    p.classList.add('zoom');
    prepareAlpha(p);
  });
  enablePlayers();
  round = 1;
  phase = 'idle';
});

// Eat taps on popup
['pointerdown','click','touchstart'].forEach(evt=>{
  popup.addEventListener(evt, e=> e.stopPropagation(), {passive:true});
});

// ===== Player interaction (pointerdown = mobile-fast) =====
players.forEach(p=>{
  p.addEventListener('pointerdown', (ev)=>{
    if (!isPixelHit(p, ev.clientX, ev.clientY)) return;
    if (phase !== 'idle') return;
    ev.preventDefault();
    tapSfx();
    runRound(p).catch(err=> log('round aborted/err', err));
  }, {passive:false});
});

// Keep alpha maps aligned after layout changes
window.addEventListener('orientationchange', ()=> setTimeout(()=>players.forEach(renderAlpha), 250));
