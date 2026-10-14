import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const complaintJs = fs.readFileSync(path.join(root, "complaint/js/complaints.js"), "utf8");
const tracklistJs = fs.readFileSync(path.join(root, "dashboard/js/tracklist.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard/js/dashboard.js"), "utf8");
const attachmentJs = fs.readFileSync(path.join(root, "shared/complaint-attachments.js"), "utf8");

test("submitted complaints and student tracklist use the authenticated Firebase UID", () => {
  assert.match(complaintJs, /auth\.currentUser\?\.uid/);
  assert.match(complaintJs, /studentUid:\s*p\.uid/);
  assert.match(tracklistJs, /auth\.currentUser\?\.uid/);
  assert.match(tracklistJs, /where\('studentUid',\s*'==',\s*studentUid\)/);
  assert.match(dashboardJs, /auth\.currentUser\?\.uid \|\| studentProfile\?\.uid/);
});

test("tracklist complaint rendering does not require the legacy Supabase CDN at module startup", () => {
  assert.doesNotMatch(tracklistJs, /security-client\.js/);
  assert.doesNotMatch(attachmentJs, /^import \{ supabase \}/m);
  assert.match(attachmentJs, /await import\("\.\.\/supabase\/supabase-config\.js"\)/);
});
