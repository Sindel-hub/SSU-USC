import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../dashboard/css/dashboard.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/dashboard.html", import.meta.url), "utf8");

test("mobile notification panel is compact rather than nearly full-screen", () => {
  const compact = css.slice(css.indexOf("MOBILE NOTIFICATION PANEL COMPACT PASS"));
  assert.match(compact, /@media \(max-width: 620px\)/);
  assert.match(compact, /left:\s*16px\s*!important/);
  assert.match(compact, /right:\s*16px\s*!important/);
  assert.match(compact, /max-height:\s*min\(72dvh,\s*560px\)\s*!important/);
  assert.match(compact, /\.notification-icon\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/);
  assert.match(compact, /\.notification-item\s*\{[\s\S]*?padding:\s*12px 0;/);
});

test("dashboard cache-busts compact notification styles", () => {
  assert.match(html, /css\/dashboard\.css\?v=3/);
});
