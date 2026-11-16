import assert from 'node:assert/strict';
import { verifyAccess, _resetKeyCache } from '../src/access.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123' };
const fetchFn = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

async function token(over = {}, header = {}, signWith = pair.privateKey) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', ...header }));
  const p = b64u(JSON.stringify({ aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'Author@Example.com', ...over }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signWith, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}
let n = 0; const t = async (name, fn) => { _resetKeyCache(); await fn(); n++; console.log('ok  -', name); };

await t('valid token returns lowercase email', async () => assert.equal(await verifyAccess(await token(), env, fetchFn), 'author@example.com'));
await t('wrong audience rejected', async () => assert.equal(await verifyAccess(await token({ aud: ['other'] }), env, fetchFn), null));
await t('wrong issuer rejected', async () => assert.equal(await verifyAccess(await token({ iss: 'https://evil.example.com' }), env, fetchFn), null));
await t('expired rejected', async () => assert.equal(await verifyAccess(await token({ exp: 1000 }), env, fetchFn), null));
await t('forged signature rejected', async () => {
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await verifyAccess(await token({}, {}, other.privateKey), env, fetchFn), null);
});
await t('alg none rejected', async () => assert.equal(await verifyAccess(await token({}, { alg: 'none' }), env, fetchFn), null));
await t('missing token / config rejected', async () => {
  assert.equal(await verifyAccess(null, env, fetchFn), null);
  assert.equal(await verifyAccess(await token(), {}, fetchFn), null);
});
console.log(`\n${n} access tests passed`);
