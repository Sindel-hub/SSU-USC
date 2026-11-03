import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../home/js/home.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function escapeHtml'),source.indexOf('function setArrowState'));
const calendar=source.slice(source.indexOf('function formatMonthTitle'),source.indexOf('function startHomeEventsListener'));
function fixture(year,month,events=[]){
 const state={currentMonth:new Date(year,month,1),selectedDateKey:'',events};
 const dom={calendarGrid:{},calendarTitle:{},eventList:{}};
 const ctx=vm.createContext({Date,Set,String,dom,homeEventState:state});vm.runInContext(helpers+calendar,ctx);
 return {ctx,state,dom};
}
test('actual calendar always reserves six weeks with correct dates across leap years and month starts',()=>{
 for(let year=2020;year<=2028;year++)for(let month=0;month<12;month++){
  const f=fixture(year,month);vm.runInContext('renderHomeCalendar()',f.ctx);
  const html=f.dom.calendarGrid.innerHTML;
  assert.equal((html.match(/class="day-name"/g)||[]).length,7);
  assert.equal((html.match(/<button /g)||[]).length,42);
  assert.equal((html.match(/data-home-calendar-date=/g)||[]).length,new Date(year,month+1,0).getDate());
  const prefix=html.slice(0,html.indexOf('data-home-calendar-date='));
  assert.equal((prefix.match(/disabled aria-hidden="true"/g)||[]).length,new Date(year,month,1).getDay());
 }
});
test('empty event calendar preserves the month selected through navigation',()=>{
 const f=fixture(2027,1);vm.runInContext('syncHomeCalendarSelection();renderHomeCalendar()',f.ctx);
 assert.equal(f.state.currentMonth.getFullYear(),2027);assert.equal(f.state.currentMonth.getMonth(),1);
 assert.equal(f.dom.calendarTitle.textContent,'February 2027');
});
test('date selection and event markers survive calendar padding',()=>{
 const f=fixture(2027,0,[{eventDate:'2027-01-15'}]);f.state.selectedDateKey='2027-01-15';
 vm.runInContext('renderHomeCalendar()',f.ctx);
 assert.match(f.dom.calendarGrid.innerHTML,/class="day-cell has-event selected"[^>]*data-home-calendar-date="2027-01-15"/);
});
