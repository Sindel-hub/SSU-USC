import { summarizeStudentSignIns, buildDonutGradient } from "./student-signin-model.mjs";
import { db } from "../../../firebase/firebase-config.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const state = {signInStats:[]};
const clean = (value, fallback="") => String(value ?? fallback).trim();
const toDate = value => { if (!value) return null; const d=value?.toDate?value.toDate():new Date(value);return Number.isNaN(d.getTime())?null:d; };
const escapeHtml = value => clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setText = (selector,value) => document.querySelectorAll(selector).forEach(el=>el.textContent=String(value));
function formatSignInMoment(value) {
  const date = toDate(value);
  if (!date) return "No tracked sign-in yet";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderStudentSignInAnalytics(errorMessage = "") {
  const summary = summarizeStudentSignIns(state.signInStats);

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


onSnapshot(collection(db,'student_signin_stats'),snapshot=>{
 state.signInStats=snapshot.docs.map(item=>({id:item.id,...item.data()}));renderStudentSignInAnalytics();
},()=>{ state.signInStats=[];renderStudentSignInAnalytics('Student analytics unavailable. Check your connection and access.'); });
