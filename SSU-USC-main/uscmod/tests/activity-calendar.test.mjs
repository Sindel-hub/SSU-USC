import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dashboard/js/events.js',import.meta.url),'utf8');
function calendar(year,month,events=[],activityType="event"){
 const calendarGrid={},calendarTitle={};
 const ctx=vm.createContext({Date,Set,String,calendarMonth:new Date(year,month,1),calendarGrid,calendarTitle,selectedDateKey:'',events,activityType});
 vm.runInContext(source.slice(source.indexOf('function clean('),source.indexOf('function getProfile('))+source.slice(source.indexOf('function normalizeDateKey('),source.indexOf('function formatDate('))+source.slice(source.indexOf('function renderCalendar()'),source.indexOf('function renderUpcomingSection()')),ctx);
 ctx.renderCalendar();return calendarGrid.innerHTML;
}
test('student activity calendar reserves exactly six weeks in every month including leap years',()=>{
 for(let year=2024;year<=2028;year++)for(let month=0;month<12;month++){
  const html=calendar(year,month);
  assert.equal((html.match(/events-calendar-day-name/g)||[]).length,7);
  assert.equal((html.match(/events-calendar-day(?: |")/g)||[]).length,42);
  assert.equal((html.match(/data-calendar-date=/g)||[]).length,new Date(year,month+1,0).getDate());
 }
});
const fixtures=[{eventDate:'2026-11-05',sourceType:'event'},{eventDate:'2026-11-06',sourceType:'program'},{eventDate:'2026-11-07',sourceType:'event'},{eventDate:'2026-11-07',sourceType:'program'}];
for(const [category,primary,other,onlyDate] of [['event','has-event','has-program','2026-11-05'],['program','has-program','has-event','2026-11-06']])test(`${category} filter highlights only its category and preserves mixed-date metadata`,()=>{
 const html=calendar(2026,10,fixtures,category);
 assert.match(html,new RegExp(`class="events-calendar-day ${primary}[^\\"]*"[^>]*data-calendar-date="${onlyDate}"`));
 assert.match(html,new RegExp(`class="events-calendar-day ${primary} has-both[^\\"]*"[^>]*data-calendar-date="2026-11-07"`));
 assert.ok(!html.includes(other));
});

for(const surface of ['student','landing'])test(`${surface} chooses a single column for up to three filtered cards and a grid for larger lists`,()=>{
 const homeSource=fs.readFileSync(new URL('../home/js/home.js',import.meta.url),'utf8');
 for(const count of [0,1,2,3,4,30]){
  let many=false;
  const list={classList:{toggle(name,value){if(name==='activity-many')many=value;}},innerHTML:''};
  const items=Array.from({length:count},(_,index)=>({id:String(index),title:'Event '+index,eventDate:'2026-11-10',sourceType:'event'}));
  items.push({id:'program-only',title:'Program only',eventDate:'2026-11-10',sourceType:'program'});
  if(surface==='student'){
   const ctx=vm.createContext({Date,String,upcomingList:list,activityType:'event',filterActivityDate:false,selectedDateKey:'',eventsForVisibleMonth:()=>items,eventSortValue:()=>0,parseEventDate:value=>new Date(value+'T00:00:00'),formatCompactTime:()=>'',deadlineBadge:()=>'',registrationMode:()=> 'none'});
   vm.runInContext(source.slice(source.indexOf('function clean('),source.indexOf('function getProfile('))+source.slice(source.indexOf('function renderUpcomingList()'),source.indexOf('function renderCalendar()')),ctx);
   ctx.renderUpcomingList();
  }else{
   const ctx=vm.createContext({Date,String,Set,dom:{eventList:list},homeEventState:{events:items,currentMonth:new Date(2026,10,1),activityType:'event',filterDate:false,selectedDateKey:''}});
   vm.runInContext(homeSource.slice(homeSource.indexOf('function escapeHtml'),homeSource.indexOf('function setArrowState'))+homeSource.slice(homeSource.indexOf('function formatMonthTitle'),homeSource.indexOf('function startHomeEventsListener')),ctx);
   ctx.renderHomeEventList();
  }
  assert.equal(many,count>=4);
  assert.equal((list.innerHTML.match(/<article /g)||[]).length,count);
  assert.ok(!list.innerHTML.includes('Program only'));
 }
});
