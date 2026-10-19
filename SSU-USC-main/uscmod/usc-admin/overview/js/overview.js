import { summarizeStudentSignIns } from "./student-signin-model.mjs";
import { statusBreakdown, renderOverviewChart } from "./overview-charts.js?v=1";
import { db } from "../../../firebase/firebase-config.js";
import { collection, collectionGroup, getCountFromServer, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const PENDING_COMPLAINT_STATUSES = new Set(["Submitted", "Under Review", "In Review", "In Progress"]);
const state = {
  events: [],
  feeds: { events: false, programs: false, registrations: false, complaints: false },
  programs: [],
  announcements: [],
  complaints: [],
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
function getEventDate(item){ return toDate(item?.eventDate || item?.date || item?.startDate); }
function announcementImage(item){ return clean(item.imageUrl || item.imageURL || item.posterUrl || item.announcementImageUrl); }

function formatTimeRange(item) {
  const start = clean(item.startTime);
  const end = clean(item.endTime);
  if (start && end) return `${start} - ${end}`;
  return start || end || "Time to be announced";
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

function renderEventParticipationAnalytics() {
  renderOverviewChart('event',statusBreakdown(state.events),{ready:state.feeds.events,error:state.feeds.events==='error',extra:state.feeds.registrations===true ? `${state.eventRegistrations.filter(item=>clean(item.status,'registered').toLowerCase()==='registered').length} portal registrations` : 'Registration data unavailable'});
}
function renderProgramParticipationAnalytics() {
  renderOverviewChart('program',statusBreakdown(state.programs),{ready:state.feeds.programs,error:state.feeds.programs==='error',extra:state.feeds.registrations===true ? `${state.programRegistrations.filter(item=>clean(item.status,'registered').toLowerCase()==='registered').length} portal registrations · Status follows saved schedules` : 'Registration data unavailable'});
}
function renderComplaintAnalytics() {
  const c = state.complaintAnalytics;
  renderOverviewChart('complaint', [['Pending / ongoing',c.active],['Resolved',c.resolved],['Closed',c.closed],['Other',Math.max(0,c.total-c.active-c.resolved-c.closed)]], {ready:state.feeds.complaints, error:state.feeds.complaints === 'error'});
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
    state.feeds.registrations = true;
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
    state.feeds.registrations = "error";
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
    state.feeds.complaints = true;
    renderComplaintAnalytics();
  } catch (error) {
    state.feeds.complaints = "error";
    renderComplaintAnalytics();
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
function syncDashboardLayout() {
  // Keep the bulletin column visible, including its genuine empty state.
}

function renderBulletin(){ const host=document.getElementById("officerBulletinPreview"); if(!host)return; const item=state.announcements[0]; if(!item){host.innerHTML='<div class="reference-empty">No announcement posted yet.</div>'; syncDashboardLayout(false); return;} const image=announcementImage(item); host.innerHTML=`${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(clean(item.title,'Announcement'))}" onerror="this.style.display='none'">`:''}<div class="bulletin-copy"><time>${escapeHtml(formatDate(item.createdAt||item.publishedAt||item.date))}</time><h3>${escapeHtml(clean(item.title,'USC Announcement'))}</h3><p>${escapeHtml(clean(item.content||item.description,'Official USC bulletin update.').slice(0,180))}</p><a href="../announcements/announcements.html">Open Bulletin Board Center</a></div>`; syncDashboardLayout(true); }
function bindAnnouncements(){ onSnapshot(collection(db,"announcements"), snap => { state.announcements=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(toDate(b.createdAt||b.publishedAt)?.getTime()||0)-(toDate(a.createdAt||a.publishedAt)?.getTime()||0)); setText("[data-overview-announcement-count]",state.announcements.length); renderBulletin(); },()=>renderBulletin()); }

let calendarOffset = 0;
function renderCalendar(){
  const monthEl=document.getElementById("officerCalendarMonth"), daysEl=document.getElementById("officerCalendarDays");
  if(!monthEl||!daysEl)return;
  const next=state.events.find(e=>getEventDate(e))||null;
  const base=new Date();
  base.setDate(1); base.setMonth(base.getMonth()+calendarOffset);
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
function overviewRecordRows(records, counts, kind) {
  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = records.filter(item => { const date = getEventDate(item); return date && date >= today; }).slice(0,4);
  if (!upcoming.length) return `<div class="overview-record-empty">No upcoming ${kind}.</div>`;
  return upcoming.map(item => `<a class="overview-record-row" href="../${kind}/${kind}.html"><time>${escapeHtml(formatDate(getEventDate(item)))}</time><strong>${escapeHtml(clean(item.title || item.name,'Untitled'))}</strong><span>${escapeHtml(formatTimeRange(item))} · ${escapeHtml(clean(item.venue || item.location,'Venue to be announced'))}</span>${kind === 'programs' ? `<span>${escapeHtml(clean(item.hostOrganization || item.organizer || item.partnerOrganization,'External partner'))}</span>` : ''}<small>${escapeHtml(registrationStatus(item).label)} · ${state.feeds.registrations === true ? `${counts.get(item.id) || 0} portal registrations` : state.feeds.registrations === "error" ? "Registration data unavailable" : "Loading registrations…"}</small></a>`).join('');
}
function renderEvents(){
  const host=document.getElementById('officerOverviewEvents');
  if (host) host.innerHTML=overviewRecordRows(state.events,eventRegistrationCounts(),'events');
  renderCalendar();
}
function renderPrograms(){
  const host=document.getElementById('officerOverviewPrograms');
  if (host) host.innerHTML=overviewRecordRows(state.programs,programRegistrationCounts(),'programs');
}

function bindEvents(){ onSnapshot(collection(db,"events"), snap => { state.feeds.events=true;state.events=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(getEventDate(a)?.getTime()||Infinity)-(getEventDate(b)?.getTime()||Infinity)); const today=new Date();today.setHours(0,0,0,0);const upcomingCount=state.events.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).length; setText("[data-overview-upcoming-events]",upcomingCount); renderEvents(); renderEventParticipationAnalytics(); },()=>{state.feeds.events="error";state.events=[];setText("[data-overview-upcoming-events]",0);renderEvents();renderEventParticipationAnalytics();}); }

function bindPrograms(){ onSnapshot(collection(db,"programs"), snap => { state.feeds.programs=true;state.programs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(getEventDate(a)?.getTime()||Infinity)-(getEventDate(b)?.getTime()||Infinity)); const today=new Date();today.setHours(0,0,0,0);const upcomingCount=state.programs.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).length; setText("[data-overview-upcoming-programs]",upcomingCount); renderPrograms(); renderProgramParticipationAnalytics(); },()=>{state.feeds.programs="error";state.programs=[];setText("[data-overview-upcoming-programs]",0);renderPrograms();renderProgramParticipationAnalytics();}); }

function renderStudentSignInAnalytics(errorMessage = '') {
  const summary = summarizeStudentSignIns(state.signInStats);
  renderOverviewChart('student',summary.departments.map(d=>[d.department,d.uniqueStudents]), {ready:true,error:Boolean(errorMessage),extra:`${summary.knownAccounts} accounts · ${summary.uniqueStudents} signed in · ${summary.sessions} sign-ins`});
}

function bindStudentSignInAnalytics() {
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



renderToday();

bindProfileDrawer();
bindComplaintSummary();


bindAnnouncements();
bindEvents();
bindPrograms();
bindParticipationRegistrationAnalytics();

bindStudentSignInAnalytics();

setInterval(() => { renderEventParticipationAnalytics(); renderProgramParticipationAnalytics(); }, 30000);

for (const [label, step] of [['Previous month',-1],['Next month',1]]) {
  document.querySelector(`.calendar-head button[aria-label="${label}"]`)?.addEventListener('click',()=>{ calendarOffset += step; renderCalendar(); });
}
