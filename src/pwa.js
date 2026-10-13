// "Install the game as an app": registers the service worker and shows an Install button on the login card.
// Android/desktop Chrome: a real install prompt. iPhone Safari has no prompt, so we show how to do it by hand.
let deferred = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

function refresh() {
  const btn = document.getElementById('installbtn'), tip = document.getElementById('installtip');
  if (!btn || !tip) return;
  const done = standalone();
  btn.hidden = done || !deferred;
  tip.hidden = done || !!deferred || !isIOS();
}

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
addEventListener('appinstalled', () => { deferred = null; refresh(); });

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('installbtn');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferred) return;
    const p = deferred; deferred = null; refresh();
    try { p.prompt(); await p.userChoice; } catch { /* dismissed */ }
  });
  refresh();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* fine: the game works without it */ }); });
}
