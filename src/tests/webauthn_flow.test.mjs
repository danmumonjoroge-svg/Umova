import crypto from 'node:crypto';
// minimal definite-length CBOR encoder (maps, text, bytes, ints) — exactly what a real authenticator emits
const head = (major, n) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
const cborEncode = (v) => {
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cborEncode(k), cborEncode(x)])]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const t = Buffer.from(v); return Buffer.concat([head(3, t.length), t]); }
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
  throw new Error('unsupported');
};
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const RP_ID = 'umova.app', ORIGIN = 'https://business.umova.app';   // subdomain origin, parent RP ID — the 3-app setup
const results = [];
const check = (name, ok, extra='') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ---- a software "fingerprint" authenticator ----
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const credId = crypto.randomBytes(32);
const userId = '7b0f6c1e-1111-4222-8333-444455556666';
const cose = cborEncode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
const clientData = (type, challenge, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const counterBuf = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

function attestation(challenge, { origin = ORIGIN, rpId = RP_ID, uv = true } = {}) {
  const flags = 0x01 | (uv ? 0x04 : 0) | 0x40;                 // UP | UV | AT
  const authData = Buffer.concat([sha(rpId), Buffer.from([flags]), counterBuf(0), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, Buffer.from(cose)]);
  const attestationObject = cborEncode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
    response: { clientDataJSON: b64u(clientData('webauthn.create', challenge, origin)), attestationObject: b64u(attestationObject), transports: ['internal'] } };
}
function assertion(challenge, counter, { origin = ORIGIN, rpId = RP_ID, uv = true, tamper = false, handle = userId } = {}) {
  const flags = 0x01 | (uv ? 0x04 : 0);
  const authData = Buffer.concat([sha(rpId), Buffer.from([flags]), counterBuf(counter)]);
  const cd = clientData('webauthn.get', challenge, origin);
  const sig = crypto.sign('sha256', Buffer.concat([authData, sha(cd)]), privateKey);
  if (tamper) sig[sig.length - 1] ^= 0xff;
  return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
    response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig), userHandle: b64u(Buffer.from(handle)) } };
}

// ---- REGISTRATION: exactly the options + verify call shapes used in the edge functions ----
const ropts = await generateRegistrationOptions({
  rpName: 'Umova', rpID: RP_ID, userID: new TextEncoder().encode(userId), userName: 'John — Kamau Properties', userDisplayName: 'John — Kamau Properties',
  attestationType: 'none', excludeCredentials: [],
  authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required', authenticatorAttachment: 'platform' },
});
check('register options: discoverable credential required', ropts.authenticatorSelection.residentKey === 'required' && ropts.authenticatorSelection.userVerification === 'required');
check('register options: user.id round-trips to the account id', Buffer.from(ropts.user.id, 'base64url').toString() === userId);

const bad = async (label, fn) => { try { const v = await fn(); check(label, !v.verified); } catch (e) { const harness = /not well formed|Unexpected end|decode/i.test(e.message); check(label, !harness, e.message.slice(0, 90)); } };
await bad('registration with WRONG origin is rejected', () => verifyRegistrationResponse({ response: attestation(ropts.challenge, { origin: 'https://evil.example' }), expectedChallenge: ropts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }));
await bad('registration WITHOUT biometric (UV off) is rejected', () => verifyRegistrationResponse({ response: attestation(ropts.challenge, { uv: false }), expectedChallenge: ropts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }));
await bad('registration with WRONG challenge is rejected', () => verifyRegistrationResponse({ response: attestation(ropts.challenge), expectedChallenge: 'someOtherChallenge', expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true }));

const reg = await verifyRegistrationResponse({ response: attestation(ropts.challenge), expectedChallenge: ropts.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
check('registration verifies (subdomain origin + parent RP ID)', reg.verified && !!reg.registrationInfo);
const { credential } = reg.registrationInfo;
check('registrationInfo.credential has id/publicKey/counter as the function expects', typeof credential.id === 'string' && credential.publicKey instanceof Uint8Array && credential.counter === 0, `id=${credential.id.slice(0, 8)}…`);
check('credential.id equals the id the browser will send back later', credential.id === b64u(credId));
const stored = { credential_id: credential.id, public_key: b64u(credential.publicKey), counter: credential.counter, transports: ['internal'] };  // what register-verify inserts

// ---- AUTHENTICATION: usernameless, as auth-options/auth-verify do it ----
const verifyAuth = (resp, challenge, cred, over = {}) => verifyAuthenticationResponse({
  response: resp, expectedChallenge: challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
  credential: { id: cred.credential_id, publicKey: unb64u(cred.public_key), counter: Number(cred.counter ?? 0), transports: cred.transports }, ...over });

const aopts = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: [] });
check('usernameless options carry no credential list', !aopts.allowCredentials || aopts.allowCredentials.length === 0);
const ok = await verifyAuth(assertion(aopts.challenge, 1), aopts.challenge, stored);
check('fingerprint assertion verifies; counter advances', ok.verified && ok.authenticationInfo.newCounter === 1);
await bad('TAMPERED signature is rejected', () => verifyAuth(assertion(aopts.challenge, 2, { tamper: true }), aopts.challenge, stored));
await bad('assertion for a DIFFERENT site (rpId hash) is rejected', () => verifyAuth(assertion(aopts.challenge, 2, { rpId: 'other.com' }), aopts.challenge, stored));
await bad('assertion from a WRONG origin is rejected', () => verifyAuth(assertion(aopts.challenge, 2, { origin: 'https://evil.example' }), aopts.challenge, stored));
await bad('assertion WITHOUT biometric (UV off) is rejected', () => verifyAuth(assertion(aopts.challenge, 2, { uv: false }), aopts.challenge, stored));
await bad('assertion for a DIFFERENT challenge (replay) is rejected', () => verifyAuth(assertion('old-challenge', 2), aopts.challenge, stored));
await bad('counter going BACKWARDS (cloned key) is rejected', () => verifyAuth(assertion(aopts.challenge, 1), aopts.challenge, { ...stored, counter: 5 }));
const userHandleOk = Buffer.from(assertion('x', 3).response.userHandle, 'base64url').toString() === userId;
check('userHandle decodes to the account id (the owner check in auth-verify)', userHandleOk);
console.log(results.every(Boolean) ? '\nALL PASSED' : '\nSOME FAILED');
