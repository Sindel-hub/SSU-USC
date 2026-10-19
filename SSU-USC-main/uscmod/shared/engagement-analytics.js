import { STATUS_DEFINITIONS, classifyEngagement, buildEngagementReport, registrationSummary, reportDocument, escapeReportHtml as e } from './engagement-report-model.mjs';

export function mountEngagementAnalytics(root, { kind, canGenerate }) {
  const noun = kind==='programs'?'program':'event';
  const plural = kind==='programs'?'Programs':'Events';
  let records=[], registrations=new Map(), ready=false, error='', signature='';
  const date=ms=>ms==null?'Not recorded':new Date(ms).toLocaleString();
  root.classList.add('engagement-analytics');
  root.innerHTML = `<section class="engagement-status-panel" aria-labelledby="engagementStatusTitle">
    <h2 id="engagementStatusTitle">Status Report</h2><div class="engagement-status-grid">${STATUS_DEFINITIONS.slice(0,4).map(s=>`<button type="button" class="engagement-status-card" data-status="${s.name}"><span>${s.name}</span><span class="engagement-count-row"><i class="${s.icon}" aria-hidden="true" style="color:${s.color}"></i><strong ${s.name==='Upcoming'?'id="upcomingEventCount"':''} data-count="${s.name}">—</strong></span></button>`).join('')}</div>
    <button type="button" class="engagement-unscheduled" data-status="Unscheduled" hidden></button>
    <div class="engagement-metrics"><span><strong id="publishedEventCount">—</strong> Published</span><span><strong id="reminderEnabledCount">—</strong> Reminders</span><span><strong id="confirmedAttendanceCount">—</strong> Portal registrations</span></div>
  </section><section class="engagement-chart-panel" aria-labelledby="engagementChartTitle">
    <h2 id="engagementChartTitle">Active ${plural}</h2><button class="engagement-pie-button" type="button" aria-label="Open detailed status report"><span class="engagement-pie empty"></span></button>
    <div class="engagement-legend"></div><div class="engagement-chart-total"><strong data-total>—</strong><span>${noun}s</span><button class="engagement-open" type="button">View detailed report</button></div>
  </section><p class="engagement-feed-state" role="status">Loading ${noun}s…</p>`;
  const dialog=document.createElement('dialog');
  dialog.className='engagement-report-dialog';
  dialog.setAttribute('aria-labelledby','engagementReportTitle');
  dialog.innerHTML=`<header class="engagement-report-head"><div><h2 id="engagementReportTitle">${plural} detailed report</h2><p data-report-time></p></div><button type="button" class="engagement-close" aria-label="Close detailed report">×</button></header>
    <div class="engagement-report-controls"><label>${plural}<select data-record><option value="">All ${noun}s</option></select></label><label>Status<select data-filter><option value="all">All statuses</option>${STATUS_DEFINITIONS.map(s=>`<option>${s.name}</option>`).join('')}</select></label></div>
    <div class="engagement-report-body"><p data-report-summary role="status"></p><p class="engagement-data-note">Status follows the saved schedule. Portal registrations are not attendance; external participation and deleted history are not tracked.</p><div data-report-items></div></div>
    <footer class="engagement-report-footer"><label>Report format<select data-format><option value="html">Printable HTML</option><option value="json">JSON data</option></select></label><button type="button" class="engagement-generate" data-rbac-permission="reports.generate">Generate Status Report</button><p class="engagement-export-message" role="status"></p></footer>`;
  document.body.append(dialog);
  const recordSelect=dialog.querySelector('[data-record]'), statusSelect=dialog.querySelector('[data-filter]');
  const exportMessage=dialog.querySelector('.engagement-export-message');
  const currentReport=(overrides={})=>buildEngagementReport(records,registrations,{kind,recordId:recordSelect.value,status:statusSelect.value,...overrides});
  let returnFocus=null;
  function open(status='all') {
    statusSelect.value=status;recordSelect.value='';
    returnFocus=document.activeElement;
    renderReport();
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('.engagement-close').focus();
  }
  function close() { dialog.close();if(returnFocus?.isConnected)returnFocus.focus(); }
  function renderReport() {
    const nextSignature=JSON.stringify(records.map(r=>[r.id,r.title]));
    if(signature!==nextSignature) {
      const selected=recordSelect.value;
      recordSelect.innerHTML=`<option value="">All ${noun}s</option>`+records.map(r=>`<option value="${e(r.id)}">${e(r.title || 'Untitled')}</option>`).join('');
      recordSelect.value=records.some(r=>r.id===selected)?selected:'';signature=nextSignature;
    }
    const report=currentReport();
    dialog.querySelector('[data-report-time]').textContent=ready?`Updated ${new Date(report.generatedAt).toLocaleString()}`:'Data unavailable';
    dialog.querySelector('[data-report-summary]').textContent=error || (!ready?'Loading records…':`${report.total} ${noun}${report.total===1?'':'s'} · ${report.knownPortalRegistrations} known portal registrations${report.pendingOrUnavailable?` · ${report.pendingOrUnavailable} feeds pending/unavailable`:''}`);
    const host=dialog.querySelector('[data-report-items]');
    const previousScroll=host.parentElement.scrollTop;
    const focusedRecord=host.contains(document.activeElement)?document.activeElement.closest('[data-report-id]')?.dataset.reportId:null;
    const focusedPart=document.activeElement?.matches('[data-individual]')?'button':document.activeElement?.matches('.engagement-table-scroll')?'region':'summary';
    const openIds=new Set([...host.querySelectorAll('details[open]')].map(d=>d.dataset.reportId));
    host.innerHTML=error?'<p class="engagement-no-records">Reload this page to reconnect.</p>':!ready?'<p class="engagement-no-records">Loading records…</p>':report.items.map(item=>`<details class="engagement-record" data-report-id="${e(item.id)}"${openIds.has(item.id)?' open':''}><summary><span><strong>${e(item.title)}</strong><small>${e(item.eventDate || 'Date not set')} · ${e(registrationSummary(item))}</small></span><span class="engagement-record-status">${e(item.status)}</span></summary>
      <div class="engagement-record-body"><dl>${Object.entries({Schedule:`${item.eventDate || 'Not set'} ${item.startTime || 'All day'}${item.endTime?' – '+item.endTime:''}`,Venue:item.venue || 'Not set',...(kind==='programs'?{Host:item.hostOrganization || 'Not recorded'}:{}),Category:item.category || 'Not recorded',Audience:item.audience || 'Not recorded','Status basis':item.statusBasis,'Schedule elapsed':item.scheduleElapsedPercent==null?'Not available':`${item.scheduleElapsedPercent}% of scheduled window`,'Registration deadline':date(item.registrationDeadline),Published:date(item.publishedAt),Updated:date(item.updatedAt)}).map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl><p>${e(item.description)}</p>${item.participationNotes?`<h3>Participation instructions</h3><p>${e(item.participationNotes)}</p>`:''}${item.completion?`<p class="engagement-data-note">${e(item.completion)}</p>`:''}
      <h3>${e(registrationSummary(item))}</h3>${item.registrationAvailability==='ready'?`<div class="engagement-table-scroll" role="region" aria-label="Portal registrations" tabindex="0"><table><thead><tr><th>Name</th><th>Student ID</th><th>Program / college</th><th>Registered</th></tr></thead><tbody>${item.participants.map(p=>`<tr><td>${e(p.fullName || 'Not recorded')}</td><td>${e(p.studentId || 'Not recorded')}</td><td>${e(p.program)} / ${e(p.college)}</td><td>${e(p.status)}<small>${e(date(p.registeredAt))}</small></td></tr>`).join('') || '<tr><td colspan="4">No portal registrations recorded.</td></tr>'}</tbody></table></div>`:''}
      <button class="engagement-individual-report" data-rbac-permission="reports.generate" data-individual="${e(item.id)}" type="button"${canGenerate()?'':' disabled'}>Generate Status Report — this ${noun}</button></div></details>`).join('') || '<p class="engagement-no-records">No matching records.</p>';
    host.parentElement.scrollTop=previousScroll;
    if(focusedRecord){const record=[...host.querySelectorAll('[data-report-id]')].find(el=>el.dataset.reportId===focusedRecord);record?.querySelector(focusedPart==='button'?'[data-individual]':focusedPart==='region'?'.engagement-table-scroll':'summary')?.focus({preventScroll:true});}
    const allowed=canGenerate();
    dialog.querySelector('.engagement-generate').disabled=!ready || !!error || !allowed;
    if(!allowed)exportMessage.textContent='Report generation is not included in your assigned permissions.';
  }
  function generate(recordId) {
    if(!canGenerate()) {exportMessage.textContent='Report generation is not included in your assigned permissions.';return;}
    if(!ready || error) {exportMessage.textContent='Reconnect to the live records before generating a report.';return;}
    const report=currentReport(recordId?{recordId,status:'all'}:{});
    const json=dialog.querySelector('[data-format]').value==='json';
    const blob=new Blob([json?JSON.stringify(report,null,2):reportDocument(report)],{type:json?'application/json;charset=utf-8':'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=`${kind}-status-report-${new Date().toISOString().replace(/[:.]/g,'-')}.${json?'json':'html'}`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    exportMessage.textContent=`Generated ${report.total} ${noun}${report.total===1?'':'s'} from the current data snapshot${report.pendingOrUnavailable?'; some registrations are pending or unavailable':''}.`;
  }
  function refresh() {
    const report=buildEngagementReport(records,registrations,{kind});
    const total=report.total;
    root.querySelectorAll('[data-count]').forEach(el=>el.textContent=ready?String(report.breakdown[el.dataset.count]):'—');
    const unknown=root.querySelector('.engagement-unscheduled');unknown.hidden=!report.breakdown.Unscheduled;unknown.textContent=`${report.breakdown.Unscheduled} unscheduled — review date/time`;
    root.querySelector('[data-total]').textContent=ready?String(total):'—';
    root.querySelector('#publishedEventCount').textContent=ready?String(total):'—';
    root.querySelector('#reminderEnabledCount').textContent=ready?String(records.filter(r=>r.reminderEnabled===true).length):'—';
    root.querySelector('#confirmedAttendanceCount').textContent=ready?`${report.knownPortalRegistrations}${report.pendingOrUnavailable?` + ${report.pendingOrUnavailable} pending/unavailable`:''}`:'—';
    let angle=0;const stops=[];
    for(const s of STATUS_DEFINITIONS) {const end=angle+(total?report.breakdown[s.name]/total*100:0);if(end>angle)stops.push(`${s.color} ${angle}% ${end}%`);angle=end;}
    const pie=root.querySelector('.engagement-pie');pie.classList.toggle('empty',!total);pie.style.background=total?`conic-gradient(${stops.join(',')})`:'';
    root.querySelector('.engagement-pie-button').setAttribute('aria-label',`${ready?`${total} ${noun}s. ${STATUS_DEFINITIONS.map(s=>`${s.name}: ${report.breakdown[s.name]}`).join('. ')}`:'Data loading'}. Open detailed status report`);
    root.querySelector('.engagement-legend').innerHTML=STATUS_DEFINITIONS.filter(s=>s.name!=='Unscheduled'||report.breakdown.Unscheduled).map(s=>`<button type="button" data-status="${s.name}"><i aria-hidden="true" style="background:${s.color}"></i><span>${s.name}</span><strong>${ready?report.breakdown[s.name]:'—'}</strong><small>${ready?`${total?Math.round(report.breakdown[s.name]/total*100):0}%`:'—'}</small></button>`).join('');
    root.querySelector('.engagement-feed-state').textContent=error || (ready?`Live records · Status updated ${new Date().toLocaleTimeString()}`:`Loading ${noun}s…`);
    if(dialog.open)renderReport();
  }
  root.addEventListener('click',event=>{
    const status=event.target.closest('[data-status]');if(status){open(status.dataset.status);return;}
    if(event.target.closest('.engagement-open')){open();return;}
    const pie=event.target.closest('.engagement-pie-button');if(!pie)return;
    if(!event.detail || !records.length){open();return;}
    const bounds=root.querySelector('.engagement-pie').getBoundingClientRect();
    const x=event.clientX-(bounds.left+bounds.width/2), y=event.clientY-(bounds.top+bounds.height/2);
    if(Math.hypot(x,y)>bounds.width/2){open();return;}
    const pct=((Math.atan2(x,-y)+2*Math.PI)%(2*Math.PI))/(2*Math.PI)*100;
    const report=buildEngagementReport(records,registrations,{kind});let end=0;
    for(const s of STATUS_DEFINITIONS){end+=report.total?report.breakdown[s.name]/report.total*100:0;if(pct<end){open(s.name);return;}}open();
  });
  dialog.querySelector('.engagement-close').addEventListener('click',close);
  dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus();else root.querySelector('.engagement-open').focus();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}const item=event.target.closest('[data-individual]');if(item)generate(item.dataset.individual);});
  dialog.querySelector('.engagement-generate').addEventListener('click',()=>generate());
  recordSelect.addEventListener('change',()=>{statusSelect.value='all';exportMessage.textContent='';renderReport();});statusSelect.addEventListener('change',()=>{exportMessage.textContent='';renderReport();});
  window.addEventListener('usc-officer-profile-updated',()=>{if(dialog.open)renderReport();});
  refresh();
  return { update(nextRecords,nextRegistrations) { records=nextRecords;registrations=nextRegistrations;ready=true;error='';refresh(); }, setError(message) { ready=false;error=message;records=[];registrations=new Map();refresh(); } };
}
