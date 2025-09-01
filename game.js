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

// ===== Audio pools (avoid cutoffs on rapid taps) =====
function makePool(el, size=3){
  const clones = Array.from({length:size}, ()=> el.cloneNode(true));
  clones.forEach(c=>{ c.preload='auto'; c.load?.(); });
  let i=0;
  return {
    play(){ const a=clones[i++%clones.length]; try{ a.currentTime=0; a.play(); }catch(e){ log('audio play err', e); } },
    setVolume(v){ clones.forEach(c=> c.volume=v); }
  };
}
const sfx = {
  click:new Audio('./assets/button-click.mp3'),   // UI buttons
  tap:new Audio('./assets/tap.mp3'),              // player taps
  boomA:makePool(boom1,3),
  boomB:makePool(boom2,3),
  winA: makePool(win1,3),
  winB: makePool(win2,3)
};

function clickSfx(){ try{ sfx.click.currentTime=0; sfx.click.play(); }catch(e){} }
function tapSfx(){   try{ sfx.tap.currentTime=0;   sfx.tap.play();   }catch(e){} }
function playBoom(){ sfx.boomA.play(); sfx.boomB.play(); }
function playWin(){  sfx.winA.play();  sfx.winB.play();  }

// ===== UI boot fast (do not wait for images/audio) =====
function showUI(){ loading.style.display='none'; landing.classList.remove('hidden'); }
document.addEventListener('DOMContentLoaded', showUI);
setTimeout(()=>{ if(landing.classList.contains('hidden')) showUI(); }, 1500);

// ===== BGM: try autoplay silently, fade-in; fallback to first gesture =====
bgm.volume = 0;
function fadeTo(target=0.35, ms=700){
  const start=bgm.volume, diff=target-start, t0=performance.now();
  const step = t => { const p=Math.min(1,(t-t0)/ms); bgm.volume=start+diff*p; if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
async function startBgm(){ try{ await bgm.play(); fadeTo(0.35,800); }catch(e){ log('bgm blocked'); } }
document.addEventListener('DOMContentLoaded', startBgm);
const tryUnlock = ()=>{ startBgm(); window.removeEventListener('pointerdown', tryUnlock); window.removeEventListener('keydown', tryUnlock); };
window.addEventListener('pointerdown', tryUnlock, { once:true, passive:true });
window.addEventListener('keydown', tryUnlock, { once:true });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ try{ bgm.pause(); }catch(_){}} else if(bgm.paused){ startBgm(); } });

// ===== Pixel helpers =====
function trackPurchase(value = 2.00, currency = 'USD') {
  try { if (typeof fbq === 'function') fbq('track', 'Purchase', { value, currency }); } catch (_) {}
  try { if (typeof fbq === 'function') fbq('trackCustom', 'ClaimClick'); } catch (_) {}
}

// ===== Game logic =====
const players = document.querySelectorAll('.player');
let playCount = 0; // 1 lose, 2 win

// init sprites and enable taps
document.addEventListener('DOMContentLoaded', ()=>{
  players.forEach(p=>{
    p.style.backgroundImage = `url('${p.dataset.img}')`;
    p.classList.add('zoom');
    p.style.pointerEvents='auto';
  });
  playCount = 1;
});

function resetPlayers(){
  players.forEach(p=>{
    p.classList.remove('spin3d','impact','afterglow','zoom');
    p.style.pointerEvents='none';
    p.style.backgroundImage=`url('${p.dataset.img}')`;
    p.style.transform='';
  });
}

function once(el, evt, fn){ const h=(e)=>{ el.removeEventListener(evt,h); fn(e); }; el.addEventListener(evt,h,{passive:true}); }

players.forEach(p=>{
  p.addEventListener('click', ()=>{
    tapSfx();
    players.forEach(x=>x.classList.remove('zoom'));
    players.forEach(x=>x.style.pointerEvents='none');
    p.classList.add('spin3d');

    once(p, 'animationend', ()=>{
      p.classList.remove('spin3d');

      if (playCount === 1){
        // LOSE round
        p.style.backgroundImage = "url('./assets/sad.png')";
        playBoom();
        p.classList.add('impact','afterglow');

        setTimeout(()=>{
          resultImg.src = './assets/popup-lose.webp';
          actionBtnCt.innerHTML = `<img id="try-again-btn" src="./assets/try-again-button.gif" alt="Try again">`;
          popup.classList.add('show');

          const tab = document.getElementById('try-again-btn');
          if (tab) tab.addEventListener('click', ()=>{
            clickSfx();
            popup.classList.remove('show');
            p.classList.remove('afterglow');
            resetPlayers();
            playCount=2;
            players.forEach(pl=>{ pl.classList.add('zoom'); pl.style.pointerEvents='auto'; });
          }, { once:true });
        }, 650);

      } else {
        // WIN round
        p.style.backgroundImage = "url('./assets/star.gif')";
        playWin();
        p.classList.add('impact','afterglow');

        setTimeout(()=>{
          resultImg.src = './assets/popup-win-2usd.webp';
          actionBtnCt.innerHTML = `
            <a id="claim-btn" href="https://t.me/FAFA558khwin" target="_blank" rel="noopener">
              <img src="./assets/claim-button.gif" alt="Claim">
            </a>`;
          popup.classList.add('show');

          const cb = document.getElementById('claim-btn');
          if (cb) cb.addEventListener('click', (ev) => {
            clickSfx();                 // UI sound
            trackPurchase(2.00, 'USD'); // Pixel purchase
            const url = cb.href;        // let pixel fire, then open
            ev.preventDefault();
            setTimeout(() => { window.open(url, '_blank', 'noopener'); }, 300);
          }, { once:true });

          if (window.confetti){
            window.confetti({ particleCount: 80, spread: 360, startVelocity: 45, ticks: 90, origin: { y: 0.5 } });
            setTimeout(()=> window.confetti({ particleCount: 60, spread: 320, startVelocity: 35, ticks: 80, origin: { y: 0.4 } }), 900);
          }
        }, 650);
      }
    });
  });
});
