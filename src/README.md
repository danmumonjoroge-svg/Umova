# Fingerprint sign-in — SACCO app, My Business (POS), Chama

One set of Edge Functions + one pair of tables serves all three apps. Each app gets the same small client and its own button.

## What was missing / wrong before
1. `webauthn-register-verify` did not exist — "Set up on this device" could never finish, so no account could ever hold a passkey.
2. No SQL for `webauthn_credentials` / `webauthn_challenges` anywhere.
3. Sign-in returned a `hashed_token` but the client passed it as `token` (that field wants the 6-digit code). Now `token_hash`.
4. No CORS handling in any function (browser calls with an Authorization header are pre-flighted).
5. One fixed `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID` — impossible for three apps on three sites.
6. POS and Chama had no fingerprint code at all. Chama doesn't even use Supabase Auth (own `chama_users` + `authenticate_user`).

## Deploy (in this order)
1. **SQL** — run `sql/webauthn_passkeys.sql` in the Supabase SQL editor. Safe on a project that already has the old tables; re-runnable.
2. **Secrets** (Project Settings → Edge Functions → Secrets):
   - `WEBAUTHN_ORIGINS` = exact origins of every app, comma separated, e.g.
     `https://sacco.umova.app,https://business.umova.app,https://chama.umova.app,http://localhost:3000`
   - `WEBAUTHN_RP_IDS` = e.g. `umova.app,localhost`
   - If the apps live under one parent domain, use that parent as the RP ID. **It can never be changed later** — a passkey is bound to it forever.
   - Passkeys need HTTPS (localhost is exempt). They will not work on a plain `http://` IP address.
3. **Deploy the five functions** (copy the whole `supabase/functions` folder, including `_shared`):
   `webauthn-register-options`, `webauthn-register-verify`, `webauthn-auth-options`, `webauthn-auth-verify`, `webauthn-manage`
4. **Apps**: `npm install @simplewebauthn/browser` in each, then copy the files in `src/`, `pos-erp/`, `chama-erp-advanced/` over the matching paths.
   (`passkeyClient.js` is the same file in all three; `.env` already has `REACT_APP_SUPABASE_URL/KEY`.)

## Where the buttons are
| App | Log in with fingerprint | Set up / manage devices |
|---|---|---|
| SACCO member app | existing button on UnifiedLogin (unchanged) | Security page (existing `PasskeySettings`) |
| My Business / POS | new button on POSLogin | Settings → "Fingerprint sign-in" |
| Chama | new button on LoginPhone | More → "Fingerprint login" |

## How it behaves
- **Setup is once per device, after a normal login.** Nobody can enrol a fingerprint without already proving who they are.
  Chama has no server session, so it asks for the password again to enrol or list/remove devices.
- **Sign-in types nothing.** The phone offers the saved account, the fingerprint/face check identifies the person.
  The fingerprint check is mandatory on both sides (`userVerification: required`) — holding an unlocked phone is not enough.
- **Same gates as a password.** SACCO: inactive/suspended `users`/`members` are refused. POS: after sign-in `get_pos_profile()` still rejects pending/suspended businesses and forces a password change if flagged. Chama: inactive `chama_users` refused, license checks run as before. Banned Supabase users are refused.
- **Challenges are single-use and expire in 5 minutes.** A failed attempt can't be retried against the same challenge.

## Tested here
`tests/webauthn_flow.test.mjs` runs a software fingerprint authenticator against the SAME `@simplewebauthn/server` calls the functions make:
registration verifies; sign-in verifies and the counter advances; and these are all rejected: wrong origin, wrong site, tampered signature,
biometric not performed, replayed/different challenge, counter going backwards. (`node tests/webauthn_flow.test.mjs` after `npm i @simplewebauthn/server@14`.)
The SQL was run on a scratch PostgreSQL: fresh, over the legacy tables (FK to auth.users dropped, old rows kept), and twice in a row.

## NOT tested (needs your project)
- The Edge Functions themselves under Deno/Supabase (no Deno here), and the real phone prompt.
- `generateLink` + `verifyOtp({ token_hash })` against your GoTrue. Requires the Email provider to be enabled in Auth settings (no email is sent).
- Accounts with no email can't use passkey sign-in on the Supabase side (POS logins use a synthetic email, which is fine).

## Things worth knowing
- Chama sessions are client-side only (no server session), as before. A fingerprint login there is exactly as strong as the password login it replaces — no stronger.
  `get_user_memberships(user_id)` is callable without proof of identity; worth locking down separately.
- No rate limiting on the public auth-options/auth-verify endpoints beyond Supabase's own. Add one before a large rollout.
- When someone's password is reset or their account is disabled, their saved devices keep working (except for disabled/banned accounts). Remove devices from the settings card if a phone is lost.
- Max 10 devices per account.
