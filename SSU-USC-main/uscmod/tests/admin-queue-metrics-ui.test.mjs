import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('retired queue redirects to the directory without account actions', () => {
  const html = read('usc-admin/admin-dashboard/queue.html');
  assert.match(html, /location\.replace\("users\.html"\)/);
  assert.doesNotMatch(html, /admin-queue\.js|<form|queuePromoteButton/);
});
test('admin navigation has no registration queue or manual officer registration', () => {
  for (const page of ['admin-dashboard','users','student-records','officer-management','audit']) {
    assert.doesNotMatch(read(`usc-admin/admin-dashboard/${page}.html`), /href="queue\.html"|Registration Queue|href="[^"\n]*officer-registration\.html"/);
  }
});
