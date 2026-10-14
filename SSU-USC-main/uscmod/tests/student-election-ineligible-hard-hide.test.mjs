import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html=fs.readFileSync(new URL("../dashboard/election.html",import.meta.url),"utf8");
const js=fs.readFileSync(new URL("../dashboard/js/election.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../dashboard/css/student-pages.css",import.meta.url),"utf8");
test("ineligible election state suppresses action and details layout",()=>{
 assert.match(js,/app\.classList\.add\("election-ineligible-active"\)/);
 assert.match(js,/You are not eligible to vote in this election\./);
 assert.match(css,/#electionApp\.election-ineligible-active \.registration-layout/);
 assert.match(html,/#electionApp:has\(\.election-eligibility-compact\) \.registration-layout/);
 assert.match(html,/MutationObserver\(enforce\)/);
});
test("election page cache-busts hard-hide assets",()=>{
 assert.match(html,/student-pages\.css\?v=election-clean-4/);
 assert.match(html,/election\.js\?v=election-clean-4/);
});
