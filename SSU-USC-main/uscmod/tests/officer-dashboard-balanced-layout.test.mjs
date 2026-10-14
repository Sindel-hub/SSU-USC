import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../usc-admin/overview/overview.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../usc-admin/overview/css/overview.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../usc-admin/overview/js/overview.js', import.meta.url), 'utf8');

test('dashboard right rail is populated with bulletin, programs, and election phase', () => {
  assert.match(html, /<aside class="reference-bulletin-column">[\s\S]*reference-bulletin-panel[\s\S]*program-reference-block[\s\S]*election-control-strip[\s\S]*<\/aside>/);
});

test('officer management center spans the full dashboard width', () => {
  assert.match(css, /reference-dashboard-grid>\.officer-management-suite\{grid-column:1\/-1/);
  assert.match(css, /grid-template-areas:[\s\S]*"events bulletin"[\s\S]*"events programs"[\s\S]*"events phase"[\s\S]*"management management"/);
});

test('empty bulletin hides only bulletin panel and keeps right rail modules visible', () => {
  assert.match(js, /bulletinPanel=document\.querySelector\('\.reference-bulletin-panel'\)/);
  assert.match(js, /bulletinPanel\.classList\.toggle\('is-collapsed', !hasBulletin\)/);
  assert.doesNotMatch(js, /bulletinColumn\.classList\.toggle\('is-collapsed'/);
});
