import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/admin-dashboard/audit.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/admin-dashboard/css/admin-dashboard.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/admin-dashboard/js/admin-audit.js", import.meta.url), "utf8");

test("audit page uses a compact history summary with an in-page records viewer", () => {
  assert.match(html, /id="openAuditRecordsButton"/);
  assert.match(html, /id="auditRecordCount"/);
  assert.match(html, /id="auditLatestChange"/);
  assert.match(html, /<dialog[^>]+id="auditRecordsDialog"/);
  assert.match(html, /id="auditSearchInput"/);
  assert.match(html, /id="auditLogList"/);
  assert.match(html, /id="auditFilteredCount"/);
});

test("audit records dialog is wired for open, close, backdrop close and counts", () => {
  assert.match(js, /function openAuditRecords\(\)/);
  assert.match(js, /showModal\(\)/);
  assert.match(js, /function closeAuditRecords\(\)/);
  assert.match(js, /event\.target === dom\.auditRecordsDialog/);
  assert.match(js, /auditFilteredCount\.textContent/);
  assert.match(js, /auditRecordCount\.textContent/);
  assert.match(js, /auditLatestChange\.textContent/);
});

test("audit records viewer has a dedicated polished modal layout", () => {
  assert.match(css, /ADMIN AUDIT RECORDS MODAL - 2026-09-04/);
  assert.match(css, /\.audit-records-dialog\s*\{[\s\S]*?max-width:\s*1080px;/);
  assert.match(css, /\.audit-records-list-wrap\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(css, /\.audit-history-summary-card\s*\{[\s\S]*?background:/);
});
