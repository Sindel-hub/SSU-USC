import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/users.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-users.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");

test("user directory editor is rendered as a floating modal", () => {
  assert.match(html, /id="userEditorModal"/);
  assert.match(html, /id="userEditorModalClose"/);
  assert.match(html, /class="user-editor-modal-dialog"/);
  assert.match(html, /user-directory-editor-modal-card/);
});

test("opening a user displays the modal instead of scrolling the page", () => {
  assert.match(js, /function openUserEditorModal\(\)/);
  assert.match(js, /function closeUserEditorModal\(\)/);
  assert.match(js, /function openUser\(userId\)[\s\S]*?openUserEditorModal\(\);/);
  assert.doesNotMatch(js, /scrollIntoView\s*\(/);
});

test("modal supports close button, backdrop, and escape", () => {
  assert.match(js, /userEditorModalClose.*addEventListener\('click', closeUserEditorModal\)/);
  assert.match(js, /userEditorModalBackdrop.*addEventListener\('click', closeUserEditorModal\)/);
  assert.match(js, /event\.key === 'Escape'/);
});

test("modal CSS is fixed, centered, and scroll-contained", () => {
  assert.match(css, /USER DIRECTORY FLOATING ACCOUNT EDITOR - 2026-09-06/);
  assert.match(css, /\.user-editor-modal \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
  assert.match(css, /\.user-directory-editor-modal-card \{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow-y: auto/);
});
