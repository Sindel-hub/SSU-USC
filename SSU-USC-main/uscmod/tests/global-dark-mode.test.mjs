import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "shared", "settings-manager.css"), "utf8");
const js = fs.readFileSync(path.join(root, "shared", "settings-manager.js"), "utf8");

test("dark mode is applied through the global effective-theme attribute", () => {
  assert.match(js, /dataset\.uscEffectiveTheme\s*=\s*effectiveTheme\(\)/);
  assert.match(css, /FULL PORTAL DARK MODE/);
  assert.match(css, /html\[data-usc-effective-theme="dark"\]\s+body\.student-app-shell/);
  assert.match(css, /html\[data-usc-effective-theme="dark"\]\s+body\.officer-app-shell/);
});

test("dark mode covers core surfaces, forms, tables and shared drawers", () => {
  for (const selector of [
    ".top-nav",
    ".student-module-toolbar",
    ".usc-profile-drawer",
    ".usc-settings-drawer",
    "input",
    "textarea",
    "select",
    "table",
    ".notification-panel",
    ".candidate-preview-shell",
    ".event-participants-dialog"
  ]) assert.ok(css.includes(selector), `Missing dark-mode coverage for ${selector}`);
});
