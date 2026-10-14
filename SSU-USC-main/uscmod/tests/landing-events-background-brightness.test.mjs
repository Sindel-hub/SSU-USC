import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../home/css/home.css", import.meta.url), "utf8");

test("upcoming events no longer uses the heavy dark section overlay", () => {
  const polish = css.slice(css.indexOf("LANDING UPCOMING EVENTS POLISH PASS - 2026-09-05"));
  assert.doesNotMatch(polish, /rgba\(10, 28, 43, 0\.82\)/);
  assert.match(polish, /events-section::before[\s\S]*?rgba\(0, 0, 0, 0\.13\)/);
});
