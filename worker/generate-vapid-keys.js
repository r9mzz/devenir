/* Génère une nouvelle paire de clés VAPID (P-256).
   Usage : node worker/generate-vapid-keys.js
   La clé privée affichée ne doit JAMAIS être commitée dans ce dépôt
   (public) — colle-la uniquement dans le secret Cloudflare VAPID_PRIVATE_JWK.
   La clé publique n'est pas secrète : colle-la dans la variable Cloudflare
   VAPID_PUBLIC ET dans la constante VAPID_PUBLIC de index.html (les deux
   doivent être strictement identiques). */
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubDer = publicKey.export({ type: 'spki', format: 'der' });
const pubRaw = pubDer.subarray(pubDer.length - 65);
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const privJwk = privateKey.export({ format: 'jwk' });

console.log('VAPID_PUBLIC (variable Cloudflare + constante index.html) :');
console.log(b64url(pubRaw));
console.log('');
console.log('VAPID_PRIVATE_JWK (secret Cloudflare uniquement — ne jamais commiter) :');
console.log(JSON.stringify({ kty: privJwk.kty, crv: privJwk.crv, x: privJwk.x, y: privJwk.y, d: privJwk.d }));
