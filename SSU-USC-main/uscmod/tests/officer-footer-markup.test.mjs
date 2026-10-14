import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const rel of [
  'usc-admin/programs/programs.html',
  'usc-admin/events/events.html'
]) {
  test(`${rel} keeps the shared officer footer wrapper intact`, () => {
    const html = readFileSync(resolve(rel), 'utf8');
    assert.match(html, /<footer class="officer-shared-footer">\s*<div class="officer-footer-main">/);
    assert.doesNotMatch(html, /<footer class="officer-shared-footer"\s*\n\s*<div/);
  });
}
