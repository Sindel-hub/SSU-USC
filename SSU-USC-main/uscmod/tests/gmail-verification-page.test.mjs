import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const edge = fs.readFileSync(new URL("../supabase/functions/usc-email/index.ts", import.meta.url), "utf8");
const helper = fs.readFileSync(new URL("../shared/supabase-email-service.js", import.meta.url), "utf8");
const verifyHtml = fs.readFileSync(new URL("../email/verify-gmail.html", import.meta.url), "utf8");
const verifyJs = fs.readFileSync(new URL("../email/js/verify-gmail.js", import.meta.url), "utf8");
const recoverHtml = fs.readFileSync(new URL("../email/recover-password.html", import.meta.url), "utf8");
const apiJs = fs.readFileSync(new URL("../email/js/email-api.js", import.meta.url), "utf8");
const config = fs.readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("verification emails route through the portal HTML page instead of Edge Function HTML", () => {
  assert.match(edge, /portalUrl}\/email\/verify-gmail\.html\?token=/);
  assert.match(edge, /Response\.redirect\(destination\.toString\(\), 302\)/);
  assert.doesNotMatch(edge, /return page\("Confirm your Gmail"/);
  assert.match(verifyHtml, /Confirm your Gmail/);
  assert.match(verifyJs, /callPublicEmailAction\("verify"/);
});

test("public verification and recovery calls do not depend on a browser Supabase API key", () => {
  assert.doesNotMatch(helper, /SUPABASE_ANON_KEY|apikey:/);
  assert.doesNotMatch(apiJs, /SUPABASE_ANON_KEY|apikey:/);
  assert.match(config, /\[functions\.usc-email\][\s\S]*verify_jwt\s*=\s*false/);
});

test("password recovery uses a portal-hosted page instead of Edge Function HTML", () => {
  assert.match(helper, /email\/recover-password\.html/);
  assert.match(edge, /portalActionUrl\("email\/recover-password\.html"\)/);
  assert.match(recoverHtml, /Recover your password/);
  assert.match(edge, /action === "recover"/);
  assert.match(edge, /jsonResponse\(\{ ok: true, message:/);
});

test("verification token is removed from the visible browser URL before confirmation", () => {
  assert.match(verifyJs, /history\.replaceState/);
  assert.match(verifyJs, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.match(verifyJs, /\^\[a-f0-9\]\{64\}\$/);
});
