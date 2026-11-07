import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('student, public and officer charts share the image panel and publisher client',()=>{
 for(const path of ['dashboard/organizational-chart.html','home/organizational-chart.html','usc-admin/organizational-chart/organizational-chart.html']){
  const html=read(path);assert.match(html,/data-org-image/);assert.match(html,/data-org-placeholder/);assert.match(html,/organization-chart-image\.js/);assert.match(html,/organization-chart-image\.css/);assert.doesNotMatch(html,/class="(?:student-)?org-tree"/);
 }
});
test('only the officer chart includes upload and publish controls',()=>{
 assert.match(read('usc-admin/organizational-chart/organizational-chart.html'),/data-org-file/);
 for(const path of ['dashboard/organizational-chart.html','home/organizational-chart.html'])assert.doesNotMatch(read(path),/data-org-save|data-org-file/);
});
