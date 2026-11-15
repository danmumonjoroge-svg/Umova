// M-Pesa till rework (phase 39). Run from src/pos-erp:   node --test tests/mpesa_till.test.mjs
// Pure helpers only (no React, no network, no Daraja): these are MOCKED/UNIT checks, not a sandbox or live STK Push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mpesaPanelState, resolveMpesa, normalizeMpesaCode, isValidMpesaCode } from '../utils/mpesa.js';
import { resolveEnabledMethods, ALL_TILL_METHODS } from '../utils/paymentMethods.js';

const FULL = { is_active: true, has_consumer_key: true, has_consumer_secret: true, has_passkey: true };

test('1/3: M-Pesa stays selectable whatever Daraja looks like (availability takes no Daraja input)', () => {
  // resolveEnabledMethods has no config parameter at all: the only input is the owner's saved setting.
  assert.equal(resolveEnabledMethods.length, 1);
  assert.ok(resolveEnabledMethods(undefined).includes('MOBILE_MONEY'));
  assert.ok(resolveEnabledMethods(['CASH', 'MOBILE_MONEY']).includes('MOBILE_MONEY'));
});

test('an owner who switched M-Pesa off is respected, but never left with nothing', () => {
  assert.deepEqual(resolveEnabledMethods(['CASH', 'CARD']), ['CASH', 'CARD']);
  assert.deepEqual(resolveEnabledMethods([]), ALL_TILL_METHODS);
  assert.deepEqual(resolveEnabledMethods(['BANK']), ALL_TILL_METHODS); // nothing the till can use
});

test('1/2/3: no / disabled / half-finished Daraja: only Prompt is off, with a short reason; manual stays', () => {
  for (const config of [null, { ...FULL, is_active: false }, { ...FULL, has_passkey: false }]) {
    const s = mpesaPanelState({ isOnline: true, config });
    assert.equal(s.promptDisabledReason, 'not_setup');
    assert.match(s.message, /prompts are unavailable\. You can still record a manual M-Pesa payment/);
  }
});

test('4: configured + online + idle: Prompt is available', () => {
  const s = mpesaPanelState({ isOnline: true, config: FULL });
  assert.equal(s.promptDisabledReason, null);
  assert.equal(s.stkStatus, 'ready');
});

test('16: offline: Prompt blocked with an internet message, manual still offered', () => {
  const s = mpesaPanelState({ isOnline: false, config: FULL });
  assert.equal(s.promptDisabledReason, 'offline');
  assert.match(s.message, /internet/i);
  assert.match(s.message, /manual M-Pesa payment/);
});

test('5: a sent/accepted prompt is PENDING, never paid; the button locks while it is live', () => {
  for (const phase of ['sending', 'pending']) {
    const s = mpesaPanelState({ isOnline: true, config: FULL, phase });
    assert.equal(s.promptDisabledReason, 'busy');
    assert.doesNotMatch(s.message, /confirmed/i);
  }
  assert.match(mpesaPanelState({ isOnline: true, config: FULL, phase: 'pending' }).message, /Waiting/);
});

test('6: confirmed shows the confirmed message and no further prompt', () => {
  const s = mpesaPanelState({ isOnline: true, config: FULL, phase: 'paid' });
  assert.equal(s.promptDisabledReason, 'paid');
  assert.match(s.message, /confirmed/i);
});

test('7/8: failed or cancelled: not paid; a cancel may be re-prompted, manual code is offered', () => {
  const failed = mpesaPanelState({ isOnline: true, config: FULL, phase: 'failed', txStatus: 'FAILED' });
  assert.equal(failed.promptDisabledReason, null);
  assert.match(failed.message, /enter a manual M-Pesa code/);
  const cancelled = mpesaPanelState({ isOnline: true, config: FULL, phase: 'failed', txStatus: 'CANCELLED' });
  assert.match(cancelled.message, /cancelled/);
  assert.equal(cancelled.promptDisabledReason, null);
});

test('9: a timeout is UNCERTAIN, not "did not pay": no second prompt, and it says a late confirmation is still recorded', () => {
  for (const txStatus of ['TIMED_OUT', 'NEEDS_ATTENTION']) {
    const s = mpesaPanelState({ isOnline: true, config: FULL, phase: 'failed', txStatus });
    assert.equal(s.promptDisabledReason, 'uncertain');
    assert.match(s.message, /late confirmation/);
    assert.doesNotMatch(s.message, /nothing was charged/i);
  }
});

test('prompt preconditions: whole shillings and a phone number', () => {
  assert.equal(mpesaPanelState({ isOnline: true, config: FULL, whole: false }).promptDisabledReason, 'cents');
  assert.equal(mpesaPanelState({ isOnline: true, config: FULL, hasPhone: false }).promptDisabledReason, 'no_phone');
});

test('code format: forgiving but not empty; typed codes are normalised', () => {
  assert.equal(normalizeMpesaCode(' shk-7x9 abcd '), 'SHK7X9ABCD');
  assert.ok(isValidMpesaCode('SHK7X9ABCD'));
  assert.ok(isValidMpesaCode('RGH12345'));        // 8
  assert.ok(isValidMpesaCode('QWERTY123456'));    // 12
  assert.ok(!isValidMpesaCode('ABC123'));         // too short
  assert.ok(!isValidMpesaCode(''));
});

test('existing readiness rule is unchanged (still used by the older offline checks)', () => {
  assert.equal(resolveMpesa({ isOnline: true, config: FULL }).effectiveMode, 'PROMPT');
  assert.equal(resolveMpesa({ isOnline: true, config: null }).effectiveMode, 'MANUAL');
});
