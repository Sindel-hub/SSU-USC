import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handbookUrl = "https://drive.google.com/file/d/1SFp-SHhVKCHcHlWLwMxSQe1bdbLRuLMG/preview";
const pages = [
  "home/home.html",
  "index/index.html",
  "dashboard/dashboard.html",
  "dashboard/bulletin.html",
  "dashboard/election.html",
  "dashboard/events.html",
  "dashboard/organizational-chart.html",
  "dashboard/tracklist.html",
  "dashboard/handbook.html",
  "complaint/complaint.html"
];

test("Student Handbook navigation opens the updated Unified Student Handbook PDF in a new tab", () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const handbookAnchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .filter(([, , body]) => /Student Handbook/i.test(body));

    assert.ok(handbookAnchors.length > 0, `${page} should contain a Student Handbook link`);
    for (const [, attrs] of handbookAnchors) {
      assert.match(attrs, new RegExp(`href=["']${handbookUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`), `${page} Student Handbook should use the Google Drive preview URL`);
      assert.match(attrs, /target=["\']_blank["\']/i, `${page} Student Handbook should open in a new tab`);
      assert.match(attrs, /rel=["\'][^"\']*noopener[^"\']*noreferrer[^"\']*["\']/i, `${page} Student Handbook should protect the opener relationship`);
    }
  }
});
