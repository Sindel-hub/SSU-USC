import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const profile = fs.readFileSync(new URL("../shared/profile-manager.js", import.meta.url), "utf8");
const emailUi = fs.readFileSync(new URL("../shared/email-settings.js", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../shared/settings-manager.js", import.meta.url), "utf8");
const edge = fs.readFileSync(new URL("../supabase/functions/usc-email/index.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../supabase/functions/usc-email-worker/index.ts", import.meta.url), "utf8");
const common = fs.readFileSync(new URL("../supabase/functions/_shared/usc-email-common.ts", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase/email-service.sql", import.meta.url), "utf8");

test("officer profile exposes Gmail recovery and notification settings", () => {
  assert.match(profile, /\["student", "officer"\]\.includes\(profile\.role\)/);
  assert.match(profile, /\["student", "officer"\]\.includes\(currentProfile\.role\)/);
  assert.match(emailUi, /Officer self-service/);
  assert.match(emailUi, /Complaint activity/);
  assert.match(settings, /email-supported-setting/);
  assert.match(settings, /\["student", "officer"\]\.includes\(currentRole\)/);
});

test("Supabase email backend accepts active officer accounts", () => {
  assert.match(common, /\["student", "officer"\]\.includes\(role\)/);
  assert.match(common, /if \(role === "officer"\) return true/);
  assert.match(edge, /signedInPortalAccount/);
  assert.match(edge, /account_role: accountRole/);
  assert.match(edge, /Student or Officer Profile/);
  assert.match(sql, /account_role text not null default 'student'/);
});

test("worker routes officer notifications separately", () => {
  assert.match(worker, /role === "officer"/);
  assert.match(worker, /Officer Complaints Management/);
  assert.match(worker, /usc-admin\/overview\/overview\.html/);
  assert.match(worker, /account_role: role/);
});
