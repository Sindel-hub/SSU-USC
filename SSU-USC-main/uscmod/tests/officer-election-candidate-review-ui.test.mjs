import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/elections/elections.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/elections/js/elections.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../usc-admin/elections/css/elections.css", import.meta.url), "utf8");

test("candidate review keeps structured application cards", () => {
  assert.match(js, /candidate-review-avatar/);
  assert.match(js, /candidate-review-name-row/);
  assert.match(js, /candidate-review-meta/);
  assert.match(js, /candidate-review-action-panel/);
  assert.match(js, /candidate-status-label/);
});

test("campaign photo opens a secure in-portal preview card instead of navigating externally", () => {
  assert.match(html, /id="candidatePhotoDialog"/);
  assert.match(html, /id="candidatePhotoDialogBody"/);
  assert.match(js, /data-candidate-photo-preview/);
  assert.match(js, /openCandidatePhotoPreview/);
  assert.match(js, /data-private-candidate-image/);
  assert.match(js, /candidatePrivatePreviewUrl/);
  assert.match(js, /resolveMediaUrl/);
  assert.match(js, /createPrivateDownloadUrl/);
  assert.match(css, /CANDIDATE CAMPAIGN PHOTO — IN-PORTAL PREVIEW CARD/);
  assert.match(css, /candidate-photo-dialog::backdrop/);
});

test("candidate application opens a floating preview dialog with review decisions", () => {
  assert.match(html, /id="candidatePreviewDialog"/);
  assert.match(html, /id="candidatePreviewBody"/);
  assert.match(html, /id="candidatePreviewFooter"/);
  assert.match(js, /openCandidatePreview/);
  assert.match(js, /data-preview-decision="approve"/);
  assert.match(js, /data-preview-decision="reject"/);
  assert.match(css, /CANDIDATE IN-PAGE PREVIEW MODAL - 2026-09-06/);
  assert.match(css, /candidate-preview-dialog::backdrop/);
});

test("election page cache-busts the candidate preview assets", () => {
  assert.match(html, /elections\.css\?v=candidate-photo-viewer-polish-2/);
  assert.match(html, /elections\.js\?v=candidate-photo-viewer-polish-2/);
});
