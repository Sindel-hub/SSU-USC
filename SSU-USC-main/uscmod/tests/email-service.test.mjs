import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const frontend = fs.readFileSync(new URL("../shared/email-settings.js", import.meta.url), "utf8");
const helper = fs.readFileSync(new URL("../shared/supabase-email-service.js", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../shared/profile-manager.js", import.meta.url), "utf8");
const login = fs.readFileSync(new URL("../index/js/index.js", import.meta.url), "utf8");
const edge = fs.readFileSync(new URL("../supabase/functions/usc-email/index.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../supabase/functions/usc-email-worker/index.ts", import.meta.url), "utf8");
const common = fs.readFileSync(new URL("../supabase/functions/_shared/usc-email-common.ts", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase/email-service.sql", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("student and officer email UI uses Supabase instead of Firestore/Apps Script", () => {
  assert.match(frontend, /callStudentEmailService\("get"\)/);
  assert.match(frontend, /callStudentEmailService\("save"/);
  assert.doesNotMatch(frontend, /email_requests|email_accounts|script\.google\.com/);
  assert.match(helper, /functions\/v1\/usc-email/);
  assert.doesNotMatch(profile, /resolveEmailServiceUrl|isEmailServiceUrl/);
  assert.match(profile, /callStudentEmailService\("password_changed"\)/);
  assert.match(login, /openSupabaseRecoveryPage\(\)/);
});

test("Supabase Edge Function handles verification, recovery and password security alerts", () => {
  assert.match(edge, /action === "verify"/);
  assert.match(edge, /action === "recover"/);
  assert.match(edge, /action === "password_changed"/);
  assert.match(edge, /generateFirebaseResetLink/);
  assert.match(common, /returnOobLink: true|returnOobLink/);
  assert.match(common, /https:\/\/api\.resend\.com\/emails/);
});

test("notification worker covers complaints, elections, announcements, events and programs", () => {
  assert.match(worker, /firestoreCollection\("complaints"/);
  assert.match(worker, /firestoreCollection\("announcements"/);
  assert.match(worker, /firestoreCollection\("events"/);
  assert.match(worker, /Voting is now open/);
  assert.match(worker, /Official election results/);
  assert.match(worker, /New announcements, events, or external programs/);
});

test("email data is private in Supabase and legacy Firestore paths are removed", () => {
  assert.match(sql, /alter table public\.student_email_accounts enable row level security/);
  assert.match(sql, /revoke all on table public\.student_email_accounts from anon, authenticated/);
  assert.match(sql, /verified_email_unique/);
  assert.doesNotMatch(rules, /match \/email_requests/);
  assert.doesNotMatch(rules, /match \/email_accounts/);
  assert.doesNotMatch(rules, /public_config\/email_service/);
});
