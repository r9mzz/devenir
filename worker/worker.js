/* Devenir — relais de notifications push (Cloudflare Worker).
   Rôle unique : envoyer, au bon moment, une notification Web Push au
   téléphone même quand l'appli est fermée. Le serveur ne connaît que ce
   qui est nécessaire pour décider QUAND notifier — jamais le contenu du
   journal (aucune activité, aucun bilan, aucune intention n'y transite).

   Schéma stocké par device (KV, clé = id aléatoire généré côté client) :
   {
     subscription: PushSubscriptionJSON,
     tz: 'Europe/Paris',
     settings: { interval, start, end },
     pauseUntil: 0,
     day: { key:'YYYY-MM-DD', hasEntry:bool, firstFillAt:ms, lastSlotFired:n },
     morningPromptDate: 'YYYY-MM-DD'
   }
*/

const te = new TextEncoder();

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

/* Chiffrement du message (RFC 8291 — aes128gcm). */
async function encryptPush(subscription, plaintext) {
  const ua_pub = b64urlToBytes(subscription.keys.p256dh);
  const auth = b64urlToBytes(subscription.keys.auth);

  const uaPublicKey = await crypto.subtle.importKey('raw', ua_pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as_pub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256));

  const prkKey = await hmacSha256(auth, ecdhSecret);
  const keyInfo = concatBytes(te.encode('WebPush: info\0'), ua_pub, as_pub);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);

  const cekInfo = concatBytes(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1]));
  const cek = (await hmacSha256(prk, cekInfo)).slice(0, 16);
  const nonceInfo = concatBytes(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1]));
  const nonce = (await hmacSha256(prk, nonceInfo)).slice(0, 12);

  const plainBytes = concatBytes(te.encode(plaintext), new Uint8Array([2])); // délimiteur RFC 8188, dernier bloc
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipherBytes = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, plainBytes));

  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, rsBytes, new Uint8Array([as_pub.length]), as_pub);
  return concatBytes(header, cipherBytes);
}

async function buildAuthHeader(env, audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: 'mailto:devenir-app@proton.me' };
  const signingInput = `${bytesToB64url(te.encode(JSON.stringify(header)))}.${bytesToB64url(te.encode(JSON.stringify(payload)))}`;
  const privJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(signingInput)));
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendPush(env, subscription, message) {
  const body = await encryptPush(subscription, JSON.stringify(message));
  const audience = new URL(subscription.endpoint).origin;
  const auth = await buildAuthHeader(env, audience);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': auth
    },
    body
  });
}
async function trySend(env, record, message) {
  try {
    const res = await sendPush(env, record.subscription, message);
    return !(res.status === 404 || res.status === 410); // false = abonnement expiré, à supprimer
  } catch (e) { return true; } // erreur transitoire réseau : on retentera au prochain tick
}

function sheetTitle(iv) {
  return iv < 60 ? `Ces ${iv} dernières minutes ?`
    : iv === 60 ? 'Cette dernière heure ?'
      : iv === 90 ? 'Cette dernière heure et demie ?'
        : `Ces ${iv / 60} dernières heures ?`;
}
function localParts(tz, ts) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(new Date(ts));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return { dayKey: `${get('year')}-${get('month')}-${get('day')}`, hour };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/' ) {
      return new Response('Devenir — relais de notifications push.', { headers: CORS });
    }

    if (url.pathname === '/sync' && req.method === 'POST') {
      const data = await req.json().catch(() => null);
      if (!data || !data.id || !data.subscription) return new Response('bad request', { status: 400, headers: CORS });
      const existing = await env.DEVENIR_KV.get(data.id, 'json') || {};
      const merged = {
        subscription: data.subscription || existing.subscription,
        tz: data.tz || existing.tz || 'Europe/Paris',
        settings: data.settings || existing.settings || { interval: 60, start: 9, end: 22 },
        pauseUntil: data.pauseUntil ?? existing.pauseUntil ?? 0,
        day: data.day || existing.day || { key: '', hasEntry: false },
        morningPromptDate: data.morningPromptDate ?? existing.morningPromptDate ?? ''
      };
      await env.DEVENIR_KV.put(data.id, JSON.stringify(merged));
      return new Response('ok', { headers: CORS });
    }

    if (url.pathname === '/unsubscribe' && req.method === 'POST') {
      const data = await req.json().catch(() => null);
      if (data && data.id) await env.DEVENIR_KV.delete(data.id);
      return new Response('ok', { headers: CORS });
    }

    if (url.pathname === '/test' && req.method === 'POST') {
      const data = await req.json().catch(() => null);
      if (!data || !data.id) return new Response('bad request', { status: 400, headers: CORS });
      const record = await env.DEVENIR_KV.get(data.id, 'json');
      if (!record || !record.subscription) return new Response('inconnu', { status: 404, headers: CORS });
      const ok = await trySend(env, record, { title: 'Devenir', body: 'Ceci est un test distant — le serveur peut te joindre.' });
      return new Response(ok ? 'ok' : 'abonnement expiré', { status: ok ? 200 : 410, headers: CORS });
    }

    return new Response('not found', { status: 404, headers: CORS });
  },

  async scheduled(event, env) {
    const list = await env.DEVENIR_KV.list();
    for (const k of list.keys) {
      const record = await env.DEVENIR_KV.get(k.name, 'json');
      if (!record || !record.subscription) continue;
      let changed = false;
      const now = Date.now();
      const { dayKey, hour } = localParts(record.tz || 'Europe/Paris', now);

      if (record.pauseUntil && now < record.pauseUntil) continue;
      if (record.pauseUntil && now >= record.pauseUntil) { record.pauseUntil = 0; changed = true; }

      const s = Object.assign({ interval: 60, start: 9, end: 22 }, record.settings || {});
      if (hour < s.start || hour >= s.end) {
        if (changed) await env.DEVENIR_KV.put(k.name, JSON.stringify(record));
        continue;
      }
      if (!record.day || record.day.key !== dayKey) { record.day = { key: dayKey, hasEntry: false }; changed = true; }

      if (!record.day.hasEntry) {
        if (record.morningPromptDate !== dayKey) {
          record.morningPromptDate = dayKey; changed = true;
          const ok = await trySend(env, record, { title: 'Devenir', body: 'Une nouvelle journée commence — note ta première heure.' });
          if (!ok) { await env.DEVENIR_KV.delete(k.name); continue; }
        }
        if (changed) await env.DEVENIR_KV.put(k.name, JSON.stringify(record));
        continue;
      }

      const iv = s.interval * 60000;
      const elapsed = now - (record.day.firstFillAt || now);
      if (elapsed >= iv) {
        const slot = Math.floor(elapsed / iv);
        if ((record.day.lastSlotFired || 0) < slot) {
          record.day.lastSlotFired = slot; changed = true;
          const ok = await trySend(env, record, { title: 'Devenir', body: sheetTitle(s.interval) });
          if (!ok) { await env.DEVENIR_KV.delete(k.name); continue; }
        }
      }
      if (changed) await env.DEVENIR_KV.put(k.name, JSON.stringify(record));
    }
  }
};
