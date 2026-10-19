import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../usc-admin/programs/js/programs.js', import.meta.url), 'utf8');
function renderer() {
  const context = {
    recentEventsList: { innerHTML: '' }, programSearch: { value: '' },
    programStatusFilter: { value: 'all' }, programResultsCount: { textContent: '' },
    registrationCounts: new Map([['future', 3]]),
    hydrateMediaImages: async () => {}, console
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function safeText'), source.indexOf('function releaseEventImageObjectUrl')), context);
  vm.runInContext(source.slice(source.indexOf('function renderEmptyState'), source.indexOf('function totalWebsiteRegistrations')), context);
  vm.runInContext(source.slice(source.indexOf('function renderEvents'), source.indexOf('function subscribeToEvents')), context);
  return context;
}
const events = [
  {id:'future', title:'Leadership workshop', eventDate:'2099-01-01', venue:'University Hall', hostOrganization:'Community Partner', category:'Workshop', registrationMode:'internal'},
  {id:'past', title:'Assembly', eventDate:'2000-01-01', venue:'Campus', category:'Assembly', registrationMode:'none'}
];
test('program search and status combine without changing the source events or registration counts', () => {
  const c = renderer();
  c.programSearch.value = 'community partner';
  c.renderEvents(events);
  assert.match(c.recentEventsList.innerHTML, /Leadership workshop/);
  assert.doesNotMatch(c.recentEventsList.innerHTML, /Assembly/);
  assert.match(c.recentEventsList.innerHTML, /Participants \(3\)/);
  assert.equal(c.programResultsCount.textContent, '1 of 2 programs');
  c.programStatusFilter.value = 'Completed';
  c.renderEvents(events);
  assert.match(c.recentEventsList.innerHTML, /No matching programs/);
  c.programSearch.value = '';
  c.renderEvents(events);
  assert.match(c.recentEventsList.innerHTML, /Assembly/);
  assert.doesNotMatch(c.recentEventsList.innerHTML, /data-view-participants/);
  assert.equal(events.length, 2);
  assert.equal(c.registrationCounts.get('future'), 3);
});
test('redesigned program cards escape user content and retain management hooks and details', () => {
  const c = renderer();
  c.renderEvents([{...events[0], title:'<script>alert(1)</script>', venue:'<Hall>', description:'Bring your ID', participationNotes:'<img onerror=x>', startTime:'09:00', endTime:'12:00'}]);
  const html=c.recentEventsList.innerHTML;
  assert.doesNotMatch(html, /<script>|<img onerror/);
  for (const value of ['&lt;script&gt;', '&lt;Hall&gt;', 'Bring your ID', '09:00 - 12:00', 'data-delete-event="future"', 'data-view-participants="future"', 'data-rbac-permission="programs.manage"', 'Community Partner']) assert.ok(html.includes(value), value);
});
test('empty library is distinct from a filter with no matches', () => {
  const c = renderer();
  c.renderEvents([]);
  assert.match(c.recentEventsList.innerHTML, /Nothing published yet/);
  assert.equal(c.programResultsCount.textContent, '0 of 0 programs');
});
