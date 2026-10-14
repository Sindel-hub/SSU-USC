import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../complaint/complaint.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../complaint/css/complaints.css", import.meta.url), "utf8");

test("complaint attachment upload uses separate visual and copy areas", () => {
  assert.match(html, /class="upload-zone-visual"/);
  assert.match(html, /class="upload-zone-copy"/);
  assert.match(html, /class="upload-zone-help"/);
  assert.match(html, /class="selected-file-name"/);
});

test("attachment component overrides the generic field label display rule", () => {
  assert.match(css, /COMPLAINT ATTACHMENT PREVIEW LAYOUT FIX/);
  assert.match(css, /\.complaint-form\.redesigned \.field \.upload-zone-label\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /grid-template-columns:\s*156px minmax\(0, 1fr\);/);
});

test("selected image replaces the placeholder icon and stays contained", () => {
  assert.match(css, /\.selected-complaint-image-preview:not\(\[hidden\]\) \+ \.upload-placeholder-icon\s*\{\s*display:\s*none;/);
  assert.match(css, /\.selected-complaint-image-preview\s*\{[\s\S]*?object-fit:\s*cover;/);
});

test("attachment UI stacks cleanly on narrow screens", () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?grid-template-columns:\s*1fr;/);
});
