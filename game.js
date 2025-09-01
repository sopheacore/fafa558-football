// ===== helpers =====
const log = (...a)=>{ try{ console.log('[game]',...a); }catch(_){} };
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ===== elements =====
const loading = $('#loading');
const landing = $('#landing');
const players = $$('.player');

const popupLose = $('#popup-lose');
const popupWin  = $('#popup-win');
const btnTryAgain = $('#btn-try-again');
const btnClaim    = $('#btn-claim');

const boom1 = $('#boomSound1');
const boom2 = $('#boomSound2');
const win1  = $('#winSound1');
const win2  = $('#winSound2');
const bgm   = $('#bgMusic');

// ===== constants (keep in sync with CSS) =====
const SPIN_MS   = 650;
const IMPACT_MS = 280;

// ===== audio =====
function makePool(el, size=2){
  const src = el.currentSrc || el.src;
  const items = Array.from({length:size}, ()=>{ const a=new Audio(src); a.preload='none'; return a; });
  let i=0; return { play(){ const a=items[i++%items.length]; try{ a.currentTime=0; a.play(); }catch(e){ log('sfx play',e); } } };
}
const sfx = {
  click:new Audio('./assets/button-click.mp3'),
  tap:  new Audio('./assets/tap.mp3'),
  boomA:makePool(boom1,2),
  boomB:makePool(boom2,2),
  winA: makePool(win1,2),
  winB: makePool(win2,2),
};
function clickSfx(){ try{sfx.click.currentTime=0; sfx.click.play();}catch{} }
function tapSfx(){   try{sfx.tap.currentTime=0;   sfx.tap.play();}catch{} }
function playBoom(){ sfx.boomA.play(); sfx.boomB.play(); }
function playWin(){  sfx.winA.play();  sfx.winB.play();  }

// ===== fast boot =====
function showUI(){ loading.style.display='none'; landing.classList.remove('hidden'); }
document.addEventListener('DOMContentLoaded', showUI);
setTimeout(()=>{ if(landing.classList.contains('hidden')) showUI(); }, 1500);

// ===== bgm =====
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

// ===== confetti (lazy) =====
let confettiLoading=false;
function withConfetti(run){
  if(window.confetti) return run();
  if(confettiLoading){ const id=setInterval(()=>{ if(window.confetti){ clearInterval(id); run(); }},40); return; }
  confettiLoading=true;
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
  s.async=true; s.onload=run; document.head.appendChild(s);
}

// ===== pixel (Meta) =====
function trackPurchase(value=2.00,currency='USD'){
  try{ if(typeof fbq==='function') fbq('track','Purchase',{value,currency}); }catch(_){}
  try{ if(typeof fbq==='function') fbq('trackCustom','ClaimClick'); }catch(_){}
}

// ===== per-pixel click using the same GIF =====
const alphaMap = new Map(); // el -> {canvas,ctx,w,h}
function prepareAlpha(el){
  const src = el.dataset.img; if(!src) return;
  const img = new Image();
  img.crossOrigin='anonymous';
  img.src = src;
  img.onload = ()=>{ el._alphaImg=img; renderAlpha(el); };
  img.onerror = ()=>{ log('alpha load fail', src); };
}
function renderAlpha(el){
  const img = el._alphaImg; if(!img) return;
  const r=el.getBoundingClientRect();
  const w=Math.max(1,Math.round(r.width));
  const h=Math.max(1,Math.round(r.height));
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const ctx=cvs.getContext('2d');
  const sx=w/img.naturalWidth, sy=h/img.naturalHeight, s=Math.min(sx,sy);
  const dw=Math.round(img.naturalWidth*s), dh=Math.round(img.naturalHeight*s);
  const dx=Math.round((w-dw)/2), dy=h-dh; // center X, bottom Y
  try{ ctx.clearRect(0,0,w,h); ctx.drawImage(img,dx,dy,dw,dh); alphaMap.set(el,{canvas:cvs,ctx,w,h}); }
  catch(e){ alphaMap.delete(el); }
}
function isPixelHit(el, clientX, clientY){
  const data=alphaMap.get(el); if(!data) return true; // fallback
  const r=el.getBoundingClientRect();
  const x=Math.floor(clientX-r.left), y=Math.floor(clientY-r.top);
  if(x<0||y<0||x>=data.w||y>=data.h) return false;
  try{ return data.ctx.getImageData(x,y,1,1).data[3] > 10; }catch{ return true; }
}
let resizeT; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>players.forEach(renderAlpha),120); });

// ===== state (token-guarded; fixed HTML popups) =====
let round = 1;      // 1 = lose, 2 = win
let token = 0;      // increments each round start
let state = 'idle'; // 'idle' | 'spinning' | 'popup'

function enablePlayers(){ players.forEach(p=>{ p.classList.add('zoom'); p.style.pointerEvents='auto'; }); }
function disablePlayers(){ players.forEach(p=>{ p.classList.remove('zoom'); p.style.pointerEvents='none'; }); }
function hardResetSprites(){
  players.forEach(p=>{
    p.classList.remove('spin3d','impact','afterglow');
    p.style.backgroundImage=`url('${p.dataset.img}')`;
    p.style.transform='';
  });
}

function hideAllPopups(){
  popupLose.classList.remove('show');
  popupWin.classList.remove('show');
  popupLose.setAttribute('aria-hidden','true');
  popupWin.setAttribute('aria-hidden','true');
}

// Always bind popup button handlers ONCE
btnTryAgain?.addEventListener('click', ()=>{
  clickSfx();
  // Close lose popup and prep for round 2
  hideAllPopups();
  hardResetSprites();
  round = 2;
  state = 'idle';
  enablePlayers();
  players.forEach(renderAlpha);
}, { once:false });

btnClaim?.addEventListener('click', (ev)=>{
  ev.preventDefault();
  clickSfx();
  trackPurchase(2.00,'USD');
  const url = btnClaim.href;
  setTimeout(()=> window.open(url,'_blank','noopener'), 300);
}, { once:false });

// Helper: schedule guarded timeouts (ignore if token changed)
function schedule(ms, myToken, fn){
  const t=setTimeout(()=>{ if(myToken===token) fn(); }, ms);
  return ()=> clearTimeout(t);
}

// Show popups (HTML already contains markup; we only toggle)
function showLose(myToken){
  if (myToken !== token) return;
  // If somehow we are in round 2 already, never show a lose popup
  if (round !== 1) return;
  hideAllPopups();
  popupLose.classList.add('show');
  popupLose.setAttribute('aria-hidden','false');
}

function showWin(myToken){
  if (myToken !== token) return;
  hideAllPopups();
  popupWin.classList.add('show');
  popupWin.setAttribute('aria-hidden','false');
  // confetti
  withConfetti(()=>{
    window.confetti({ particleCount: 80, spread: 360, startVelocity: 45, ticks: 90, origin: { y: 0.5 } });
    setTimeout(()=> window.confetti({ particleCount: 60, spread: 320, startVelocity: 35, ticks: 80, origin: { y: 0.4 } }), 900);
  });
}

// Core round (deterministic timers + token guard)
function runRound(p){
  token++; const myToken = token;
  state = 'spinning';
  disablePlayers();

  // spin
  p.classList.add('spin3d');

  // after SPIN
  schedule(SPIN_MS, myToken, ()=>{
    p.classList.remove('spin3d');

    if (round === 1){
      // ---- LOSE ----
      p.style.backgroundImage = "url('./assets/sad.png')";
      playBoom();
      p.classList.add('impact','afterglow');

      // after IMPACT, show lose
      schedule(IMPACT_MS, myToken, ()=>{
        state = 'popup';
        showLose(myToken);
      });

    } else {
      // ---- WIN ----
      p.style.backgroundImage = "url('./assets/star.gif')";
      playWin();
      p.classList.add('impact','afterglow');

      // after IMPACT, show win
      schedule(IMPACT_MS, myToken, ()=>{
        state = 'popup';
        showWin(myToken);
      });
    }
  });
}

// Init
document.addEventListener('DOMContentLoaded', ()=>{
  players.forEach(p=>{
    p.style.backgroundImage = `url('${p.dataset.img}')`;
    p.style.pointerEvents='auto';
    p.classList.add('zoom');
    prepareAlpha(p);
  });
  hideAllPopups();
  enablePlayers();
  round = 1;
  state = 'idle';
});

// Player interaction (pointerdown for mobile) + per-pixel hit
players.forEach(p=>{
  p.addEventListener('pointerdown', (ev)=>{
    if (state !== 'idle') return;
    if (!isPixelHit(p, ev.clientX, ev.clientY)) return;
    ev.preventDefault();
    tapSfx();
    runRound(p);
  }, {passive:false});
});

// keep alpha maps aligned after orientation change
window.addEventListener('orientationchange', ()=> setTimeout(()=>players.forEach(renderAlpha), 250));
