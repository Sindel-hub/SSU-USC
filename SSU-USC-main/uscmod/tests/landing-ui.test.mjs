import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function checkAsModule(relativePath) {
  const temp = path.join(os.tmpdir(), `usc-${path.basename(relativePath)}-${Date.now()}.mjs`);
  fs.writeFileSync(temp, read(relativePath));
  const result = spawnSync(process.execPath, ["--check", temp], { encoding: "utf8" });
  fs.unlinkSync(temp);
  assert.equal(result.status, 0, `${relativePath} must parse as a browser ES module:\n${result.stderr}`);
}

test("landing page browser modules parse and initialize independently", () => {
  checkAsModule("home/js/home.js");
  checkAsModule("shared/security-client.js");
  const home = read("home/js/home.js");
  assert.doesNotMatch(home, /shared\/security-client\.js/, "public landing UI must not depend on the election/security adapter");
  assert.match(home, /startAnnouncementsListener\(\)/);
  assert.match(home, /startHomeEventsListener\(\)/);
  assert.match(home, /DOMContentLoaded/, "landing UI should initialize as soon as the DOM is ready");
});

test("landing page keeps a visible campus background before JavaScript finishes", () => {
  const css = read("home/css/home.css");
  const block = css.match(/\.events-following-background\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(block, /visibility:\s*visible/);
  assert.match(block, /opacity:\s*1/);
  assert.match(block, /clip-path:\s*inset\(0 0 0 0\)/);
});


test("landing page uses deployment-relative asset paths", () => {
  const html = read("home/home.html");
  assert.doesNotMatch(html, /<base\s+href=["\']\/home\/["\']/, "an absolute /home/ base breaks nested deployments such as /uscmod/home/");
  assert.match(html, /href=["\']\.\/css\/home\.css(?:\?[^"\']*)?["\']/, "home CSS should resolve relative to home.html");
  assert.match(html, /src=["\']\.\/js\/home\.js(?:\?[^"\']*)?["\']/, "home JS should resolve relative to home.html");
  assert.match(html, /src=["\']\.\.\/shared\/app-config\.js(?:\?[^"\']*)?["\']/, "shared config should resolve from the project folder");
});

test("landing header remains fixed above every landing section", () => {
  const css = read("home/css/home.css");
  assert.match(css, /PERSISTENT LANDING HEADER/);
  assert.match(css, /\.top-header,\s*\n\.top-header\.is-scrolled\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.welcome-screen\s*\{\s*padding-top:\s*var\(--header-height\)/);
  assert.match(css, /scroll-padding-top:\s*var\(--header-height\)/);
});

test("mobile landing chapters use one fixed-header alignment offset", () => {
  const css = read("home/css/home.css");
  const home = read("home/js/home.js");

  assert.match(css, /MOBILE FIXED-HEADER CHAPTER ALIGNMENT/);
  assert.match(css, /scroll-margin-top:\s*0\s*!important/);
  assert.match(css, /min-height:\s*calc\(100svh\s*-\s*var\(--header-height\)\)/);
  assert.match(home, /function getSectionScrollTop\(section\)/);
  assert.match(home, /documentTop\s*-\s*getLandingHeaderHeight\(\)/);
  assert.doesNotMatch(home, /section\.scrollIntoView\(/, "chapter navigation must not stack scrollIntoView with CSS header offsets");
});
