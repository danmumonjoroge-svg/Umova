# Elimu shell, menu, settings and notifications

```
ElimuAppRoutes (app/routes)
  ElimuShell (app/shell)                 app bar + sidebar + phone tabs + ONE scroll area; pages render in <Outlet/>
    notifications                        app/notifications
    settings/*                           app/settings  (hub + sections)
    *                                    routes.jsx (bare) + every registered module
```

## Menu
`NAV_ITEMS` in `utils/permissions.js` is the only list of entries. `app/navigation/navModel.js` adds grouping and the rules:
an entry shows when its module is registered (or it is a foundation entry), the person holds its action (`anyOf` for several), and, for owner-only entries, is the owner.
The current entry is the one with the longest matching path prefix. Phone tabs are Dashboard / Students / Attendance / Finance when visible; everything else, including Settings, is under **More**.
Hiding an entry is presentation only: every route is still guarded (`RequireElimuAction`) and the database (RLS) decides.

## Adding a module
```js
registerModule({
  key: 'library',                                    // a NAV_ITEMS key
  routes: [<Route key="library" path="library/*" element={...} />],
  settingsSections: [{ key: 'library', element: <LibrarySettings />, action: 'settings.manage' }],      // also add the label/description to SETTINGS_SECTIONS
  notificationProviders: [async ({ can, base }) => [{ id: 'lib-overdue', tone: 'warn', title: '12 overdue books', to: `${base}/library` }]],
});
```
A settings section appears only when its module is registered, a screen was supplied and the person holds the action; opening `/settings/<section>` directly re-checks the action.

## Notifications
Item shape `{ id, tone: 'warn'|'info'|'ok', title, detail?, to? }`. Merged, de-duplicated by id, urgent first. "Seen" ids are remembered per school and person in `localStorage`
(ids only). A failing provider is skipped silently. A notification points at work for a person; it never sends anything.

## Branding
The header shows the school's logo (`lb_businesses.logo_url`, set by the owner under Settings) when it is an http(s) image URL and loads; otherwise the school's initials.

## Hosts
`<ElimuApp base="/school" homeHref="/" />` is the full app. `ElimuRoutes` with the default `bare={false}` still renders the older in-module layout for embedding inside the POS (`ElimuHost.jsx`).

## Known limits
- The notification list is fetched when the app opens and on Refresh; there is no live push.
- Which settings sections exist is a catalog in this folder; a module cannot add a section without a catalog entry (so labels stay consistent).
