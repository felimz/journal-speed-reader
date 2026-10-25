import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('production output includes the sample PDF and its application URL', () => {
  const assets = new URL('../dist/assets/', import.meta.url);
  const files = readdirSync(assets);
  const pdfAssets = files.filter(file => file.endsWith('.pdf'));
  assert.equal(pdfAssets.length, 1, 'Load test.pdf must have a PDF in the production build');
  assert.deepEqual(
    readFileSync(new URL(pdfAssets[0], assets)),
    readFileSync(new URL('../references/test.pdf', import.meta.url)),
  );
  const applicationCode = files.filter(file => file.endsWith('.js'))
    .map(file => readFileSync(new URL(file, assets), 'utf8')).join('\n');
  assert.ok(applicationCode.includes(pdfAssets[0]), 'The application must reference the emitted sample PDF');
});

test('package metadata remains private and version-consistent', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.private, true);
  assert.equal(pkg.version, '1.0.1');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
