# Elimu authentication and session

Elimu owns the sign-in **experience** and the **session** the app reads. Verifying credentials and holding the identity is shared Umova
infrastructure (`POSAuthProvider`), reached through one adapter. There is no POS login or POS dashboard in the Elimu path.

```
POSAuthProvider            shared identity state machine (no UI)
  ElimuAuthProvider        builds the ElimuSession: school, user, role, permissions        app/auth/
    ElimuAuthGate          sign-in / register / waiting / new-password screens             auth/
      ElimuLock            inactivity PIN lock (shared security component)
        Shell + routes
```

## Session

`useElimuSession()` returns:

| Field | Meaning |
|---|---|
| `status` | `loading` · `signed_out` · `blocked` · `authenticated`. Only `authenticated` opens the app. |
| `stage` | The host stage it came from (`checking`, `logged_out`, `pending`, `rejected`, `suspended`, `must_change_password`, `authenticated`). |
| `school` | `{ id, businessId, code, name, timeZone }`. One school per session; the code is shown exactly as stored. |
| `user` | `{ id, name, kind, isOwner, role, roleLabel }`. |
| `permissions` | `{ can(action), isOwner, loaded, roles }` from `elimu_my_access`. Empty unless authenticated; a non-owner holds nothing until access has loaded. |
| `problem` | `{ code, detail }` when blocked (`SCHOOL_PENDING`, `SCHOOL_REJECTED`, `SCHOOL_SUSPENDED`, `MUST_CHANGE_PASSWORD`). |
| `notice`, `offline`, `signOut()` | One-shot message for the sign-in screen; saved-sign-in/no-internet flag; sign out. |

Safety rules (tested): an unknown stage never opens the app; an authenticated account that is not staff, or has no school, is treated as signed out;
blocked sessions never carry permissions. Hiding a screen is presentation only: routes are guarded by `RequireElimuAction` and the database (RLS) still decides.

## Sign-in

School code + user ID + password. Spaces are removed from the code but case and hyphens are kept (the host looks it up as typed: `TEST-01`, `DEMOSCH`, `2201`).
The password is never trimmed. Failures become `ElimuAuthError` with a code from `AUTH_ERROR`; an unknown user and a wrong password give the same message.
After three wrong passwords the button waits 2, 4, 8 ... seconds (max 60). This is a courtesy brake; the server remains the real limiter.
The last school code is remembered on the device (localStorage; nothing secret).

## Adapter contract (`app/auth/authAdapter.js`)

```
adapter  = { id, useIdentity() }
Identity = { stage, school, user: { id, name, kind: 'staff'|'guardian'|'student', isOwner }, statusDetail, logoutNotice, offline,
             signIn({ schoolCode, identifier, password }) /* throws ElimuAuthError */, signOut() }
```
`<ElimuApp adapter={...} />` swaps the identity source (for example a future parent/student login) without touching screens.
`hostAdapter.js` is the default and the only file in `app/auth/` that imports the host (through `services/platform.js`).

## Not in this step

The shell, menu, settings hub and notifications are in `SHELL.md`. Register still uses the shared `signup`.
Known limit: the host `login(code, username, password)` returns only a reason code, so the lock-out / rate limit itself is the server's.
