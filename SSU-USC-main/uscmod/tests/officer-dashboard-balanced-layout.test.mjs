import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../usc-admin/overview/overview.html',import.meta.url),'utf8');
const css=await readFile(new URL('../usc-admin/overview/css/overview-unified.css',import.meta.url),'utf8');
const js=await readFile(new URL('../usc-admin/overview/js/overview.js',import.meta.url),'utf8');
test('calendar and programs precede a bulletin spanning the left stack',()=>{
 assert.match(html, /overview-content-left[\s\S]*event-reference-block[\s\S]*program-reference-block[\s\S]*reference-bulletin-panel/);
 assert.match(css,/overview-content-grid[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
 assert.match(css,/align-self:stretch !important/);
});
test('content, general analytics and quick access follow the required order',()=>{
 const content=html.indexOf('class="overview-content-grid"'),analytics=html.indexOf('class="general-analytics"'),quick=html.indexOf('class="overview-quick-access"');
 assert.ok(analytics<content && content<quick);
 assert.doesNotMatch(html,/Officers’ Tracklist|election-control-strip|officer-management-suite|Case Workflow/);
});
test('empty bulletin keeps a real empty state in its aligned panel',()=>{
 assert.match(js,/No announcement posted yet/);
 assert.doesNotMatch(js,/classList\.toggle\('is-collapsed'/);
});
