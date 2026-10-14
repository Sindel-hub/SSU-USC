import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../usc-admin/overview/overview.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../usc-admin/overview/css/overview.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../usc-admin/overview/js/overview.js', import.meta.url), 'utf8');

test('dashboard uses compact analytics launchers for four modules', () => {
  for (const key of ['event','program','complaint','election']) {
    assert.match(html, new RegExp(`data-analytics-open="${key}"`));
    assert.match(html, new RegExp(`data-analytics-panel="${key}"`));
  }
  assert.match(html, /analytics-launcher-tooltip/);
});

test('analytics modal supports click/tap detail panels and close actions', () => {
  assert.match(html, /id="officerAnalyticsModal"/);
  assert.match(html, /data-analytics-close/);
  assert.match(js, /bindCompactAnalyticsPopover/);
  assert.match(js, /analytics-popover-open/);
  assert.match(js, /event:\{title:"Events Analytics"/);
  assert.match(js, /program:\{title:"Programs Analytics"/);
});

test('compact analytics CSS includes hover labels and responsive floating card', () => {
  assert.match(css, /\.analytics-launch-grid/);
  assert.match(css, /\.analytics-launcher:hover \.analytics-launcher-tooltip/);
  assert.match(css, /\.analytics-detail-dialog/);
  assert.match(css, /@media\(max-width:560px\)/);
});
