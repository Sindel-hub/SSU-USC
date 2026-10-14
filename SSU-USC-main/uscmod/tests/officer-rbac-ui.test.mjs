import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../usc-admin/shared/js/officer-rbac.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/shared/css/officer-ui.css", import.meta.url), "utf8");
const overview = fs.readFileSync(new URL("../usc-admin/overview/overview.html", import.meta.url), "utf8");

test("unassigned module links stay navigable and are marked read-only", () => {
  assert.match(js, /Module links are NEVER blocked now/);
  assert.match(js, /classList\.add\("rbac-readonly-link"\)/);
  assert.match(js, /fa-regular fa-eye rbac-readonly-icon/);
  assert.doesNotMatch(js, /anchor\.setAttribute\("aria-disabled",\s*"true"\)/);
  assert.match(js, /Navigation links are\s*\n\s*\/\/ intentionally not intercepted/);
});

test("RBAC read-only sidebar links use a compact eye badge", () => {
  assert.match(css, /RBAC READ-ONLY MODULE MODEL/);
  assert.match(css, /\.officer-module-nav \.nav-btn\.rbac-readonly-link \.rbac-readonly-icon\s*\{[\s\S]*?width:\s*24px;[\s\S]*?border-radius:\s*999px;/);
  assert.doesNotMatch(css, /\.officer-module-readonly-banner\s*\{/);
});

test("action controls remain blocked even when a module itself is viewable", () => {
  assert.match(js, /\.rbac-control-locked\[data-rbac-permission\]/);
  assert.match(js, /\.rbac-scope-locked\[data-rbac-permission\]/);
  assert.match(js, /Read-only access\. Your assigned USC office cannot perform/);
});

test("officer dashboard cache-busts the read-only RBAC assets", () => {
  assert.match(overview, /officer-ui\.css\?v=rbac-ui-5/);
  assert.match(overview, /officer-rbac\.js\?v=6/);
  assert.match(overview, /auth-guard\.js\?v=rbac6/);
});
