// Service worker do EquipER — existe para o Chrome/Android tratar o site como Web App instalável. NÃO faz cache: toda requisição vai direto
// para a rede, então nunca serve uma versão antiga do app nem interfere no Firebase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)); });

// Fase 30: envio em segundo plano (Background Sync — Chrome/Android). Ao sair de cena com alterações guardadas, o app deixa uma cópia do outbox
// no IndexedDB ('equiper-outbox-sw', chave 'estado') e pede um "sync". O navegador acorda este arquivo assim que houver internet — mesmo com o
// app fechado e a tela bloqueada — e ele envia a cópia pela REST do banco (mesmo envio da Fase 17). Não envia se o app estiver na tela (aí o
// próprio app envia). O que foi entregue fica anotado em 'enviados'; o app, ao voltar, tira do outbox o que não mudou desde então.
function swAbrir(){ return new Promise((res, rej) => { const r = indexedDB.open('equiper-outbox-sw', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function swOp(db, modo, fn){ return new Promise((res, rej) => { const tx = db.transaction('kv', modo); const r = fn(tx.objectStore('kv')); let v; if(r) r.onsuccess = () => { v = r.result; }; tx.oncomplete = () => res(v); tx.onerror = tx.onabort = () => rej(tx.error); }); }
function swExpira(jwt){ try{ const p = JSON.parse(atob(String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return (Number(p.exp) || 0) * 1000; }catch(e){ return 0; } }
async function swRenovarToken(st){
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(st.apiKey), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(st.refreshToken) });
  if(!r.ok) return null;
  const j = await r.json(); return (j && j.id_token) || null;
}
async function swEnviarPendentes(){
  const db = await swAbrir();
  const st = await swOp(db, 'readonly', s => s.get('estado'));
  if(!st || !Array.isArray(st.pedidos) || !st.pedidos.length || !/^https:\/\/[^/]+$/.test(st.base || '')) return;
  const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if(janelas.some(c => c.visibilityState === 'visible')) return;                       // o app está na tela: ele mesmo envia
  let token = st.idToken;
  if(!token || swExpira(token) < Date.now() + 120000) token = (st.refreshToken && st.apiKey) ? await swRenovarToken(st) : null;
  if(!token) return;                                                                     // sem como entrar: fica para quando o app abrir
  const headers = { 'Content-Type': 'application/json' };
  if(st.appCheck && swExpira(st.appCheck) > Date.now() + 30000) headers['X-Firebase-AppCheck'] = st.appCheck;
  const enviados = (await swOp(db, 'readonly', s => s.get('enviados'))) || {};
  let repetir = false;
  for(const p of st.pedidos){
    if(!p || typeof p.corpo !== 'string' || enviados[p.nome] === p.corpo) continue;
    try{
      const r = await fetch(st.base + '/.json?auth=' + encodeURIComponent(token), { method: 'PATCH', headers, body: p.corpo });
      if(r.ok) enviados[p.nome] = p.corpo; else if(r.status >= 500 || r.status === 429) repetir = true;   // recusa (401/403) não melhora repetindo
    }catch(e){ repetir = true; }
  }
  await swOp(db, 'readwrite', s => s.put(enviados, 'enviados'));
  if(repetir) throw new Error('envio em segundo plano incompleto; o navegador tenta de novo mais tarde');
}
self.addEventListener('sync', (event) => { if(event.tag === 'equiper-outbox') event.waitUntil(swEnviarPendentes()); });
