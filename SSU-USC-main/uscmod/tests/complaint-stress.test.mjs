import {workflowHash} from '../supabase/functions/_shared/complaint-workflow.mjs';
import {complaintFixture} from './helpers/complaint-workflow-fixture.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const complaintJs = fs.readFileSync(path.join(root, "complaint/js/complaints.js"), "utf8");
const complaintHtml = fs.readFileSync(path.join(root, "complaint/complaint.html"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const studentCss = fs.readFileSync(path.join(root, "dashboard/css/dashboard.css"), "utf8");
const officerCss = fs.readFileSync(path.join(root, "usc-admin/overview/css/overview.css"), "utf8");
const officerOverviewJs = fs.readFileSync(path.join(root, "usc-admin/overview/js/overview.js"), "utf8");
const officerComplaintsJs = fs.readFileSync(path.join(root, "usc-admin/complaints/js/complaints.js"), "utf8");

const complaintAttachmentJs = fs.readFileSync(path.join(root, "shared/complaint-attachments.js"), "utf8");

test("complaint submission uses atomic per-user burst protection", async () => {
 const h=complaintFixture();const requests=Array.from({length:12},()=>h.draft());const outcomes=await Promise.allSettled(requests.map(requestId=>h.workflow.submit({uid:'student'},{requestId})));
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(h.events().length,1);
 assert.match(complaintJs,/submissionInFlight/);assert.match(complaintJs,/localStorage/);
});

test("attachment limits are enforced in UI and Firestore rules", () => {
  assert.match(complaintJs, /IMAGE_MAX_BYTES\s*=\s*3 \* 1024 \* 1024/);
  assert.match(complaintJs, /DOCUMENT_MAX_BYTES\s*=\s*5 \* 1024 \* 1024/);
  assert.match(rules, /attachmentSize <= 5242880/);
  assert.match(rules, /attachmentSize <= 3145728/);
  assert.match(complaintHtml, /Images: JPG, PNG or WEBP up to 3MB/);
  assert.match(complaintHtml, /id="attachmentError"/);
});

test("synthetic backend complaint references remain unique and account-scoped", async () => {
 const requests=Array.from({length:1000},()=>crypto.randomUUID());const ids=await Promise.all(requests.map(request=>workflowHash(['complaint','student',request])));assert.equal(new Set(ids.map(id=>id.slice(0,40))).size,1000);
 assert.notEqual(await workflowHash(['complaint','student','same-request']),await workflowHash(['complaint','other','same-request']));
});

test("student and officer dashboards include dedicated mobile passes", () => {
  assert.match(studentCss, /mobile dashboard usability pass/);
  assert.match(studentCss, /@media \(max-width: 520px\)/);
  assert.match(officerCss, /Officer dashboard mobile usability pass/);
  assert.match(officerCss, /@media\(max-width:560px\)/);
});


test("officer complaint views avoid unbounded realtime collection listeners", () => {
  assert.match(officerOverviewJs, /limit\(4\)/);
  assert.match(officerOverviewJs, /getCountFromServer/);
  assert.match(officerComplaintsJs, /LIVE_PAGE_SIZE\s*=\s*100/);
  assert.match(officerComplaintsJs, /startAfter\(paginationCursor\)/);
  assert.match(officerComplaintsJs, /getCountFromServer/);
});


test("complaint attachments retain the private Firestore format with trusted submission", () => {
 assert.doesNotMatch(complaintJs,/secureUpload\(/);assert.match(complaintJs,/FIRESTORE_ATTACHMENT_CHUNK_BYTES\s*=\s*600 \* 1024/);
 const drafts=fs.readFileSync(path.join(root,'shared/complaint-drafts.js'),'utf8');assert.match(drafts,/attachmentChunks/);
 assert.match(rules,/allow create, update: if false/);assert.match(complaintAttachmentJs,/loadFirestoreChunks/);
 assert.match(officerComplaintsJs,/loadComplaintAttachmentBlob/);assert.match(officerComplaintsJs,/admin-image-display/);assert.doesNotMatch(officerComplaintsJs,/openPrivateFile/);
});
