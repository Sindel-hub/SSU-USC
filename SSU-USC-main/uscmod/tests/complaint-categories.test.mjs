import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPLAINT_CATEGORIES, complaintCategoryLabel, suggestedComplaintOffice, bindComplaintCategories, selectedComplaintCategory} from '../shared/complaint-categories.js';
test('four office categories accept their specific concerns and keep Other available',()=>{
 assert.equal(COMPLAINT_CATEGORIES.length,4);
 for(const category of COMPLAINT_CATEGORIES){
  assert.match(category.concerns.at(-1),/^Other /);
  for(const concern of category.concerns){
   const label=complaintCategoryLabel(category.name,concern);
   assert.equal(label,`${category.name} — ${concern}`);
   assert.ok(suggestedComplaintOffice(label).includes(category.office));
   assert.match(suggestedComplaintOffice(label),/USC will review/);
  }
 }
 assert.equal(complaintCategoryLabel(COMPLAINT_CATEGORIES[0].name,COMPLAINT_CATEGORIES[1].concerns[0]),'');
 assert.equal(suggestedComplaintOffice('An older complaint category'),'');
});
test('changing and resetting the main dropdown clears the previous concern and office guidance',()=>{
 const node=()=>({value:'',disabled:false,hidden:false,textContent:'',listeners:{},replaceChildren(...items){this.options=items;this.value=items[0]?.value||'';},addEventListener(name,fn){this.listeners[name]=fn;}});
 const category=node(),concern=node(),guidance=node(),form=node();
 form.querySelector=selector=>({'#category':category,'#specificConcern':concern,'#complaintOfficeGuidance':guidance}[selector]);
 const previous=globalThis.document;globalThis.document={createElement:node};
 try {
  bindComplaintCategories(form);assert.equal(concern.disabled,true);assert.equal(guidance.hidden,true);
  category.value=COMPLAINT_CATEGORIES[0].name;category.listeners.change();
  concern.value=COMPLAINT_CATEGORIES[0].concerns[0];assert.ok(selectedComplaintCategory(form));
  category.value=COMPLAINT_CATEGORIES[2].name;category.listeners.change();
  assert.equal(selectedComplaintCategory(form),'');assert.equal(concern.options.length,6);
  assert.ok(guidance.textContent.includes('ICTO'));
  form.listeners.reset();assert.equal(concern.disabled,true);assert.equal(guidance.hidden,true);assert.equal(guidance.textContent,'');
 } finally {globalThis.document=previous;}
});
