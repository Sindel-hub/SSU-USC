import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/overview/overview.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/overview/js/overview.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/overview/css/overview.css", import.meta.url), "utf8");

test("dashboard shows independent Events and Programs participation analytics", () => {
  assert.match(html, /data-summary="event"/);
  assert.match(html, /data-summary="program"/);
  assert.match(html, /events.html\?analytics=all/);
  assert.match(html, /programs.html\?analytics=all/);
  assert.match(js, /statusBreakdown\(state.events\)/);
  assert.match(js, /statusBreakdown\(state.programs\)/);
});

test("registration analytics partitions event and program registrations", () => {
  assert.match(js, /state\.eventRegistrations = events/);
  assert.match(js, /state\.programRegistrations = programs/);
  assert.match(js, /clean\(data\.programId\)/);
  assert.match(js, /clean\(data\.eventId\)/);
  assert.match(js, /renderProgramParticipationAnalytics/);
  assert.match(js, /programRegistrationCounts/);
});

test("dashboard includes an upcoming Programs preview separate from Events", () => {
  assert.match(html, /program-reference-block/);
  assert.match(html, /officerOverviewPrograms/);
  assert.match(js, /function renderPrograms\(\)/);
  assert.match(css, /officer-program-card/);
});
