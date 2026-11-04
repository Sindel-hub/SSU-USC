import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dashboard/js/events.js',import.meta.url),'utf8');
function calendar(year,month,events=[]){
 const calendarGrid={},calendarTitle={};
 const ctx=vm.createContext({Date,Set,String,calendarMonth:new Date(year,month,1),calendarGrid,calendarTitle,selectedDateKey:'',events});
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
test('event-only, program-only and shared dates have distinct markers',()=>{
 const html=calendar(2026,10,[{eventDate:'2026-11-05',sourceType:'event'},{eventDate:'2026-11-06',sourceType:'program'},{eventDate:'2026-11-07',sourceType:'event'},{eventDate:'2026-11-07',sourceType:'program'}]);
 assert.match(html,/class="events-calendar-day has-event[^\"]*"[^>]*data-calendar-date="2026-11-05"/);
 assert.match(html,/class="events-calendar-day has-program[^\"]*"[^>]*data-calendar-date="2026-11-06"/);
 assert.match(html,/class="events-calendar-day has-event has-program[^\"]*"[^>]*data-calendar-date="2026-11-07"/);
});
