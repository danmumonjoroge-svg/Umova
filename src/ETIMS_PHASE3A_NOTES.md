# eTIMS Phase 3a — setup screen (spec-independent part)
New: hooks/useEtims.js, components/EtimsSetupCard.jsx. Changed: pages/SettingsPage.jsx (1 import, 1 card entry, 1 render line).
Needs phase48 run first. Saves PIN/branch/device/mode through pos_etims_save_profile (settings.manage). No KRA calls.
NOT built (needs KRA Technical Specifications v2.0): etims-initialize, etims-sync-codes, etims-register-item, secrets storage.

## Phase 3a-2 — per-business key storage + shared tenant helper (no KRA calls)
New: schema/phase49_etims_secrets.sql, supabase/functions/_shared/etims.ts. Run phase48 then phase49 on STAGING.
Tested on scratch PG16: re-runnable; business A's key never returned for business B (NULL); rotation works; signed-in role denied.
NOT tested: Vault branch (scratch DB has no Vault), the TypeScript (no Deno here).
Set secret ETIMS_ALLOWED_ORIGINS (comma-separated app origins) before the functions are used from a browser; unset = blocked.
Still waiting on the KRA spec: etims-initialize / etims-sync-codes / etims-register-item.

## Phase 3b — KRA-facing functions (built from KRA "OSCU Specification Document v2.0", read via the KRA PDF)
New functions (deploy each with `supabase functions deploy <name> --use-api`; JWT verification stays ON): etims-initialize, etims-sync-codes, etims-register-item.
Changed: services/etimsService.js (adds connect, syncCodes, registerItem), components/EtimsSetupCard.jsx (Connect / Download lists buttons), schema/phase49 (blank PIN keeps saved PIN).
Facts used from the spec: base /etims-api, JSON body-only auth (tin 11, bhfId 2, dvcSrlNo, cmcKey), /selectInitOsdcInfo, /selectCodeList, /selectItemClsList, /saveItem, resultCd 000 = success.
Verify in the SANDBOX (spec text was incomplete or inconsistent): where cmcKey sits in the response (code accepts data.info.cmcKey or data.cmcKey); first lastReqDt value; 902 "device already installed" handling; whether tax B is 16% (4.1) or 18% (samples).
Set secret ETIMS_ALLOWED_ORIGINS to the app origin(s) (comma-separated); native app origin too (e.g. https://localhost, capacitor://localhost) or calls are blocked.
Tested: SQL on scratch PG16 (phase48 49/49 still pass with phase49 applied). NOT tested: the Deno functions (no Deno here) and any real KRA call.
Nothing sends invoices: lb_etims_config.enabled stays false.
