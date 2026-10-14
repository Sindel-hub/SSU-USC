import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (url) => fs.readFileSync(new URL(url, import.meta.url), "utf8");
const officerPages = [
  "../usc-admin/overview/overview.html",
  "../usc-admin/announcements/announcements.html",
  "../usc-admin/elections/elections.html",
  "../usc-admin/events/events.html",
  "../usc-admin/organizational-chart/organizational-chart.html",
  "../usc-admin/complaints/complaints.html"
];

test("every officer module stays hidden until officer authentication resolves", () => {
  for (const page of officerPages) {
    const html = read(page);
    assert.match(html, /<html[^>]*class="usc-officer-access-pending"/i, `${page} must hide officer UI before auth/RBAC resolves`);
    assert.match(html, /officer-ui\.css\?v=rbac-ui-5/, `${page} must load the current fail-closed CSS`);
    assert.match(html, /auth-guard\.js\?v=rbac6/, `${page} must use the current account guard`);
    assert.match(html, /officer-rbac\.js\?v=5/, `${page} must use the current RBAC decorator`);
  }
});

test("officer RBAC reveals pages only after the account guard accepts the officer", () => {
  const js = read("../usc-admin/shared/js/officer-rbac.js");
  assert.match(js, /const authAllowed = await \(globalThis\.USC_AUTH_READY \|\| Promise\.resolve\(false\)\)/);
  assert.match(js, /if \(authAllowed !== true\) await new Promise\(\(\) => \{\}\)/);
  assert.match(js, /decorate\(\);\s*renderModuleReadOnlyBanner\(\);\s*revealAuthorizedOfficerUi\(\);/);
  assert.match(js, /classList\.remove\("usc-officer-access-pending"\)/);
});

test("shared officer CSS blocks interaction and shows only an access loader while pending", () => {
  const css = read("../usc-admin/shared/css/officer-ui.css");
  assert.match(css, /RBAC FAIL-CLOSED LOAD STATE/);
  assert.match(css, /html\.usc-officer-access-pending body\.officer-app-shell > \*[\s\S]*?opacity:\s*0\s*!important;[\s\S]*?visibility:\s*hidden\s*!important;[\s\S]*?pointer-events:\s*none\s*!important;/);
  assert.match(css, /#officerQuickSearch::placeholder[\s\S]*?visibility:\s*hidden\s*!important;[\s\S]*?opacity:\s*0\s*!important;/);
  assert.match(css, /Checking officer access…/);
});

test("live officer permission changes re-enter pending state before read-only state is recalculated", () => {
  const js = read("../usc-admin/shared/js/officer-rbac.js");
  assert.match(js, /usc-officer-profile-updated/);
  assert.match(js, /classList\.add\("usc-officer-access-pending"\)/);
  assert.match(js, /clearDecoratedAccessState\(\);\s*decorate\(\);\s*renderModuleReadOnlyBanner\(\);\s*revealAuthorizedOfficerUi\(\);/);
});
