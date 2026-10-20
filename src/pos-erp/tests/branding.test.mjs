// Run: node --test tests/branding.test.mjs   (from src/pos-erp)
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLogoUrl, businessInitials } from '../utils/branding.js';
import { sniffImageType, validateLogoBytes, validateLogoDimensions, computeOutputSize, LOGO_RULES } from '../utils/logoImage.js';

const B1 = '11111111-1111-1111-1111-111111111111';
const B2 = '22222222-2222-2222-2222-222222222222';
const base = 'https://x.supabase.co/storage/v1/object/public/business-logos';

const PNG = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, 0,0,0,0]);
const JPG = Uint8Array.from([0xff,0xd8,0xff,0xe0, 0,0]);
const enc = (s) => new TextEncoder().encode(s);

test('safeLogoUrl accepts own-bucket URL for own business', () => {
  assert.ok(safeLogoUrl(`${base}/${B1}/logo.png?v=1`, B1));
  assert.ok(safeLogoUrl(`${base}/${B1}/logo.png`));
});
test('safeLogoUrl rejects another business folder', () => {
  assert.equal(safeLogoUrl(`${base}/${B2}/logo.png`, B1), null);
  assert.equal(safeLogoUrl(`${base}/${B1}x/logo.png`, B1), null);
});
test('safeLogoUrl rejects external, other-bucket, non-https and junk', () => {
  for (const u of [
    'https://evil.example/pixel.png',
    'https://x.supabase.co/storage/v1/object/public/other-bucket/a.png',
    'http://x.supabase.co/storage/v1/object/public/business-logos/a/logo.png',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, undefined, 42,
  ]) assert.equal(safeLogoUrl(u), null, String(u));
});
test('safeLogoUrl allows http only on localhost', () => {
  assert.ok(safeLogoUrl(`http://localhost:54321/storage/v1/object/public/business-logos/${B1}/logo.png`, B1));
});

test('initials', () => {
  assert.equal(businessInitials('Mama Njeri Hardware'), 'MN');
  assert.equal(businessInitials('Kibanda'), 'KI');
  assert.equal(businessInitials(''), 'MB');
  assert.equal(businessInitials(null), 'MB');
});

test('sniff decides from bytes, not names', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPG), 'image/jpeg');
  assert.equal(sniffImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffImageType(enc('<?xml version="1.0"?><SVG>')), 'svg');
  assert.equal(sniffImageType(enc('GIF89a....')), null);
  assert.equal(sniffImageType(enc('<html><script>alert(1)</script>')), null);
  assert.equal(sniffImageType(new Uint8Array([])), null);
});
test('validateLogoBytes: size, svg, unknown', () => {
  assert.equal(validateLogoBytes(PNG).ok, true);
  assert.equal(validateLogoBytes(JPG).ok, true);
  assert.equal(validateLogoBytes(PNG, LOGO_RULES.maxBytes + 1).ok, false);
  assert.match(validateLogoBytes(enc('<svg onload=alert(1)>')).error, /SVG/);
  assert.equal(validateLogoBytes(enc('MZ\x90\x00 an exe')).ok, false);
  assert.equal(validateLogoBytes(new Uint8Array([]), 0).ok, false);
});
test('validateLogoDimensions', () => {
  assert.equal(validateLogoDimensions(200, 200).ok, true);
  assert.equal(validateLogoDimensions(63, 200).ok, false);
  assert.equal(validateLogoDimensions(5000, 200).ok, false);
  assert.equal(validateLogoDimensions(0, 0).ok, false);
});
test('computeOutputSize', () => {
  assert.deepEqual(computeOutputSize(1024, 512, 'fit'), { width: 512, height: 256 });
  assert.deepEqual(computeOutputSize(200, 100, 'fit'), { width: 200, height: 100 }); // never upscales
  assert.deepEqual(computeOutputSize(1000, 600, 'square'), { width: 512, height: 512 });
  assert.deepEqual(computeOutputSize(100, 300, 'square'), { width: 100, height: 100 });
});
