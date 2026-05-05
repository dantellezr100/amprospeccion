
(function(){
  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function showInstallButton(){
    const btn = document.getElementById('amInstallAppBtn');
    if(btn && !isStandalone()) btn.style.display = 'inline-flex';
  }
  function hideInstallButton(){
    const btn = document.getElementById('amInstallAppBtn');
    if(btn) btn.style.display = 'none';
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; hideInstallButton(); });
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('amInstallAppBtn');
    const help = document.getElementById('amInstallHelp');
    if(btn){
      btn.addEventListener('click', async () => {
        if(deferredPrompt){
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          hideInstallButton();
        } else if(help){
          help.style.display = help.style.display === 'block' ? 'none' : 'block';
        }
      });
    }
    if(!isStandalone()) setTimeout(showInstallButton, 1200);
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .then(() => console.log('AM Autopartes PWA lista para instalar'))
        .catch((error) => console.warn('No se pudo registrar el service worker:', error));
    });
  }
})();
