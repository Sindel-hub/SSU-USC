export const STATUS_DEFINITIONS = Object.freeze([
  { name: 'Active', color: '#258666', icon: 'fa-solid fa-circle-play' },
  { name: 'Upcoming', color: '#3478b7', icon: 'fa-regular fa-calendar' },
  { name: 'Completed', color: '#7c79b4', icon: 'fa-regular fa-circle-check' },
  { name: 'Cancelled', color: '#bd6676', icon: 'fa-solid fa-ban' },
  { name: 'Unscheduled', color: '#8898aa', icon: 'fa-regular fa-circle-question' }
]);
export function timestampMillis(value) {
  if (value == null || value === '') return null;
  const ms = typeof value.toMillis === 'function' ? value.toMillis() : typeof value.toDate === 'function' ? value.toDate().getTime() : typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function dateBoundary(day, time, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const [y,m,d] = day.split('-').map(Number);
  const date = new Date(y,m-1,d);
  if (date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d) return null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour,minute] = time ? time.split(':').map(Number) : end ? [23,59] : [0,0];
  date.setHours(hour,minute,end && !time ? 59 : 0,end && !time ? 999 : 0);
  return date.getTime() + (end && !time ? 1 : 0);
}
export function classifyEngagement(record, now = Date.now()) {
  const saved = String(record.status || '').trim().toLowerCase();
  if (['cancelled','canceled'].includes(saved)) return 'Cancelled';
  if (saved === 'completed') return 'Completed';
  const start = dateBoundary(record.eventDate,record.startTime);
  const end = dateBoundary(record.eventDate,record.endTime,true);
  if (start == null || end == null || end < start) return 'Unscheduled';
  if (now < start) return 'Upcoming';
  if (now >= end) return 'Completed';
  return 'Active';
}
export function escapeReportHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function buildEngagementReport(records, registrations, { kind = 'events', recordId = '', status = 'all', now = Date.now() } = {}) {
  const selected = records.filter(r=>(!recordId || r.id===recordId) && (status==='all' || classifyEngagement(r,now)===status));
  const breakdown = Object.fromEntries(STATUS_DEFINITIONS.map(s=>[s.name,0]));
  const items = selected.map(record=>{
    const currentStatus = classifyEngagement(record,now);
    breakdown[currentStatus]++;
    const mode = String(record.registrationMode || 'none').toLowerCase();
    const start = dateBoundary(record.eventDate,record.startTime);
    const end = dateBoundary(record.eventDate,record.endTime,true);
    const scheduleElapsedPercent = currentStatus!=="Cancelled" && start!=null && end!=null && end>start ? Math.round(Math.max(0,Math.min(100,(now-start)/(end-start)*100))) : null;
    const entry = registrations.get(record.id);
    const availability = mode==='internal' ? entry?.state || 'loading' : mode==='external' ? 'external' : 'not-required';
    const participants = availability==='ready' ? (entry.records || []).map(row=>({
      fullName: String(row.fullName || ''), studentId: String(row.studentId || ''), schoolEmail: String(row.schoolEmail || ''),
      college: String(row.college || ''), program: String(row.program || ''), yearLevel: String(row.yearLevel || ''),
      status: String(row.status || 'registered'), registeredAt: timestampMillis(row.registeredAt)
    })).sort((a,b)=>a.fullName.localeCompare(b.fullName) || a.studentId.localeCompare(b.studentId)) : [];
    return {
      id: String(record.id), title: String(record.title || 'Untitled'), status: currentStatus,
      statusBasis: ['cancelled','canceled','completed'].includes(String(record.status || '').trim().toLowerCase()) ? 'Saved status' : 'Saved schedule (local time)',
      scheduleElapsedPercent,
      savedStatus: String(record.status || ''), eventDate: String(record.eventDate || ''), startTime: String(record.startTime || ''), endTime: String(record.endTime || ''),
      venue: String(record.venue || ''), hostOrganization: String(record.hostOrganization || ''), category: String(record.category || ''),
      description: String(record.description || ''), audience: String(record.audience || ''), participationNotes: String(record.participationNotes || ''),
      registrationMode: mode, registrationDeadline: timestampMillis(record.registrationDeadline),
      registrationAvailability: availability, participantCount: availability==='ready' ? participants.length : null, participants,
      publishedAt: timestampMillis(record.publishedAtMs ?? record.publishedAt), updatedAt: timestampMillis(record.updatedAt),
      completion: currentStatus==='Completed' ? (String(record.status || '').trim().toLowerCase()==='completed' ? 'Marked completed in the saved record.' : 'Scheduled end has passed; completion and attendance are not independently verified.') : null
    };
  });
  return {
    kind, generatedAt: new Date(now).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    scope: { recordId: recordId || null, status }, total: items.length, breakdown,
    knownPortalRegistrations: items.reduce((n,r)=>n+(r.participantCount ?? 0),0),
    pendingOrUnavailable: items.filter(r=>['loading','unavailable'].includes(r.registrationAvailability)).length,
    limitations: 'Portal registrations are not attendance. External participation counts, deleted records, and a historical status-change log are not available in this dataset.',
    items
  };
}
export function registrationSummary(item) {
  if (item.participantCount != null) return `${item.participantCount} portal registrations`;
  return { loading:'Loading registrations…', unavailable:'Registrations unavailable', external:'External registrations — count not tracked', 'not-required':'No registration required' }[item.registrationAvailability] || 'Not available';
}
export function reportDocument(report) {
  const e=escapeReportHtml;
  const date=ms=>ms==null?'Not recorded':new Date(ms).toLocaleString([], { timeZone:report.timeZone });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(report.kind)} status report</title><style>body{font:14px/1.6 system-ui;color:#203b59;max-width:1000px;margin:32px auto;padding:0 20px}h1{font-size:26px}h2{font-size:20px}section{border-top:1px solid #ccd9e7;padding:20px 0;break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{padding:8px;text-align:left;border-bottom:1px solid #e0e7ef;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:140px 1fr;gap:6px}dt{font-weight:600}dd{margin:0}p{white-space:pre-wrap}small{color:#52677c}@media print{body{margin:0;max-width:none}section{break-inside:auto}tr{break-inside:avoid}}</style></head><body>
    <h1>${report.kind==='programs'?'Programs':'Events'} status report</h1>
    <p>Generated: ${e(date(Date.parse(report.generatedAt)))} (${e(report.timeZone)})<br>Scope: ${e(report.scope.recordId || 'All records')} · ${e(report.scope.status)}</p>
    <p>${report.total} records · ${report.knownPortalRegistrations} known portal registrations · ${report.pendingOrUnavailable} registration feeds pending/unavailable</p>
    <p>${Object.entries(report.breakdown).map(([s,n])=>`${e(s)}: ${n}`).join(' · ')}</p><small>${e(report.limitations)}</small>
    ${report.items.map(item=>`<section><h2>${e(item.title)}</h2><dl>${Object.entries({Status:item.status,'Status basis':item.statusBasis,'Schedule elapsed':item.scheduleElapsedPercent==null?'Not available':`${item.scheduleElapsedPercent}% of scheduled window`,Schedule:`${item.eventDate || 'Not set'} ${item.startTime || 'All day'}${item.endTime?' – '+item.endTime:''}`,Venue:item.venue || 'Not set',Host:item.hostOrganization || 'Not recorded',Category:item.category || 'Not recorded',Audience:item.audience || 'Not recorded',Participation:registrationSummary(item),'Registration deadline':date(item.registrationDeadline),Published:date(item.publishedAt),Updated:date(item.updatedAt)}).map(([k,v])=>`<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>
      <p>${e(item.description)}</p>${item.participationNotes?`<h3>Participation instructions</h3><p>${e(item.participationNotes)}</p>`:''}${item.completion?`<p>${e(item.completion)}</p>`:''}
      ${item.registrationAvailability==='ready'?`<h3>Portal registration records (${item.participants.length})</h3><table><thead><tr><th>Name</th><th>Student ID</th><th>Program / College</th><th>Registration</th></tr></thead><tbody>${item.participants.map(p=>`<tr><td>${e(p.fullName)}</td><td>${e(p.studentId)}</td><td>${e(p.program)} / ${e(p.college)}</td><td>${e(p.status)} · ${e(date(p.registeredAt))}</td></tr>`).join('') || '<tr><td colspan="4">No registrations recorded.</td></tr>'}</tbody></table>`:''}</section>`).join('') || '<p>No matching records.</p>'}</body></html>`;
}
