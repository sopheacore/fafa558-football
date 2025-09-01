// ===== Helper: log but don't crash =====
const log = (...a)=>{ try{ console.log('[game]',...a); }catch(_){} };

// ===== Elements =====
const loading = document.getElementById('loading');
const landing = document.getElementById('landing');
const popup = document.getElementById('popup');
const resultImg = document.getElementById('resultImg');
const actionBtnCt = document.getElementById('actionButton');

const boom1 = document.getElementById('boomSound1');
const boom2 = document.getElementById('boomSound2');
const win1  = document.getElementById('winSound1');
const win2  = document.getElementById('winSound2');
const bgm   = document.getElementById('bgMusic');

// ===== Small, light audio pools =====
function makePool(el, size=2){
  const src = el.currentSrc || el.src;
  const items = Array.from({length:size}, ()=> {
    const a = new Audio(src);
    a.preload = 'none'; // don't fetch until first play
    return a;
  });
  let i = 0;
  return {
    play(){ const a = items[i++ % items.length]; try{ a.currentTime = 0; a.play(); } catch(e){ log('sfx play', e); } },
    setVolume(v){ items.forEach(a=> a.volume = v); }
  };
}
const sfx = {
  click: new Audio('./assets/button-click.mp3'), // UI buttons
  tap:   new Audio('./assets/tap.mp3'),         // player taps
  boomA: makePool(boom1, 2),
  boomB: makePool(boom2, 2),
  winA:  makePool(win1, 2),
  winB:  makePool(win2, 2)
};
function clickSfx(){ try{ sfx.click.currentTime=0; sfx.click.play(); }catch(e){} }
function tapSfx(){   try{ sfx.tap.currentTime=0;   sfx.tap.play();   }catch(e){} }
function playBoom(){ sfx.boomA.play(); sfx.boomB.play(); }
function playWin(){  sfx.winA.play();  sfx.winB.play();  }

// ===== UI boot fast =====
function showUI(){ loading.style.display='none'; landing.classList.remove('hidden'); }
document.addEventListener('DOMContentLoaded', showUI);
setTimeout(()=>{ if(landing.classList.contains('hidden')) showUI(); }, 1500);

// ===== BGM: autoplay fade-in + gesture fallback =====
bgm.volume = 0;
function fadeTo(target=0.35, ms=700){
  const start=bgm.volume, diff=target-start, t0=performance.now();
  const step = t => { const p=Math.min(1,(t-t0)/ms); bgm.volume=start+diff*p; if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function startBgm(){ try{ await bgm.play(); fadeTo(0.35,800); }catch(e){} }
document.addEventListener('DOMContentLoaded', startBgm);
const tryUnlock = ()=>{ startBgm(); window.removeEventListener('pointerdown', tryUnlock); window.removeEventListener('keydown', tryUnlock); };
window.addEventListener('pointerdown', tryUnlock, { once:true, passive:true });
window.addEventListener('keydown', tryUnlock, { once:true });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ try{ bgm.pause(); }catch(_){}} else if(bgm.paused){ startBgm(); } });

// ===== Lazy confetti =====
let confettiLoading = false;
function withConfetti(run){
  if (window.confetti) return run();
  if (confettiLoading) { const id=setInterval(()=>{ if(window.confetti){ clearInterval(id); run(); }}, 40); return; }
  confettiLoading = true;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js';
  s.async = true;
  s.onload = run;
  document.head.appendChild(s);
}

// ===== Pixel helpers =====
function trackPurchase(value = 2.00, currency = 'USD') {
  try { if (typeof fbq === 'function') fbq('track', 'Purchase', { value, currency }); } catch (_) {}
  try { if (typeof fbq === 'function') fbq('trackCustom', 'ClaimClick'); } catch (_) {}
}

// ===== Per-pixel hit testing using the same GIF as the sprite =====
const players = document.querySelectorAll('.player');
const alphaMap = new Map(); // el -> { canvas, ctx, w, h, img }

function prepareAlpha(el){
  const src = el.dataset.img;
  if (!src) return;
  const img = new Image();
  img.crossOrigin = 'anonymous'; // safe if same-origin; harmless otherwise
  img.src = src;
  img.onload = ()=>{ el._alphaImg = img; renderAlpha(el); };
  img.onerror = ()=>{ log('alpha image failed', src); };
}

function renderAlpha(el){
  const img = el._alphaImg;
  if (!img) return;
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');

  // Match CSS background-size: contain; background-position: center bottom;
  const sx = w / img.naturalWidth;
  const sy = h / img.naturalHeight;
  const s  = Math.min(sx, sy);
  const dw = Math.round(img.naturalWidth * s);
  const dh = Math.round(img.naturalHeight * s);
  const dx = Math.round((w - dw) / 2); // centered X
  const dy = h - dh;                    // bottom aligned Y

  ctx.clearRect(0,0,w,h);
  ctx.drawImage(img, dx, dy, dw, dh);
  alphaMap.set(el, { canvas: cvs, ctx, w, h });
}

function isPixelHit(el, clientX, clientY){
  const data = alphaMap.get(el);
  if (!data){ return true; } // if not ready, allow hit (fallback)
  const rect = el.getBoundingClientRect();
  const x = Math.floor(clientX - rect.left);
  const y = Math.floor(clientY - rect.top);
  if (x < 0 || y < 0 || x >= data.w || y >= data.h) return false;
  const a = data.ctx.getImageData(x, y, 1, 1).data[3];
  return a > 10; // only count non-transparent pixels
}

// Rebuild alpha maps on resize (keeps alignment with responsive layout)
let resizeT;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeT);
  resizeT = setTimeout(()=> players.forEach(renderAlpha), 120);
});

// ===== Game state (strict 2nd-click = win) =====
let round = 1;       // 1 = lose, 2 = win
let isBusy = false;  // lock during round
let popupTimer = null;

function clearTimers(){ if (popupTimer){ clearTimeout(popupTimer); popupTimer = null; } }

document.addEventListener('DOMContentLoaded', ()=>{
  players.forEach(p=>{
    p.style.backgroundImage = `url('${p.dataset.img}')`;
    p.classList.add('zoom');
    p.style.pointerEvents='auto';
    prepareAlpha(p);
  });
  round = 1;
  isBusy = false;
});

function resetPlayers(){
  clearTimers();
  players.forEach(p=>{
    p.classList.remove('spin3d','impact','afterglow','zoom');
    p.style.pointerEvents='none';
    p.style.backgroundImage=`url('${p.dataset.img}')`;
    p.style.transform='';
  });
  isBusy = false;
}

function onSpinEndFactory(p){
  return function onSpinEnd(e){
    if (e.animationName !== 'spinY360') return;  // only respond to the spin end
    p.removeEventListener('animationend', onSpinEnd);
    p.classList.remove('spin3d');

    if (round === 1){
      // ----- LOSE -----
      p.style.backgroundImage = "url('./assets/sad.png')";
      playBoom();
      p.classList.add('impact','afterglow');

      const thisRound = round;
      popupTimer = setTimeout(()=>{
        if (round !== thisRound) return;

        resultImg.src = './assets/popup-lose.webp';
        actionBtnCt.innerHTML = `<img id="try-again-btn" src="./assets/try-again-button.gif" alt="Try again">`;
        popup.classList.add('show');

        const tab = document.getElementById('try-again-btn');
        if (tab) tab.addEventListener('click', ()=>{
          clickSfx();
          popup.classList.remove('show');
          p.classList.remove('afterglow');
          resetPlayers();
          round = 2; // next click is win
          players.forEach(pl=>{ pl.classList.add('zoom'); pl.style.pointerEvents='auto'; });
          players.forEach(renderAlpha); // keep alpha maps in sync after layout reset
        }, { once:true });

        isBusy = false;
      }, 520);

    } else {
      // ----- WIN -----
      p.style.backgroundImage = "url('./assets/star.gif')";
      playWin();
      p.classList.add('impact','afterglow');

      const thisRound = round;
      popupTimer = setTimeout(()=>{
        if (round !== thisRound) return;

        resultImg.src = './assets/popup-win-2usd.webp';
        actionBtnCt.innerHTML = `
          <a id="claim-btn" href="https://t.me/FAFA558khwin" target="_blank" rel="noopener">
            <img src="./assets/claim-button.gif" alt="Claim">
          </a>`;
        popup.classList.add('show');

        const cb = document.getElementById('claim-btn');
        if (cb) cb.addEventListener('click', (ev) => {
          clickSfx();
          trackPurchase(2.00, 'USD');
          const url = cb.href;
          ev.preventDefault();
          setTimeout(() => { window.open(url, '_blank', 'noopener'); }, 300);
        }, { once:true });

        withConfetti(()=>{
          window.confetti({ particleCount: 80, spread: 360, startVelocity: 45, ticks: 90, origin: { y: 0.5 } });
          setTimeout(()=> window.confetti({ particleCount: 60, spread: 320, startVelocity: 35, ticks: 80, origin: { y: 0.4 } }), 900);
        });

        isBusy = false;
      }, 520);
    }
  };
}

players.forEach(p=>{
  p.addEventListener('click', (ev)=>{
    // Only accept clicks on visible player pixels (using the GIF’s alpha)
    if (!isPixelHit(p, ev.clientX, ev.clientY)) return;

    if (isBusy) return;
    isBusy = true;

    tapSfx();
    clearTimers();

    players.forEach(x=>x.classList.remove('zoom'));
    players.forEach(x=>x.style.pointerEvents='none');

    p.classList.add('spin3d');
    const handler = onSpinEndFactory(p);
    p.addEventListener('animationend', handler);
  });
});
