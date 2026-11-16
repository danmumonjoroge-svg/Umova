// Pure tests of the Elimu shell models: menu, settings catalog, notifications, branding, registry extras.
//   node --experimental-default-type=module --test elimu/tests/app/app_nav.test.mjs     (from the POS folder)
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_ITEMS } from '../../utils/permissions.js';
import { NAV_GROUPS, PRIMARY_TABS, visibleNav, groupNav, pinnedNav, splitTabs, navHref, isActive, activeItem } from '../../app/navigation/navModel.js';
import { SETTINGS_SECTIONS, visibleSettings, findSection } from '../../app/navigation/settingsRegistry.js';
import { mergeNotifications, unseenCount, badgeText, seenKey, collectNotifications } from '../../app/notifications/notificationBus.js';
import { schoolInitials, safeLogoUrl } from '../../app/shell/branding.js';
import { registerModule, settingsSections, notificationProviders, registeredKeys } from '../../registry.js';

const ALL_MODULES = new Set(NAV_ITEMS.map((n) => n.key));
const keys = (items) => items.map((n) => n.key);
const owner = visibleNav({ can: () => true, isOwner: true, modules: ALL_MODULES });

test('menu: every catalog entry is placed in exactly one group or pinned; nothing is lost', () => {
  const grouped = groupNav(owner).flatMap((g) => g.items); const pinned = pinnedNav(owner);
  assert.deepEqual([...keys(grouped), ...keys(pinned)].sort(), keys(owner).sort());
  assert.equal(new Set(keys(grouped)).size, grouped.length);
  assert.deepEqual(keys(pinned), ['settings']);
  assert.deepEqual(groupNav(owner).map((g) => g.key), NAV_GROUPS.map((g) => g.key), 'an owner sees every group, in order');
});
test('menu: owner sees everything incl. Staff and Settings; a teacher sees only what her actions allow', () => {
  assert.ok(keys(owner).includes('staff') && keys(owner).includes('settings'));
  const teacher = visibleNav({ can: (a) => ['students.view', 'structure.view', 'guardians.view'].includes(a), isOwner: false, modules: ALL_MODULES });
  assert.ok(keys(teacher).includes('students') && keys(teacher).includes('classes'));
  for (const k of ['staff', 'settings', 'fees', 'admissions', 'communication', 'gate']) assert.ok(!keys(teacher).includes(k), `${k} hidden`);
  assert.deepEqual(visibleNav({ can: () => false, isOwner: false, modules: ALL_MODULES }), [], 'no actions, no menu');
});
test('menu: a module that is not registered shows no entry (owned foundation entries stay)', () => {
  const some = visibleNav({ can: () => true, isOwner: true, modules: new Set(['attendance']) });
  assert.ok(keys(some).includes('attendance') && keys(some).includes('students') && !keys(some).includes('fees') && !keys(some).includes('academics'));
});
test('menu: finance shows for any finance action (anyOf)', () => {
  assert.ok(keys(visibleNav({ can: (a) => a === 'finance.collect', modules: ALL_MODULES })).includes('fees'));
  assert.ok(!keys(visibleNav({ can: (a) => a === 'finance.nothing', modules: ALL_MODULES })).includes('fees'));
});
test('menu: phone tabs are the primary four (when visible); the rest, incl. Settings, go under More', () => {
  const { tabs, rest } = splitTabs(owner);
  assert.deepEqual(keys(tabs), PRIMARY_TABS.filter((k) => keys(owner).includes(k)));
  assert.equal(tabs.length + rest.length, owner.length); assert.ok(keys(rest).includes('settings'));
  assert.equal(splitTabs([]).tabs.length, 0);
});
test('menu: hrefs and active entry (longest prefix wins; dashboard only on the base; `also` prefixes count)', () => {
  const by = Object.fromEntries(owner.map((n) => [n.key, n]));
  assert.equal(navHref(by.dashboard, '/school'), '/school'); assert.equal(navHref(by.students, '/school/'), '/school/students');
  const at = (p) => activeItem(owner, p, '/school')?.key;
  assert.equal(at('/school'), 'dashboard'); assert.equal(at('/school/'), 'dashboard'); assert.equal(at('/school/dashboard'), 'dashboard');
  assert.equal(at('/school/students'), 'students'); assert.equal(at('/school/students/abc'), 'students');
  assert.equal(at('/school/finance'), 'fees'); assert.equal(at('/school/school-finance/collect'), 'fees', 'also-prefix');
  assert.equal(at('/school/settings/finance'), 'settings'); assert.equal(at('/school/unknown'), undefined);
  assert.equal(at('/school/studentsX'), undefined, 'a prefix must end at a path boundary');
  assert.equal(isActive(by.students, '/elimu/students', '/elimu'), true); assert.equal(isActive(by.students, '/school/students', '/elimu'), false);
});
test('settings catalog: unique keys, real actions, every entry has label and description', () => {
  assert.equal(new Set(SETTINGS_SECTIONS.map((s) => s.key)).size, SETTINGS_SECTIONS.length);
  for (const s of SETTINGS_SECTIONS) assert.ok(s.label && s.description && s.module && /^[a-z]+\.[a-z]+$/.test(s.action), s.key);
  assert.equal(findSection('finance').action, 'finance.configure'); assert.equal(findSection('nope'), null);
});
test('settings: a section shows only when its module is registered, supplied a screen, and the action is held', () => {
  const all = new Set(SETTINGS_SECTIONS.map((s) => s.key)); const mods = new Set(SETTINGS_SECTIONS.map((s) => s.module));
  assert.equal(visibleSettings({ can: () => true, modules: mods, supplied: all }).length, SETTINGS_SECTIONS.length);
  assert.deepEqual(visibleSettings({ can: () => false, modules: mods, supplied: all }), []);
  assert.deepEqual(visibleSettings({ can: (a) => a === 'finance.configure', modules: mods, supplied: all }).map((s) => s.key), ['finance']);
  assert.equal(visibleSettings({ can: () => true, modules: new Set(['foundation']), supplied: all }).map((s) => s.key).join(), 'school');
  assert.deepEqual(visibleSettings({ can: () => true, modules: mods, supplied: new Set() }), [], 'no screen supplied, no section');
});
test('notifications: merged, de-duplicated, malformed dropped, urgent first and stable', () => {
  const out = mergeNotifications([{ id: 'a', title: 'A', tone: 'info' }, { id: 'b', title: 'B', tone: 'warn' }, null, { title: 'no id' }, { id: 'c' }], [{ id: 'a', title: 'dup' }, { id: 'd', title: 'D', tone: 'ok' }, { id: 'e', title: 'E', tone: 'weird' }, { id: 'f', title: 'F', tone: 'info' }]);
  assert.deepEqual(out.map((i) => i.id), ['b', 'a', 'e', 'f', 'd']); assert.equal(out.find((i) => i.id === 'a').title, 'A', 'first wins'); assert.equal(out.find((i) => i.id === 'e').tone, 'info');
});
test('notifications: unseen count, badge text and per-person key', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(unseenCount(items, new Set(['a'])), 2); assert.equal(unseenCount(items, ['a', 'b', 'c']), 0); assert.equal(unseenCount(items, undefined), 3);
  assert.deepEqual([0, 5, 99, 100].map(badgeText), ['', '5', '99', '99+']);
  assert.notEqual(seenKey('s1', 'u1'), seenKey('s1', 'u2')); assert.equal(seenKey(null, null), 'elimu:notif-seen:-:-');
});
test('notifications: one failing provider never hides the others', async () => {
  const out = await collectNotifications([async () => [{ id: 'x', title: 'X' }], async () => { throw new Error('boom'); }, () => [{ id: 'y', title: 'Y', tone: 'warn' }], null].filter(Boolean), {});
  assert.deepEqual(out.map((i) => i.id), ['y', 'x']); assert.deepEqual(await collectNotifications(undefined, {}), []);
});
test('branding: initials and logo URL safety', () => {
  assert.equal(schoolInitials('Sunrise Academy'), 'SA'); assert.equal(schoolInitials('The Kenya High School'), 'KH'); assert.equal(schoolInitials('Moi'), 'M'); assert.equal(schoolInitials(''), 'E'); assert.equal(schoolInitials(null), 'E');
  assert.equal(safeLogoUrl('https://x.co/a.png'), 'https://x.co/a.png'); for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//x.co/a.png', '', null, 5]) assert.equal(safeLogoUrl(bad), null, String(bad));
});
test('registry: modules can supply settings sections and notification providers', () => {
  const p = async () => []; registerModule({ key: 'zz-test', settingsSections: [{ key: 'zz', element: null, action: 'x.y' }], notificationProviders: [p] });
  assert.ok(settingsSections().some((s) => s.key === 'zz')); assert.ok(notificationProviders().includes(p)); assert.ok(registeredKeys().has('zz-test'));
  registerModule({ key: 'zz-plain' }); assert.ok(registeredKeys().has('zz-plain'), 'a module with no extras still registers');
});
