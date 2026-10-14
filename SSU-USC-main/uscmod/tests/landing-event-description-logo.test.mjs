import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../home/home.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../home/css/home.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../home/js/home.js", import.meta.url), "utf8");

test("landing announcement image slides include their written description", () => {
  assert.match(js, /announcement\.content\s*\|\|\s*announcement\.description/);
  assert.match(js, /class="announcement-poster-copy"/);
  assert.match(js, /class="announcement-poster-media"/);
  assert.match(css, /LANDING ANNOUNCEMENT IMAGE DESCRIPTION FIX/);
  assert.match(css, /\.announcement-poster-copy\s*\{[\s\S]*?min-height:\s*112px;/);
  assert.match(css, /\.announcement-poster-copy p\s*\{[\s\S]*?-webkit-line-clamp:\s*4;/);
});

test("announcement description area uses a more polished blended card treatment", () => {
  assert.match(js, /announcement-copy-meta/);
  assert.match(js, /announcement-copy-badge/);
  assert.match(js, /announcement-copy-date/);
  assert.match(css, /LANDING ANNOUNCEMENT COPY POLISH PASS/);
  assert.match(css, /\.announcement-poster-copy\s*\{[\s\S]*?margin:\s*-14px 14px 14px;[\s\S]*?border-radius:\s*16px;[\s\S]*?backdrop-filter:\s*blur\(10px\);/);
  assert.match(css, /\.announcement-copy-badge\s*\{[\s\S]*?text-transform:\s*uppercase;/);
  assert.match(css, /\.announcement-poster-copy h3\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/);
});

test("Upcoming Events descriptions remain intentionally hidden", () => {
  assert.match(css, /\.event-meta-inline,\s*\n\.event-description\s*\{\s*display:\s*none;/);
});

test("desktop USC seal remains reduced so it does not cover event cards", () => {
  const sealFix = css.slice(css.indexOf("LANDING USC SEAL COLLISION FIX"));
  assert.match(sealFix, /\.giant-usc-mark\s*\{[\s\S]*?top:\s*-150px;[\s\S]*?width:\s*clamp\(420px,\s*38vw,\s*520px\);/);
  assert.match(sealFix, /@media \(min-width: 1500px\)[\s\S]*?width:\s*580px;/);
});

test("landing page cache-busts the corrected announcement CSS and JS", () => {
  assert.match(html, /\.\/css\/home\.css\?v=6/);
  assert.match(html, /\.\/js\/home\.js\?v=6/);
});
