import { db } from "../../../firebase/firebase-config.js";
import { collection, collectionGroup, doc, getCountFromServer, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { callSecure } from "../../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const PENDING_COMPLAINT_STATUSES = new Set(["Submitted", "Under Review", "In Review", "In Progress"]);
const state = {
  events: [],
  programs: [],
  announcements: [],
  complaints: [],
  election: null,
  electionTurnout: { votes: 0, eligible: 0, departmentVotes: {} },
  eventRegistrations: [],
  programRegistrations: [],
  complaintAnalytics: { total: 0, active: 0, resolved: 0, closed: 0, student: 0, administrative: 0, crisis: 0 },
  signInStats: []
};

const clean = (value, fallback = "") => String(value ?? fallback).trim();
const toDate = (value) => { if (!value) return null; const d = value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
const formatDate = (value) => { const d = toDate(value); return d ? d.toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" }) : "N/A"; };
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function setText(selector, value) { document.querySelectorAll(selector).forEach(el => el.textContent = String(value)); }
function canonicalRole(_email, role) { const value=clean(role,"student").toLowerCase(); return ["student","officer","admin"].includes(value)?value:"student"; }
function getEventDate(item){ return toDate(item.eventDate || item.date || item.startDate); }
function eventImage(item){ return clean(item.backgroundImageUrl || item.imageUrl || item.eventImageUrl || item.posterUrl); }
function announcementImage(item){ return clean(item.imageUrl || item.imageURL || item.posterUrl || item.announcementImageUrl); }

function formatTimeRange(item) {
  const start = clean(item.startTime);
  const end = clean(item.endTime);
  if (start && end) return `${start} - ${end}`;
  return start || end || "Time to be announced";
}

function formatEventDateLabel(item) {
  const date = getEventDate(item);
  if (!date) return "Date to be announced";
  const dateText = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  const timeText = formatTimeRange(item);
  return timeText && timeText !== "Time to be announced" ? `${dateText} • ${timeText}` : dateText;
}

function daysUntil(value) {
  const date = toDate(value);
  if (!date) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

function eventCategory(item) {
  return clean(item.category || item.eventCategory || item.type || item.eventType, "General Event");
}

function registrationModeLabel(item) {
  const mode = clean(item.registrationMode, "none").toLowerCase();
  if (mode === "internal") return "Portal";
  if (mode === "external") return "External";
  return "Open";
}

function registrationStatus(item) {
  const mode = clean(item.registrationMode, "none").toLowerCase();
  const deadline = toDate(item.registrationDeadline);
  const now = new Date();
  if (mode === "internal") {
    if (deadline && deadline < now) return { label: "Registration closed", className: "closed" };
    return { label: "Registration open", className: "open" };
  }
  if (mode === "external") {
    if (deadline && deadline < now) return { label: "External closed", className: "closed" };
    return { label: "External form", className: "external" };
  }
  return { label: "Participation details", className: "info" };
}

function eventCountdownLabel(item) {
  const days = daysUntil(getEventDate(item));
  if (days === null) return { value: "--", label: "Awaiting schedule" };
  if (days < 0) return { value: `${Math.abs(days)}`, label: "days ago" };
  if (days === 0) return { value: "Today", label: "Happening now" };
  if (days === 1) return { value: "1", label: "day left" };
  return { value: String(days), label: "days left" };
}

function eventRegistrationCounts() {
  const counts = new Map();
  for (const item of state.eventRegistrations) {
    if (clean(item.status, "registered").toLowerCase() !== "registered") continue;
    const eventId = clean(item.eventId);
    if (!eventId) continue;
    counts.set(eventId, (counts.get(eventId) || 0) + 1);
  }
  return counts;
}

function programRegistrationCounts() {
  const counts = new Map();
  for (const item of state.programRegistrations) {
    if (clean(item.status, "registered").toLowerCase() !== "registered") continue;
    const programId = clean(item.programId);
    if (!programId) continue;
    counts.set(programId, (counts.get(programId) || 0) + 1);
  }
  return counts;
}

function renderToday(){ const el=document.getElementById("officerTodayLabel"); if(el) el.textContent=new Date().toLocaleDateString([], {month:"long",day:"numeric",year:"numeric"}); }


function formatCount(value) {
  return Math.max(0, Number(value || 0)).toLocaleString();
}

function analyticsBarRows(hostId, entries = [], total = 0, emptyText = "No data yet.") {
  const host = document.getElementById(hostId);
  if (!host) return;
  const normalized = entries
    .map(([label, value]) => [clean(label, "Unspecified"), Math.max(0, Number(value || 0))])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6);
  if (!normalized.length) {
    host.innerHTML = `<div class="analytics-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  const denominator = Math.max(1, Number(total || normalized.reduce((sum, row) => sum + row[1], 0)));
  host.innerHTML = normalized.map(([label, value]) => {
    const share = Math.min(100, Math.max(2, (value / denominator) * 100));
    return `<div class="analytics-bar-row">
      <div class="analytics-bar-label"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><b>${formatCount(value)}</b></div>
      <div class="analytics-bar-track"><i style="width:${share.toFixed(1)}%"></i></div>
    </div>`;
  }).join("");
}

function registrationStudentLabel(item) {
  return clean(item.fullName || item.studentName || item.name || item.studentId, "Student");
}

function registrationAcademicProgram(item) {
  return clean(item.program || item.college, "Unspecified program");
}

function renderRecentRegistrantList(hostId, registrations, targetNames, targetIdField, emptyText) {
  const host = document.getElementById(hostId);
  if (!host) return;
  const recent = [...registrations]
    .filter(item => clean(item.status, "registered").toLowerCase() === "registered")
    .sort((a, b) => (toDate(b.registeredAt)?.getTime() || 0) - (toDate(a.registeredAt)?.getTime() || 0))
    .slice(0, 4);
  if (!recent.length) {
    host.innerHTML = `<div class="analytics-registrants-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  host.innerHTML = recent.map(item => {
    const targetId = clean(item[targetIdField]);
    const targetName = targetNames.get(targetId) || (targetIdField === "programId" ? "External Program" : "USC Event");
    return `<div class="analytics-registrant-row">
      <span class="analytics-registrant-avatar"><i class="fa-solid fa-user"></i></span>
      <span class="analytics-registrant-copy"><strong>${escapeHtml(registrationStudentLabel(item))}</strong><small>${escapeHtml(clean(item.studentId, registrationAcademicProgram(item)))}</small></span>
      <span class="analytics-registrant-target" title="${escapeHtml(targetName)}">${escapeHtml(targetName)}</span>
    </div>`;
  }).join("");
}

function renderEventParticipationAnalytics() {
  const registrations = state.eventRegistrations.filter(item => clean(item.status, "registered").toLowerCase() === "registered");
  const uniqueStudents = new Set(registrations.map(item => clean(item.studentUid)).filter(Boolean));
  const academicPrograms = new Map();
  const perEvent = new Map();
  for (const item of registrations) {
    const academicProgram = registrationAcademicProgram(item);
    academicPrograms.set(academicProgram, (academicPrograms.get(academicProgram) || 0) + 1);
    const eventId = clean(item.eventId, "Unknown event");
    perEvent.set(eventId, (perEvent.get(eventId) || 0) + 1);
  }

  const now = new Date();
  const openInternalEvents = state.events.filter(item => {
    const mode = clean(item.registrationMode, "none").toLowerCase();
    const deadline = toDate(item.registrationDeadline);
    return clean(item.status, "Published").toLowerCase() === "published"
      && mode === "internal"
      && (!deadline || deadline > now);
  }).length;

  setText("[data-analytics-event-registrations]", formatCount(registrations.length));
  setText("[data-analytics-event-students]", formatCount(uniqueStudents.size));
  setText("[data-analytics-event-open]", formatCount(openInternalEvents));
  analyticsBarRows("eventProgramAnalytics", [...academicPrograms.entries()], registrations.length, "No event registrations yet.");

  const eventNames = new Map(state.events.map(item => [item.id, clean(item.title || item.name, "USC Event")]));
  const highlightHost = document.getElementById("eventRegistrationHighlights");
  if (highlightHost) {
    const topEvents = [...perEvent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    highlightHost.innerHTML = topEvents.length
      ? topEvents.map(([eventId, count]) => `<span><b>${formatCount(count)}</b> ${escapeHtml(eventNames.get(eventId) || "Event")}</span>`).join("")
      : "<span>No event participation data yet.</span>";
  }
  renderRecentRegistrantList("eventRecentRegistrants", registrations, eventNames, "eventId", "No students have registered for an event yet.");
}

function renderProgramParticipationAnalytics() {
  const registrations = state.programRegistrations.filter(item => clean(item.status, "registered").toLowerCase() === "registered");
  const uniqueStudents = new Set(registrations.map(item => clean(item.studentUid)).filter(Boolean));
  const academicPrograms = new Map();
  const perProgram = new Map();
  for (const item of registrations) {
    const academicProgram = registrationAcademicProgram(item);
    academicPrograms.set(academicProgram, (academicPrograms.get(academicProgram) || 0) + 1);
    const programId = clean(item.programId, "Unknown program");
    perProgram.set(programId, (perProgram.get(programId) || 0) + 1);
  }

  const now = new Date();
  const openInternalPrograms = state.programs.filter(item => {
    const mode = clean(item.registrationMode, "none").toLowerCase();
    const deadline = toDate(item.registrationDeadline);
    return clean(item.status, "Published").toLowerCase() === "published"
      && mode === "internal"
      && (!deadline || deadline > now);
  }).length;

  setText("[data-analytics-program-registrations]", formatCount(registrations.length));
  setText("[data-analytics-program-students]", formatCount(uniqueStudents.size));
  setText("[data-analytics-program-open]", formatCount(openInternalPrograms));
  analyticsBarRows("programStudentAnalytics", [...academicPrograms.entries()], registrations.length, "No program registrations yet.");

  const programNames = new Map(state.programs.map(item => [item.id, clean(item.title || item.name, "External Program")]));
  const highlightHost = document.getElementById("programRegistrationHighlights");
  if (highlightHost) {
    const topPrograms = [...perProgram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    highlightHost.innerHTML = topPrograms.length
      ? topPrograms.map(([programId, count]) => `<span><b>${formatCount(count)}</b> ${escapeHtml(programNames.get(programId) || "Program")}</span>`).join("")
      : "<span>No program participation data yet.</span>";
  }
  renderRecentRegistrantList("programRecentRegistrants", registrations, programNames, "programId", "No students have registered for a program yet.");
}

function registrationSource(registrationDoc, data) {
  if (clean(data.programId)) return "program";
  if (clean(data.eventId)) return "event";
  try {
    const parentCollection = registrationDoc.ref?.parent?.parent?.parent?.id;
    if (parentCollection === "programs") return "program";
    if (parentCollection === "events") return "event";
  } catch {}
  return "unknown";
}

function bindParticipationRegistrationAnalytics() {
  onSnapshot(collectionGroup(db, "registrations"), snapshot => {
    const events = [];
    const programs = [];
    snapshot.docs.forEach(registrationDoc => {
      const data = { id: registrationDoc.id, ...registrationDoc.data() };
      const source = registrationSource(registrationDoc, data);
      if (source === "program") programs.push(data);
      else if (source === "event") events.push(data);
    });
    state.eventRegistrations = events;
    state.programRegistrations = programs;
    renderEventParticipationAnalytics();
    renderProgramParticipationAnalytics();
    renderEvents();
    renderPrograms();
  }, error => {
    console.warn("Participation registration analytics unavailable:", error);
    state.eventRegistrations = [];
    state.programRegistrations = [];
    renderEventParticipationAnalytics();
    renderProgramParticipationAnalytics();
    renderEvents();
    renderPrograms();
  });
}

function renderRecentComplaints(){
  const host=document.getElementById("officerRecentComplaints");
  if(!host)return;
  const recent=state.complaints.slice(0,4);
  if(!recent.length){host.innerHTML='<div class="reference-empty">No complaints yet.</div>';return;}
  host.innerHTML=recent.map(item=>{
    const status=clean(item.status,"Submitted");
    const statusClass=status.toLowerCase().replace(/\s+/g,"-");
    return `<article class="management-case-item"><div class="management-case-icon"><i class="fa-solid fa-message"></i></div><div class="management-case-copy"><strong>${escapeHtml(clean(item.subject,"Student complaint"))}</strong><span>${escapeHtml(clean(item.complaintRef||item.ticketId||item.id,"Case"))} • ${escapeHtml(formatDate(item.updatedAt||item.createdAt))}</span></div><span class="management-case-status ${escapeHtml(statusClass)}">${escapeHtml(status)}</span></article>`;
  }).join("");
}
let complaintCountRefreshTimer = 0;
async function refreshComplaintDashboardStats(){
  try {
    const pendingQuery = query(collection(db,"complaints"), where("status","in",Array.from(PENDING_COMPLAINT_STATUSES)));
    const studentQuery = query(collection(db,"complaints"), where("classification","==","Student Level"));
    const administrativeQuery = query(collection(db,"complaints"), where("classification","==","Administrative Level"));
    const crisisQuery = query(collection(db,"complaints"), where("classification","==","Crisis Level"));
    const resolvedQuery = query(collection(db,"complaints"), where("status","==","Resolved"));
    const closedQuery = query(collection(db,"complaints"), where("status","==","Closed"));
    const [total, pending, resolved, closed, student, administrative, crisis] = await Promise.all([
      getCountFromServer(collection(db,"complaints")),
      getCountFromServer(pendingQuery),
      getCountFromServer(resolvedQuery),
      getCountFromServer(closedQuery),
      getCountFromServer(studentQuery),
      getCountFromServer(administrativeQuery),
      getCountFromServer(crisisQuery)
    ]);
    setText("[data-overview-total-complaints]", total.data().count || 0);
    setText("[data-overview-pending-complaints]", pending.data().count || 0);
    setText("[data-overview-complaint-student]", student.data().count || 0);
    setText("[data-overview-complaint-administrative]", administrative.data().count || 0);
    setText("[data-overview-complaint-crisis]", crisis.data().count || 0);
    state.complaintAnalytics = {
      total: total.data().count || 0,
      active: pending.data().count || 0,
      resolved: resolved.data().count || 0,
      closed: closed.data().count || 0,
      student: student.data().count || 0,
      administrative: administrative.data().count || 0,
      crisis: crisis.data().count || 0
    };
    renderComplaintAnalytics();
  } catch (error) {
    console.warn("Complaint dashboard statistics unavailable:", error);
  }
}
function schedulePendingComplaintCountRefresh(){
  clearTimeout(complaintCountRefreshTimer);
  complaintCountRefreshTimer = setTimeout(refreshComplaintDashboardStats, 700);
}
function bindComplaintSummary(){
  const recentQuery = query(collection(db,"complaints"), orderBy("createdAt","desc"), limit(4));
  onSnapshot(recentQuery, snap => {
    state.complaints = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderRecentComplaints();
    schedulePendingComplaintCountRefresh();
  }, error => {
    console.warn("Recent complaint listener unavailable:", error);
    state.complaints=[];
    renderRecentComplaints();
  });
  refreshComplaintDashboardStats();
  setInterval(refreshComplaintDashboardStats, 30000);
}
async function bindOfficerSummary(){
  const refresh=async()=>{
    try{
      const metrics=await callSecure("getOfficerDashboardMetrics");
      setText("[data-overview-officer-count]",Number(metrics.activeOfficerCount||0));
    }catch(error){console.warn("Officer metric unavailable:",error);setText("[data-overview-officer-count]",0);}
  };
  await refresh();
  setInterval(refresh,60000);
}
async function bindVoteSummary(){
  try{
    const context=await callSecure("getElectionContext");
    onSnapshot(doc(db,"elections",context.electionId,"turnout","public"), snap => {
      const data=snap.exists()?snap.data():{};
      const votes=Number(data.ballotsCast||0);
      const eligible=Number(data.eligibleVoters||context.eligibleVoterCount||0);
      const turnout=eligible?votes/eligible*100:0;
      state.electionTurnout = {
        votes,
        eligible,
        departmentVotes: data.departmentVotes && typeof data.departmentVotes === "object" ? data.departmentVotes : {}
      };
      renderElectionParticipationAnalytics();
      setText("[data-overview-election-registered]",eligible.toLocaleString());
      setText("[data-overview-election-votes-cast]",votes.toLocaleString());
      setText("[data-overview-election-turnout]",`${turnout.toFixed(1)}%`);
    },()=>{setText("[data-overview-election-registered]",0);setText("[data-overview-election-votes-cast]",0);setText("[data-overview-election-turnout]","0.0%");});
  }catch(error){ console.warn("Election turnout unavailable:",error); setText("[data-overview-election-votes-cast]",0); setText("[data-overview-election-turnout]","0.0%"); }
}

function syncDashboardLayout(hasBulletin){ const grid=document.querySelector('.reference-dashboard-grid'); const bulletinPanel=document.querySelector('.reference-bulletin-panel'); if(grid){ grid.classList.remove('dashboard-expanded'); grid.classList.toggle('dashboard-no-bulletin', !hasBulletin); } if(bulletinPanel) bulletinPanel.classList.toggle('is-collapsed', !hasBulletin); }
function renderBulletin(){ const host=document.getElementById("officerBulletinPreview"); if(!host)return; const item=state.announcements[0]; if(!item){host.innerHTML='<div class="reference-empty">No announcement posted yet.</div>'; syncDashboardLayout(false); return;} const image=announcementImage(item); host.innerHTML=`${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(clean(item.title,'Announcement'))}" onerror="this.style.display='none'">`:''}<div class="bulletin-copy"><time>${escapeHtml(formatDate(item.createdAt||item.publishedAt||item.date))}</time><h3>${escapeHtml(clean(item.title,'USC Announcement'))}</h3><p>${escapeHtml(clean(item.content||item.description,'Official USC bulletin update.').slice(0,180))}</p><a href="../announcements/announcements.html">Open Bulletin Board Center</a></div>`; syncDashboardLayout(true); }
function bindAnnouncements(){ onSnapshot(collection(db,"announcements"), snap => { state.announcements=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(toDate(b.createdAt||b.publishedAt)?.getTime()||0)-(toDate(a.createdAt||a.publishedAt)?.getTime()||0)); setText("[data-overview-announcement-count]",state.announcements.length); renderBulletin(); },()=>renderBulletin()); }

function renderCalendar(){
  const monthEl=document.getElementById("officerCalendarMonth"), daysEl=document.getElementById("officerCalendarDays");
  if(!monthEl||!daysEl)return;
  const next=state.events.find(e=>getEventDate(e))||null;
  const base=getEventDate(next)||new Date();
  const y=base.getFullYear(),m=base.getMonth();
  const today=new Date();
  monthEl.textContent=base.toLocaleDateString([], {month:"long",year:"numeric"});
  const first=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate(), prevTotal=new Date(y,m,0).getDate();
  const focusDay = getEventDate(next);
  const focusDate = focusDay && focusDay.getMonth()===m && focusDay.getFullYear()===y ? focusDay.getDate() : null;
  const eventDays=new Set(state.events.map(getEventDate).filter(Boolean).filter(d=>d.getMonth()===m&&d.getFullYear()===y).map(d=>d.getDate()));
  const cells=[];
  for(let i=first-1;i>=0;i--)cells.push(`<span class="muted">${prevTotal-i}</span>`);
  for(let d=1;d<=total;d++){
    const classes=[];
    if(eventDays.has(d)) classes.push('event-day');
    if(today.getDate()===d && today.getMonth()===m && today.getFullYear()===y) classes.push('today');
    if(focusDate===d) classes.push('focus-day');
    cells.push(`<span class="${classes.join(' ')}">${d}</span>`);
  }
  let nextDay=1;
  while(cells.length<35)cells.push(`<span class="muted">${nextDay++}</span>`);
  daysEl.innerHTML=cells.join('');
}
function renderEvents(){
  const host=document.getElementById("officerOverviewEvents");
  if(!host)return;
  const today=new Date();
  today.setHours(0,0,0,0);
  const upcoming=state.events.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).slice(0,4);
  if(!upcoming.length){
    host.style.removeProperty('--overview-event-bg');
    host.innerHTML=`<div class="overview-event-empty-state"><span class="overview-event-badge primary">EVENT CENTER</span><h3>No upcoming events yet</h3><p>Create an event to start highlighting participation, schedules, and student registrations here.</p><a href="../events/events.html">Open Events Management</a></div>`;
    renderCalendar();
    return;
  }

  const counts=eventRegistrationCounts();
  const featured=upcoming[0];
  const featuredDate=getEventDate(featured);
  const featuredStatus=registrationStatus(featured);
  const featuredCountdown=eventCountdownLabel(featured);
  const featuredRegistrations=counts.get(featured.id)||0;
  const totalUpcoming=upcoming.length;
  const openCount=upcoming.filter(item=>registrationStatus(item).className !== 'closed').length;
  const image=eventImage(featured);
  if(image){
    host.style.setProperty('--overview-event-bg', `url("${image.replace(/"/g,'%22')}")`);
  }else{
    host.style.removeProperty('--overview-event-bg');
  }

  host.innerHTML=`
    <div class="overview-event-hero">
      <div class="overview-event-badges">
        <span class="overview-event-badge primary">NEXT SPOTLIGHT</span>
        <span class="overview-event-badge ${escapeHtml(featuredStatus.className)}">${escapeHtml(featuredStatus.label)}</span>
      </div>
      <h3>${escapeHtml(clean(featured.title||featured.name,'USC Event'))}</h3>
      <p class="overview-event-meta">${escapeHtml(formatEventDateLabel(featured))}</p>
      <p class="overview-event-location">${escapeHtml(clean(featured.venue||featured.location,'Samar State University'))}</p>
      <div class="overview-event-insights">
        <span><strong>${escapeHtml(featuredCountdown.value)}</strong><small>${escapeHtml(featuredCountdown.label)}</small></span>
        <span><strong>${formatCount(featuredRegistrations)}</strong><small>Portal registrations</small></span>
        <span><strong>${escapeHtml(registrationModeLabel(featured))}</strong><small>Registration mode</small></span>
      </div>
    </div>
    <div class="overview-event-queue">
      <div class="overview-event-queue-head">
        <strong>${formatCount(totalUpcoming)}</strong> <span>upcoming events</span>
        <em>${formatCount(openCount)} open for participation</em>
      </div>
      <div class="overview-event-queue-list">
        ${upcoming.map(item=>{
          const d=getEventDate(item);
          const status=registrationStatus(item);
          const count=counts.get(item.id)||0;
          return `<article class="overview-event-item">
            <div class="overview-event-date"><small>${d?d.toLocaleDateString([], {month:'short'}).toUpperCase():'EVENT'}</small><strong>${d?d.getDate():'-'}</strong></div>
            <div class="overview-event-copy">
              <div class="overview-event-item-top">
                <h4>${escapeHtml(clean(item.title||item.name,'USC Event'))}</h4>
                <span class="overview-event-chip ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
              </div>
              <p>${escapeHtml(clean(item.venue||item.location,'Samar State University'))}</p>
              <div class="overview-event-item-meta">
                <span>${escapeHtml(eventCategory(item))}</span>
                <span>${formatCount(count)} registered</span>
              </div>
            </div>
          </article>`;
        }).join('')}
      </div>
    </div>`;
  renderCalendar();
}
function renderPrograms(){
  const host=document.getElementById("officerOverviewPrograms");
  if(!host)return;
  const today=new Date();
  today.setHours(0,0,0,0);
  const upcoming=state.programs.filter(item=>{const d=getEventDate(item);return d&&d>=today;}).slice(0,4);
  if(!upcoming.length){
    host.innerHTML=`<div class="overview-program-empty-state"><span class="overview-program-badge">EXTERNAL PROGRAMS</span><h3>No upcoming programs yet</h3><p>Publish an outside-university opportunity, training, outreach, scholarship, or partner activity to feature it here.</p><a href="../programs/programs.html"><i class="fa-solid fa-earth-americas"></i> Open Programs</a></div>`;
    return;
  }
  const counts=programRegistrationCounts();
  const featured=upcoming[0];
  const featuredDate=getEventDate(featured);
  const featuredStatus=registrationStatus(featured);
  const featuredCount=counts.get(featured.id)||0;
  const hostOrg=clean(featured.hostOrganization || featured.organizer || featured.partnerOrganization,"External Partner");
  host.innerHTML=`
    <div class="overview-program-featured">
      <div class="overview-program-topline"><span class="overview-program-badge"><i class="fa-solid fa-earth-americas"></i> NEXT PROGRAM</span><span class="overview-event-chip ${escapeHtml(featuredStatus.className)}">${escapeHtml(featuredStatus.label)}</span></div>
      <div class="overview-program-icon"><i class="fa-solid fa-handshake-angle"></i></div>
      <h3>${escapeHtml(clean(featured.title||featured.name,'External Program'))}</h3>
      <p>${escapeHtml(formatEventDateLabel(featured))}</p>
      <div class="overview-program-meta"><span><i class="fa-solid fa-building"></i>${escapeHtml(hostOrg)}</span><span><i class="fa-solid fa-location-dot"></i>${escapeHtml(clean(featured.venue||featured.location,'External venue'))}</span></div>
      <div class="overview-program-stats"><span><strong>${formatCount(featuredCount)}</strong><small>registered</small></span><span><strong>${escapeHtml(registrationModeLabel(featured))}</strong><small>registration</small></span></div>
    </div>
    <div class="overview-program-list">
      <div class="overview-program-list-head"><strong>${formatCount(upcoming.length)}</strong><span>upcoming programs</span><a href="../programs/programs.html">Manage <i class="fa-solid fa-arrow-up-right-from-square"></i></a></div>
      ${upcoming.map(item=>{
        const d=getEventDate(item); const count=counts.get(item.id)||0; const status=registrationStatus(item);
        return `<article class="overview-program-item"><span class="overview-program-date"><small>${d?d.toLocaleDateString([], {month:'short'}).toUpperCase():'TBA'}</small><strong>${d?d.getDate():'-'}</strong></span><span class="overview-program-copy"><strong>${escapeHtml(clean(item.title||item.name,'External Program'))}</strong><small>${escapeHtml(clean(item.hostOrganization||item.organizer||item.partnerOrganization,'External Partner'))}</small></span><span class="overview-program-count"><b>${formatCount(count)}</b><small>registered</small></span><span class="overview-program-status ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span></article>`;
      }).join('')}
    </div>`;
}

function bindEvents(){ onSnapshot(collection(db,"events"), snap => { state.events=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(getEventDate(a)?.getTime()||Infinity)-(getEventDate(b)?.getTime()||Infinity)); const today=new Date();today.setHours(0,0,0,0);const upcomingCount=state.events.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).length; setText("[data-overview-upcoming-events]",upcomingCount); renderEvents(); renderEventParticipationAnalytics(); },()=>{state.events=[];setText("[data-overview-upcoming-events]",0);renderEvents();renderEventParticipationAnalytics();}); }

function bindPrograms(){ onSnapshot(collection(db,"programs"), snap => { state.programs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(getEventDate(a)?.getTime()||Infinity)-(getEventDate(b)?.getTime()||Infinity)); const today=new Date();today.setHours(0,0,0,0);const upcomingCount=state.programs.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).length; setText("[data-overview-upcoming-programs]",upcomingCount); renderPrograms(); renderProgramParticipationAnalytics(); },()=>{state.programs=[];setText("[data-overview-upcoming-programs]",0);renderPrograms();renderProgramParticipationAnalytics();}); }

function updateElectionControls(context={}){
  state.election=context;
  renderElectionParticipationAnalytics();
  const statusEl=document.getElementById("overviewElectionStatus"), noteEl=document.getElementById("overviewElectionPhaseNote");
  if(statusEl)statusEl.textContent=`Current phase: ${context.lifecycle||"Unavailable"}`;
  if(noteEl)noteEl.textContent=context.lifecycle
    ? `Server-verified lifecycle: ${context.lifecycle}. Sensitive election actions are authorized by backend time and security rules.`
    : "Election services are unavailable. Sensitive actions remain locked.";
}
async function bindElectionSettings(){
  const refresh=async()=>{try{updateElectionControls(await callSecure("getElectionContext"));}catch(error){console.warn(error);updateElectionControls({});}};
  await refresh(); setInterval(refresh,30000);
}

const SIGNIN_ANALYTICS_COLORS = [
  "#c36ee8", "#df83ed", "#ee9bed", "#ad3fc9", "#7d2aaa",
  "#5a73d9", "#3ca4d9", "#52b8a5", "#e2ad49", "#dc707e"
];

function sameLocalDay(value, reference = new Date()) {
  const date = toDate(value);
  return Boolean(date)
    && date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function summarizeStudentSignIns() {
  const groups = new Map();
  let sessions = 0;
  let activeToday = 0;
  let uniqueStudents = 0;
  let restoredHistorical = 0;
  const today = new Date();

  for (const item of state.signInStats) {
    const department = clean(item.department, "Unspecified department");
    const signInCount = Math.max(0, Number(item.signInCount || 0));
    const hasSignedIn = signInCount > 0;
    const lastSignInAt = toDate(item.lastSignInAt);
    sessions += signInCount;
    if (hasSignedIn) uniqueStudents += 1;
    if (hasSignedIn && sameLocalDay(lastSignInAt, today)) activeToday += 1;
    if (hasSignedIn && item.legacyBackfill === true) restoredHistorical += 1;

    const current = groups.get(department) || {
      department,
      accountCount: 0,
      uniqueStudents: 0,
      sessions: 0,
      lastSignInAt: null
    };
    current.accountCount += 1;
    if (hasSignedIn) current.uniqueStudents += 1;
    current.sessions += signInCount;
    if (lastSignInAt && (!current.lastSignInAt || lastSignInAt > current.lastSignInAt)) {
      current.lastSignInAt = lastSignInAt;
    }
    groups.set(department, current);
  }

  const departments = [...groups.values()].sort((left, right) =>
    right.uniqueStudents - left.uniqueStudents
    || right.accountCount - left.accountCount
    || right.sessions - left.sessions
    || left.department.localeCompare(right.department)
  );
  departments.forEach((item, index) => {
    item.color = SIGNIN_ANALYTICS_COLORS[index % SIGNIN_ANALYTICS_COLORS.length];
    item.share = uniqueStudents ? item.uniqueStudents / uniqueStudents * 100 : 0;
  });

  return {
    knownAccounts: state.signInStats.length,
    uniqueStudents,
    sessions,
    activeToday,
    restoredHistorical,
    departments
  };
}

function buildDonutGradient(departments) {
  const visible = departments.filter((item) => item.share > 0);
  if (!visible.length) return "#e8f0f4";
  let cursor = 0;
  const stops = visible.map((item) => {
    const start = cursor;
    cursor += item.share;
    return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  if (cursor < 100) stops.push(`#e8f0f4 ${cursor.toFixed(2)}% 100%`);
  return `conic-gradient(${stops.join(", ")})`;
}

function formatSignInMoment(value) {
  const date = toDate(value);
  if (!date) return "No tracked sign-in yet";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderStudentSignInAnalytics(errorMessage = "") {
  const summary = summarizeStudentSignIns();
  const gradient = buildDonutGradient(summary.departments);
  const miniDonut = document.getElementById("signinAnalyticsMiniDonut");
  const largeDonut = document.getElementById("signinAnalyticsLargeDonut");
  const legend = document.getElementById("signinAnalyticsMiniLegend");
  const table = document.getElementById("signinAnalyticsTable");
  const updated = document.getElementById("signinAnalyticsUpdated");
  const historyNote = document.getElementById("signinAnalyticsHistoryNote");

  setText("[data-signin-known-accounts]", summary.knownAccounts.toLocaleString());
  setText("[data-signin-unique]", summary.uniqueStudents.toLocaleString());
  setText("[data-signin-sessions]", summary.sessions.toLocaleString());
  setText("[data-signin-today]", summary.activeToday.toLocaleString());
  setText("[data-signin-departments]", summary.departments.length.toLocaleString());
  if (miniDonut) miniDonut.style.background = gradient;
  if (largeDonut) largeDonut.style.background = gradient;

  if (historyNote) {
    historyNote.textContent = summary.restoredHistorical
      ? `${summary.restoredHistorical.toLocaleString()} pre-feature student account${summary.restoredHistorical === 1 ? "" : "s"} include restored historical login activity.`
      : summary.knownAccounts
        ? "Pre-feature student accounts are included as a baseline. Accounts without an older login timestamp stay at 0 tracked sign-ins until their next login."
        : "Pre-feature student accounts will be imported when the System Administrator opens the Admin Dashboard.";
  }

  if (errorMessage) {
    if (legend) legend.innerHTML = `<span class="signin-analytics-error">${escapeHtml(errorMessage)}</span>`;
    if (table) table.innerHTML = `<div class="signin-analytics-empty signin-analytics-error">${escapeHtml(errorMessage)}</div>`;
    if (updated) updated.textContent = "Analytics unavailable";
    return;
  }

  if (!summary.departments.length) {
    if (legend) legend.innerHTML = "<span>No student account data yet.</span>";
    if (table) table.innerHTML = '<div class="signin-analytics-empty">No student accounts have been imported yet. Open the System Administrator dashboard once after deploying the included Firestore rules to backfill existing accounts.</div>';
    if (updated) updated.textContent = "Waiting for student account data...";
    return;
  }

  if (legend) {
    const visible = summary.departments.slice(0, 3);
    legend.innerHTML = visible.map(item => `
      <span class="mini-legend-item">
        <i class="mini-legend-dot" style="--legend-color:${item.color}"></i>
        <strong>${escapeHtml(item.department)}</strong> ${item.uniqueStudents}/${item.accountCount}
      </span>`).join("") + (summary.departments.length > 3
        ? `<span>+${summary.departments.length - 3} more</span>`
        : "");
  }

  if (table) {
    table.innerHTML = summary.departments.map(item => `
      <div class="signin-analytics-row">
        <div class="signin-analytics-dept">
          <i class="signin-analytics-dept-dot" style="--legend-color:${item.color}"></i>
          <div class="signin-analytics-dept-copy">
            <strong title="${escapeHtml(item.department)}">${escapeHtml(item.department)}</strong>
            <small>Last: ${escapeHtml(formatSignInMoment(item.lastSignInAt))}</small>
          </div>
        </div>
        <div class="signin-analytics-stat accounts"><strong>${item.accountCount.toLocaleString()}</strong><small>accounts</small></div>
        <div class="signin-analytics-stat students"><strong>${item.uniqueStudents.toLocaleString()}</strong><small>signed in</small></div>
        <div class="signin-analytics-stat sessions"><strong>${item.sessions.toLocaleString()}</strong><small>sign-ins</small></div>
        <div class="signin-analytics-share">${item.share.toFixed(1)}%</div>
      </div>`).join("");
  }

  if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function setSignInAnalyticsExpanded(expanded, shouldScroll = false) {
  const detail = document.getElementById("signinAnalyticsDetail");
  const summaryButton = document.getElementById("signinAnalyticsSummary");
  const headingButton = document.getElementById("signinAnalyticsHeadingToggle");
  if (!detail) return;
  detail.hidden = !expanded;
  summaryButton?.setAttribute("aria-expanded", String(expanded));
  headingButton?.setAttribute("aria-expanded", String(expanded));
  if (headingButton) headingButton.childNodes[0].nodeValue = expanded ? "Hide details " : "View details ";
  if (expanded && shouldScroll) {
    requestAnimationFrame(() => detail.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
}

function bindStudentSignInAnalytics() {
  const summaryButton = document.getElementById("signinAnalyticsSummary");
  const headingButton = document.getElementById("signinAnalyticsHeadingToggle");
  const closeButton = document.getElementById("signinAnalyticsClose");
  const detail = document.getElementById("signinAnalyticsDetail");

  const toggle = () => setSignInAnalyticsExpanded(Boolean(detail?.hidden), true);
  summaryButton?.addEventListener("click", toggle);
  headingButton?.addEventListener("click", toggle);
  closeButton?.addEventListener("click", () => setSignInAnalyticsExpanded(false));

  onSnapshot(collection(db, "student_signin_stats"), snapshot => {
    state.signInStats = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderStudentSignInAnalytics();
  }, error => {
    console.warn("Student sign-in analytics unavailable:", error);
    state.signInStats = [];
    renderStudentSignInAnalytics("Unable to load sign-in analytics. Deploy the included Firestore rules and refresh the dashboard.");
  });
}

const OFFICER_MODULES = [
  { name:"Dashboard", detail:"Officer overview and live summaries", href:"../overview/overview.html", icon:"fa-table-columns", keywords:"dashboard overview home summary" },
  { name:"Bulletin Board Center", detail:"Create and manage USC announcements", href:"../announcements/announcements.html", icon:"fa-note-sticky", keywords:"bulletin announcement announcements post notice" },
  { name:"Election Management", detail:"Election schedule, candidates and voting", href:"../elections/elections.html", icon:"fa-rectangle-list", keywords:"election elections voting vote candidate candidates schedule results" },
  { name:"Events", detail:"Create and manage university events", href:"../events/events.html", icon:"fa-calendar", keywords:"event events calendar activity activities" },
  { name:"Programs", detail:"Publish outside-university programs and opportunities", href:"../programs/programs.html", icon:"fa-earth-americas", keywords:"program programs external outside outreach partner opportunity opportunities training scholarship internship" },
  { name:"Organizational Chart", detail:"View the USC council structure", href:"../organizational-chart/organizational-chart.html", icon:"fa-users", keywords:"organization organizational chart officers council structure" },
  { name:"Complaints Management", detail:"Review and manage student complaints", href:"../complaints/complaints.html", icon:"fa-message", keywords:"complaint complaints case cases concern concerns" }
];

function bindQuickSearch(){
  const input=document.getElementById("officerQuickSearch");
  const box=document.getElementById("officerSearchBox");
  const results=document.getElementById("officerSearchResults");
  const clearBtn=document.getElementById("officerSearchClear");
  if(!input||!box||!results)return;

  let visible=[];
  let activeIndex=-1;

  const closeResults=()=>{
    results.hidden=true;
    results.innerHTML="";
    visible=[];
    activeIndex=-1;
    input.removeAttribute("aria-activedescendant");
  };

  const setActive=(index)=>{
    const buttons=[...results.querySelectorAll(".officer-search-result")];
    if(!buttons.length){activeIndex=-1;return;}
    activeIndex=Math.max(0,Math.min(index,buttons.length-1));
    buttons.forEach((button,i)=>button.classList.toggle("is-active",i===activeIndex));
    const active=buttons[activeIndex];
    if(active){
      input.setAttribute("aria-activedescendant",active.id);
      active.scrollIntoView({block:"nearest"});
    }
  };

  const renderResults=()=>{
    const q=clean(input.value).toLowerCase();
    if(clearBtn)clearBtn.hidden=!q;
    if(!q){closeResults();return;}
    visible=OFFICER_MODULES.filter(item=>`${item.name} ${item.detail} ${item.keywords}`.toLowerCase().includes(q));
    results.hidden=false;
    activeIndex=-1;
    if(!visible.length){
      results.innerHTML='<div class="officer-search-empty">No matching officer module found.</div>';
      return;
    }
    results.innerHTML=visible.map((item,index)=>`<button class="officer-search-result" id="officerSearchResult${index}" type="button" role="option" data-search-index="${index}"><i class="fa-solid ${escapeHtml(item.icon)}"></i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("");
  };

  input.addEventListener("input",renderResults);
  input.addEventListener("focus",()=>{if(clean(input.value))renderResults();});
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      closeResults();
      input.blur();
      return;
    }
    if(event.key==="ArrowDown"){
      if(results.hidden)renderResults();
      if(visible.length){event.preventDefault();setActive(activeIndex+1);}
      return;
    }
    if(event.key==="ArrowUp"){
      if(visible.length){event.preventDefault();setActive(activeIndex<=0?visible.length-1:activeIndex-1);}
      return;
    }
    if(event.key!=="Enter")return;
    const target=visible[activeIndex>=0?activeIndex:0];
    if(target){event.preventDefault();window.location.href=target.href;}
  });

  results.addEventListener("click",event=>{
    const button=event.target.closest("[data-search-index]");
    if(!button)return;
    const item=visible[Number(button.dataset.searchIndex)];
    if(item)window.location.href=item.href;
  });

  clearBtn?.addEventListener("click",()=>{
    input.value="";
    clearBtn.hidden=true;
    closeResults();
    input.focus();
  });

  document.addEventListener("pointerdown",event=>{
    if(!box.contains(event.target))closeResults();
  });
}

function readOfficerSessionProfile(){
  try{
    const raw=JSON.parse(sessionStorage.getItem("studentProfile")||"null");
    return raw&&typeof raw==="object"?raw:{};
  }catch{return {};}
}

function setProfileDrawerText(selector,value,fallback="Not available"){
  document.querySelectorAll(selector).forEach(element=>{
    element.textContent=clean(value)||fallback;
  });
}

function refreshProfileDrawer(){
  const profile=readOfficerSessionProfile();
  const fullName=clean(profile.fullName||profile.name||profile.email,"USC Officer");
  const role=clean(profile.role,"officer");
  const position=clean(profile.officePosition,"USC Officer");
  const status=clean(profile.accountStatus,profile.isActive===false?"suspended":"approved");
  setProfileDrawerText("[data-profile-full-name]",fullName,"USC Officer");
  setProfileDrawerText("[data-profile-student-id]",profile.studentId);
  setProfileDrawerText("[data-profile-email]",profile.email);
  setProfileDrawerText("[data-profile-role]",role,"Officer");
  setProfileDrawerText("[data-profile-position]",position,"USC Officer");
  setProfileDrawerText("[data-profile-status]",status,"Approved");
  setProfileDrawerText("[data-profile-access]",profile.isActive===false?"Restricted":"Active","Active");
}

function bindProfileDrawer(){
  const trigger=document.getElementById("officerProfileTrigger");
  const drawer=document.getElementById("officerProfileDrawer");
  const overlay=document.getElementById("officerProfileOverlay");
  const closeBtn=document.getElementById("officerProfileClose");
  if(!trigger||!drawer||!overlay)return;

  const closeDrawer=()=>{
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    drawer.setAttribute("aria-hidden","true");
    trigger.setAttribute("aria-expanded","false");
    document.body.classList.remove("profile-drawer-open");
    window.setTimeout(()=>{if(!drawer.classList.contains("is-open"))overlay.hidden=true;},220);
  };

  const openDrawer=()=>{
    refreshProfileDrawer();
    overlay.hidden=false;
    requestAnimationFrame(()=>{
      overlay.classList.add("is-open");
      drawer.classList.add("is-open");
    });
    drawer.setAttribute("aria-hidden","false");
    trigger.setAttribute("aria-expanded","true");
    document.body.classList.add("profile-drawer-open");
  };

  trigger.addEventListener("click",()=>drawer.classList.contains("is-open")?closeDrawer():openDrawer());
  closeBtn?.addEventListener("click",closeDrawer);
  overlay.addEventListener("click",closeDrawer);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&drawer.classList.contains("is-open"))closeDrawer();});

  drawer.addEventListener("click",event=>{
    const menuButton=event.target.closest("[data-profile-panel-target]");
    if(!menuButton)return;
    const target=menuButton.dataset.profilePanelTarget;
    drawer.querySelectorAll("[data-profile-panel-target]").forEach(button=>button.classList.toggle("active",button===menuButton));
    drawer.querySelectorAll("[data-profile-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.profilePanel===target));
  });

  refreshProfileDrawer();
}


function bindCompactAnalyticsPopover(){
  const modal=document.getElementById("officerAnalyticsModal");
  if(!modal)return;
  const title=document.getElementById("analyticsDetailTitle");
  const subtitle=document.getElementById("analyticsDetailSubtitle");
  const launchers=[...document.querySelectorAll("[data-analytics-open]")];
  const panels=[...modal.querySelectorAll("[data-analytics-panel]")];
  const closeButtons=[...modal.querySelectorAll("[data-analytics-close]")];
  let lastTrigger=null;

  const copy={
    event:{title:"Events Analytics",subtitle:"Student registration activity for USC events only."},
    program:{title:"Programs Analytics",subtitle:"Student registration activity for external programs only."},
    complaint:{title:"Complaints Analytics",subtitle:"Current complaint volume, case status, and workload distribution."},
    election:{title:"Election Analytics",subtitle:"Election turnout and participation by department."}
  };

  const closeModal=()=>{
    if(modal.hidden)return;
    modal.hidden=true;
    modal.setAttribute("aria-hidden","true");
    document.body.classList.remove("analytics-popover-open");
    panels.forEach(panel=>{panel.hidden=true;panel.classList.remove("is-active");});
    lastTrigger?.focus?.();
  };

  const openModal=(key,button)=>{
    const selected=panels.find(panel=>panel.dataset.analyticsPanel===key);
    if(!selected)return;
    lastTrigger=button||null;
    panels.forEach(panel=>{
      const active=panel===selected;
      panel.hidden=!active;
      panel.classList.toggle("is-active",active);
    });
    const selectedCopy=copy[key]||{title:"Analytics",subtitle:"Detailed dashboard analytics."};
    if(title)title.textContent=selectedCopy.title;
    if(subtitle)subtitle.textContent=selectedCopy.subtitle;
    modal.hidden=false;
    modal.setAttribute("aria-hidden","false");
    document.body.classList.add("analytics-popover-open");
    requestAnimationFrame(()=>modal.querySelector(".analytics-detail-close")?.focus());
  };

  launchers.forEach(button=>button.addEventListener("click",()=>openModal(button.dataset.analyticsOpen,button)));
  closeButtons.forEach(button=>button.addEventListener("click",closeModal));
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!modal.hidden)closeModal();
    if(event.key!=="Tab"||modal.hidden)return;
    const dialog=modal.querySelector(".analytics-detail-dialog");
    const focusable=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
      .filter(element=>!element.hidden&&element.getClientRects().length>0);
    if(!focusable.length)return;
    const first=focusable[0];
    const last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
}

renderToday();
bindCompactAnalyticsPopover();
bindProfileDrawer();
bindComplaintSummary();
bindOfficerSummary();
bindVoteSummary();
bindAnnouncements();
bindEvents();
bindPrograms();
bindParticipationRegistrationAnalytics();
bindElectionSettings();
bindStudentSignInAnalytics();
