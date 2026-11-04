import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../home/home.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../home/css/home.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../home/js/home.js", import.meta.url), "utf8");

test("upcoming events uses polished two-column showcase", () => {
  assert.match(html, /events-showcase/);
  assert.match(html, /events-overview/);
  assert.match(html, /calendar-card-polished/);
  assert.match(html, /USC CAMPUS CALENDAR/);
  assert.match(css, /LANDING UPCOMING EVENTS POLISH PASS - 2026-09-05/);
  assert.match(css, /grid-template-columns: minmax\(0, \.88fr\) minmax\(470px, 1\.12fr\)/);
});

test("landing event cards expose polished date and venue facts", () => {
  assert.match(js, /event-description-kicker/);
  assert.match(js, /event-facts/);
  const ctx = vm.createContext({Date, String});
  vm.runInContext(js.slice(js.indexOf('function escapeHtml'), js.indexOf('function setArrowState')) + js.slice(js.indexOf('function buildHomeEventItem'), js.indexOf('function renderHomeEventList')), ctx);
  const card = ctx.buildHomeEventItem({title:'Workshop <notice>', description:'Student activities', eventDate:'2026-11-10', venue:'Campus & Hall', sourceType:'program'});
  assert.match(card, /Venue: Campus &amp; Hall/);
  assert.match(card, /November.*2026/);
  assert.match(card, /title="Workshop &lt;notice&gt;"/);
  assert.match(card, /event-item external-program/);
  assert.match(css, /\.event-accent/);
});

test("landing assets are cache-busted for polished events", () => {
  assert.match(html, /home\.css\?v=8/);
  assert.match(html, /home\.js\?v=8/);
});
