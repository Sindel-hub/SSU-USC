import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('officer Events uses the icon-driven control-center UI', async () => {
  const [html, css, js] = await Promise.all([
    load('usc-admin/events/events.html'),
    load('usc-admin/events/css/events.css'),
    load('usc-admin/events/js/events.js')
  ]);

  assert.match(html, /event-management-page/);
  assert.match(html, /module-workflow-strip/);
  assert.match(html, /fa-calendar-plus/);
  assert.match(html, /fa-paper-plane/);
  assert.match(html, /module-card-icon/);
  assert.match(html, /officer-clean-ui-1/);
  assert.match(css, /OFFICER EVENTS CLEAN CONTROL-CENTER UI/);
  assert.match(css, /event-core-meta/);
  assert.match(js, /fa-user-group/);
  assert.match(js, /fa-trash-can/);
  assert.match(js, /event-core-meta-item/);
});

test('officer Programs uses the matching icon-driven external-program UI', async () => {
  const [html, css, js] = await Promise.all([
    load('usc-admin/programs/programs.html'),
    load('usc-admin/programs/css/programs.css'),
    load('usc-admin/programs/js/programs.js')
  ]);

  assert.match(html, /program-management-page/);
  assert.match(html, /module-workflow-strip/);
  assert.match(html, /fa-earth-americas/);
  assert.match(html, /fa-handshake/);
  assert.match(html, /fa-paper-plane/);
  assert.match(html, /officer-clean-ui-1/);
  assert.match(css, /OFFICER PROGRAMS CLEAN CONTROL-CENTER UI/);
  assert.match(js, /fa-user-group/);
  assert.match(js, /fa-trash-can/);
  assert.match(js, /hostOrganization/);
});
