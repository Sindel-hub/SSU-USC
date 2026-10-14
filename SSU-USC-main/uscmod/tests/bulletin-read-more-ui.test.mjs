import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../dashboard/js/bulletin.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dashboard/css/student-pages.css", import.meta.url), "utf8");
const dashboardCss = fs.readFileSync(new URL("../dashboard/css/dashboard.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../dashboard/bulletin.html", import.meta.url), "utf8");

test("bulletin read more uses a compact dedicated CTA", () => {
  assert.match(js, /class="bulletin-read-more"/);
  assert.match(js, /fa-arrow-right/);
  assert.match(css, /BULLETIN READ-MORE \+ CARD POLISH PASS/);
  assert.match(css, /\.bulletin-page-body \.bulletin-read-more\s*\{[\s\S]*?width:\s*auto;[\s\S]*?border-radius:\s*999px;/);
});

test("bulletin titles and excerpts are consistently clamped", () => {
  assert.match(css, /\.bulletin-page-body h2\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
  assert.match(css, /\.bulletin-page-body p\s*\{[\s\S]*?-webkit-line-clamp:\s*3;/);
});

test("read more modal receives the polish treatment", () => {
  assert.match(dashboardCss, /BULLETIN READ-MORE MODAL POLISH/);
  assert.match(dashboardCss, /#bulletinModalContent\s*\{[\s\S]*?line-height:\s*1\.72;/);
});

test("bulletin assets are cache busted", () => {
  assert.match(html, /student-pages\.css\?v=2/);
  assert.match(html, /bulletin\.js\?v=2/);
});
