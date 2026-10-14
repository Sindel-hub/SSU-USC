import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../complaint/complaint.html", import.meta.url), "utf8");

test("complaint subject explains what the student should enter", () => {
  assert.match(
    html,
    /<input[^>]*id=["']subject["'][^>]*placeholder=["']Brief title or summary of your complaint\.\.\.["'][^>]*>/i
  );
});
