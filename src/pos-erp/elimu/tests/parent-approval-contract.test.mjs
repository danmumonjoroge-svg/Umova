import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('parent OTP verification does not create or approve a guardian/student link', async () => {
  const source = await read('parent/ParentApp.jsx');
  const verify = source.slice(source.indexOf('const verify = async'), source.indexOf('return (', source.indexOf('const verify = async')));
  assert.match(verify, /verifyOtp\(/);
  assert.doesNotMatch(verify, /elimu_parent_link|guardianService\.link|student_guardians|rpc\([^)]*(?:link|approve)/i);
});

test('parent data discovery and child reads remain behind parent RPCs', async () => {
  const source = await read('parent/parentClient.js');
  assert.match(source, /children:\s*\(\)\s*=>\s*rpc\('elimu_parent_children'\)/);
  for (const name of ['elimu_parent_attendance', 'elimu_parent_results', 'elimu_parent_calendar', 'elimu_parent_fees']) {
    assert.ok(source.includes(name), `missing expected parent read RPC ${name}`);
  }
  assert.doesNotMatch(source, /elimu_parent_link/);
});

test('unlinked parent state explains school verification and protects OTP secrecy', async () => {
  const source = await read('parent/ParentApp.jsx');
  assert.match(source, /School approval required/);
  assert.match(source, /Never share your one-time sign-in code/);
  assert.match(source, /Phone verification alone does not grant access/);
});
