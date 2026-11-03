import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementExcerpt } from '../shared/announcement-excerpt.mjs';
test('preview keeps paragraph structure while condensing excessive blank lines',()=>{
 const original='\nHello students!\r\n \r\n\r\n\r\nNext paragraph.\nSingle line.\n';
 assert.equal(announcementExcerpt(original),'Hello students!\n\nNext paragraph.\nSingle line.');
 assert.ok(original.includes('\r\n')); // Original announcement stays untouched.
});
test('long previews have a consistent length and explicit ellipsis',()=>{
 const excerpt=announcementExcerpt('Word '.repeat(200));assert.ok(excerpt.length<=220);assert.ok(excerpt.endsWith('...'));
 assert.equal(announcementExcerpt('A short announcement.'),'A short announcement.');
 assert.equal(announcementExcerpt('a'.repeat(221)).length,220);
});
test('preview helper returns plain text and safely handles empty fields',()=>{
 assert.equal(announcementExcerpt(null),'');assert.equal(announcementExcerpt(undefined),'');assert.equal(announcementExcerpt(' \n '),'');
 assert.equal(announcementExcerpt('<img src=x onerror=alert(1)>'),'<img src=x onerror=alert(1)>'); // Existing renderers still escape this text.
});
