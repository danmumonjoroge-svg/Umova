// Run:  node --experimental-default-type=module --test tests/js/
// ENGINE_RENDER=/path/to/pos-erp/supabase/functions/_shared/comm/render.js enables the parity test against the real Umova engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMsisdn, contactFor, isValidEmail, displayPhone } from '../../utils/phone.js';
import { validateStudent, validateGuardian, validateApplication, friendlyError } from '../../utils/validation.js';
import { ageFrom } from '../../utils/format.js';
import { canElimu, ACTION_MAP } from '../../utils/permissions.js';
import { PURPOSES, getPurpose, registerPurpose, isEmergency } from '../../communication/purposes.js';
import { systemTemplate } from '../../communication/templateLibrary.js';
import { render, resolveTemplate, buildVars } from '../../communication/ElimuTemplateResolver.js';
import { eligibility, channelsFor } from '../../communication/consent.js';
import { notificationItems, registerEvent } from '../../communication/notificationCatalog.js';

test('engine parity: normalizeMsisdn / contactFor / isValidEmail', async (t) => {
  if (!process.env.ENGINE_RENDER) return t.skip('set ENGINE_RENDER to compare with the Umova engine');
  const E = await import(process.env.ENGINE_RENDER);
  const samples = ['0712345678', '712345678', '254712345678', '+254 712 345 678', '0112345678', '+14155550100', '0044 20 7946 0958', '12', '', null, 'abc', '0812345678', '2547123456789'];
  for (const s of samples) assert.equal(normalizeMsisdn(s), E.normalizeMsisdn(s), `msisdn ${s}`);
  for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) assert.equal(contactFor(ch, { phone: '0712345678', email: 'a@b.co' }), E.contactFor(ch, { phone: '0712345678', email: 'a@b.co' }));
  for (const e of ['a@b.co', 'bad@', ' x@y.zz ']) assert.equal(isValidEmail(e), E.isValidEmail(e));
});

test('phone helpers', () => {
  assert.equal(normalizeMsisdn('0712 345 678'), '254712345678');
  assert.equal(contactFor('SMS', { phone: '0712345678' }), '+254712345678');
  assert.equal(contactFor('WHATSAPP', { phone: '0712345678' }), '254712345678');
  assert.equal(contactFor('CALL', { phone: '0712345678' }), '+254712345678');
  assert.equal(contactFor('SMS', { phone: '123' }), null);
  assert.equal(displayPhone('254712345678'), '0712 345 678');
});

test('validation', () => {
  assert.equal(validateStudent({ first_name: 'A', last_name: 'B' }).ok, true);
  assert.equal(validateStudent({ first_name: '', last_name: 'B' }).ok, false);
  assert.equal(validateStudent({ first_name: 'A', last_name: 'B', date_of_birth: '2999-01-01' }).ok, false);
  assert.equal(validateStudent({ first_name: 'A', last_name: 'B', photo_path: 'https://x/y.jpg' }).ok, false);
  assert.equal(validateGuardian({ first_name: 'G', last_name: 'H', contacts: [{ kind: 'PHONE', value: '12' }] }).ok, false);
  assert.equal(validateApplication({ student: { first_name: 'A', last_name: 'B' } }).errors.requested_class_id, 'Choose the class applied for.');
  assert.match(friendlyError(new Error('Failed to fetch')), /No internet/);
});

test('age', () => { assert.equal(ageFrom('2016-03-02', new Date('2026-03-01')), 9); assert.equal(ageFrom('2016-03-02', new Date('2026-03-02')), 10); assert.equal(ageFrom(null), null); });

test('permissions: dual mode and closed for unknown', () => {
  const only = (...keys) => (k) => keys.includes(k);
  assert.equal(canElimu(only('students.view'), 'students.view'), true);
  assert.equal(canElimu(only('students.view'), 'students.manage'), false);
  assert.equal(canElimu(only('students.manage'), 'students.manage'), true);
  assert.equal(canElimu(() => true, 'nonsense.action'), false);                        // unknown action: closed
  assert.equal(canElimu(only('operations.use'), 'students.view'), false);              // a POS key no longer grants anything
  assert.ok(Object.keys(ACTION_MAP).length >= 15);
});

test('purposes: 15, each has a system template for every channel', () => {
  assert.equal(PURPOSES().length, 15);
  for (const p of PURPOSES()) for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
    const t = systemTemplate(p.key, ch); assert.ok(t && t.body, `${p.key}/${ch}`);
    if (ch === 'EMAIL') assert.ok(t.subject, `${p.key} subject`);
    // every merge field used by the template must be a declared field of the purpose
    for (const [, f] of (t.body + (t.subject || '')).matchAll(/\{\{(\w+)\}\}/g)) assert.ok(p.fields.includes(f), `${p.key} uses undeclared {{${f}}}`);
  }
  assert.equal(isEmergency('ELIMU_EMERGENCY'), true);
  assert.equal(isEmergency('ELIMU_GENERAL_NOTICE'), false);
  assert.throws(() => registerPurpose({ key: 'BAD' }));
  registerPurpose({ key: 'ELIMU_TEST_ONLY', label: 'x' }); assert.ok(getPurpose('ELIMU_TEST_ONLY'));
  assert.throws(() => registerPurpose({ key: 'ELIMU_TEST_ONLY', label: 'x' }));
});

test('template resolver: three levels, missing fields reported', () => {
  const vars = buildVars({ guardian: { first_name: 'Grace' }, student: { first_name: 'Amina', preferred_name: 'Mina' }, school: { name: 'Sunrise Academy' } });
  const sys = resolveTemplate({ purpose: 'ELIMU_ADMISSION_RECEIVED', channel: 'SMS', vars });
  assert.equal(sys.source, 'SYSTEM'); assert.match(sys.body, /Dear Grace/); assert.match(sys.body, /Mina/); assert.deepEqual(sys.missing, ['application_no']);
  const own = resolveTemplate({ purpose: 'ELIMU_ADMISSION_RECEIVED', channel: 'SMS', vars: { ...vars, application_no: 'APP-1' }, overrides: [{ id: 't1', purpose: 'ELIMU_ADMISSION_RECEIVED', channel: 'SMS', body: 'Hi {{guardian_name}}, ref {{application_no}}.', is_active: true }] });
  assert.equal(own.source, 'BUSINESS'); assert.equal(own.templateId, 't1'); assert.equal(own.body, 'Hi Grace, ref APP-1.');
  const wa = resolveTemplate({ purpose: 'ELIMU_WELCOME', channel: 'WHATSAPP', vars, overrides: [{ id: 't2', purpose: 'ELIMU_WELCOME', channel: 'SMS', body: 'SMS text {{school_name}}' }] });
  assert.equal(wa.source, 'BUSINESS');   // WhatsApp falls back to the school's SMS override
  const em = resolveTemplate({ purpose: 'ELIMU_GENERAL_NOTICE', channel: 'EMAIL', vars: { ...vars, message: 'School closes early.' } });
  assert.match(em.subject, /Sunrise Academy/); assert.match(em.body, /Kind regards,\nSunrise Academy/);
  assert.throws(() => resolveTemplate({ purpose: 'NOPE', channel: 'SMS' }));
  assert.equal(render('A {{x}} B', {}).text, 'A B');
});

const grace = (consent = [], contacts) => ({ contacts: contacts || [{ id: 'c1', kind: 'PHONE', value: '0712345678', is_primary: true, is_whatsapp: false }, { id: 'c2', kind: 'EMAIL', value: 'g@x.co', is_primary: true }], consent });
test('consent / eligibility', () => {
  assert.equal(eligibility({ guardian: grace(), channel: 'SMS', purpose: 'ELIMU_GENERAL_NOTICE' }).ok, true);
  const out = grace([{ channel: 'SMS', status: 'OPTED_OUT' }]);
  assert.equal(eligibility({ guardian: out, channel: 'SMS', purpose: 'ELIMU_GENERAL_NOTICE' }).ok, false);
  assert.equal(eligibility({ guardian: out, channel: 'EMAIL', purpose: 'ELIMU_GENERAL_NOTICE' }).ok, true);
  const em = eligibility({ guardian: out, channel: 'SMS', purpose: 'ELIMU_EMERGENCY' }); assert.equal(em.ok, true); assert.equal(em.override, true);
  assert.equal(eligibility({ guardian: grace(), channel: 'SMS', purpose: 'ELIMU_GENERAL_NOTICE', settings: { require_explicit_consent: true } }).ok, false);
  assert.equal(eligibility({ guardian: grace([{ channel: 'SMS', status: 'ALLOWED' }]), channel: 'SMS', purpose: 'ELIMU_GENERAL_NOTICE', settings: { require_explicit_consent: true } }).ok, true);
  assert.equal(eligibility({ guardian: grace([], []), channel: 'SMS', purpose: 'ELIMU_GENERAL_NOTICE' }).reason, 'No phone number on record.');
  assert.equal(eligibility({ guardian: grace([{ channel: 'PHONE', status: 'OPTED_OUT' }]), channel: 'CALL', purpose: 'ELIMU_GENERAL_NOTICE' }).ok, false);
  assert.equal(channelsFor({ guardian: grace(), purpose: 'ELIMU_GENERAL_NOTICE' }).length, 4);
  const wa = eligibility({ guardian: grace([], [{ id: 'a', kind: 'PHONE', value: '0711111111', is_primary: true }, { id: 'b', kind: 'PHONE', value: '0722222222', is_whatsapp: true }]), channel: 'WHATSAPP', purpose: 'ELIMU_GENERAL_NOTICE' });
  assert.equal(wa.contact.id, 'b');   // a WhatsApp-flagged number beats the primary one
});

test('notification items', () => {
  const items = notificationItems({ summary: { data_quality: { STUDENT_NO_GUARDIAN: 3 }, applications_by_category: { SUBMITTED: 2 } }, queue: [{}] });
  assert.equal(items.length, 3);
  assert.throws(() => registerEvent('bad', {}));
});

import { readStatement, matchStatement } from '../../finance/utils/statementImport.js';
test('statement import: parse and match', () => {
  const csv = 'Account,KCB\nDate,Narrative,Debit,Credit\n03/11/2026,"MPESA QWE123ABC, JOHN",,"15,000.00"\n04/11/2026,Bank charge,50.00,\n05/11/2026,Cheque dep,,8000\n05/11/2026,Cheque dep 2,,8000\n09/11/2026,Unknown,,999.50\n';
  const { lines, problems } = readStatement(csv);
  assert.equal(problems.length, 0); assert.equal(lines.length, 4); assert.equal(lines[0].cents, 1500000); assert.equal(lines[0].date, '2026-11-03');
  const pay = [
    { payment_id: 'a', amount: 1500000, transaction_ref: 'QWE123ABC', payment_date: '2026-11-03' },
    { payment_id: 'b', amount: 800000, transaction_ref: null, payment_date: '2026-11-05' },
    { payment_id: 'c', amount: 800000, transaction_ref: null, payment_date: '2026-11-05' },
    { payment_id: 'd', amount: 123, transaction_ref: null, payment_date: '2026-11-05' }];
  const m = matchStatement(lines, pay);
  assert.equal(m.matches.a, 0); assert.ok(m.matches.b !== undefined && m.matches.c !== undefined && m.matches.b !== m.matches.c);
  assert.equal(m.matches.d, undefined); assert.deepEqual(m.unmatchedLines, [3]); assert.equal(m.total, 1500000 + 800000 * 2 + 99950);
  assert.equal(readStatement('foo,bar\n1,2').problems.length, 1);
});
