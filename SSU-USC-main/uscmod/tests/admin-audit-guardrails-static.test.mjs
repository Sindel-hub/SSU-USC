import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");

test("System guardrails stays in normal document flow", () => {
  const start = html.indexOf("System guardrails");
  assert.ok(start >= 0, "System guardrails card should exist");
  const articleStart = html.lastIndexOf("<article", start);
  const articleOpenEnd = html.indexOf(">", articleStart);
  const openingTag = html.slice(articleStart, articleOpenEnd + 1);
  assert.match(openingTag, /audit-guardrails-card/);
  assert.doesNotMatch(openingTag, /sticky-card/);
});
