import { hostedManagementCall as call } from "./hosted-management-client.js";
import * as model from "./reporting-model.mjs";
const participationWindow = (e) => ({
  inOpen: e.timeInOpensAtMs || Infinity,
  outClose: e.timeOutClosesAtMs || Infinity,
});
import { allPages, MAX_REPORT_ROWS } from "./reporting-data.mjs";
import { prepareEventEligibility } from "./reporting-capture.js";
import {
  buildReportingWorkbook,
  reportFilename,
  MAX_EXCEL_ROWS,
} from "./reporting-export.mjs";
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const root = document.querySelector("#reportingRoot"),
  form = document.querySelector("#reportFilters"),
  eventsControl = document.querySelector("#reportEvents"),
  message = document.querySelector("#reportMessage");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (ms) =>
  ms
    ? new Date(ms).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const num = (n) => (n == null ? "N/A" : n.toLocaleString());
const pct = model.percentage;
let caps,
  catalog = [],
  datasets = new Map(),
  complaints = [],
  activities = [],
  tab = "attendance",
  state = {},
  page = 0,
  busy = false,
  loaded = new Set(),
  offset = 0,
  complaintSince = 0,
  activitySince = 0,
  lastComplaintFull = 0,
  lastCatalogRefresh = 0,
  rendered = [],
  exportRows = [],
  context = "",
  reportOptions = {},
  initial = true,
  dataReady = false,
  exporting = false;
function notice(text, error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
}
function now() {
  return Date.now() + offset;
}
function key(e) {
  return `${e.source}/${e.id}`;
}
function selectedEvents() {
  const ids = [...eventsControl.selectedOptions].map((o) => o.value);
  return catalog.filter(
    (e) => ids.includes(key(e)) && model.eventMatches(e, state),
  );
}
function setOptions(control, values, all = "All") {
  if (!control) return;
  const previous = control.value;
  control.innerHTML =
    `<option value="">${esc(all)}</option>` +
    [...new Set(values.filter(Boolean))]
      .sort()
      .map(
        (v) =>
          `<option value="${esc(v)}">${esc(v === "__missing__" ? "Not recorded" : v)}</option>`,
      )
      .join("");
  control.value = previous;
}
function read() {
  state = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
  page = 0;
  save();
}
function save() {
  sessionStorage.setItem(
    "usc-reporting-context",
    JSON.stringify({
      tab,
      state,
      events: [...eventsControl.selectedOptions].map((o) => o.value),
    }),
  );
}
function configure() {
  document.querySelectorAll("[data-for]").forEach((el) => {
    el.hidden = !el.dataset.for.split(" ").includes(tab);
    for (const c of el.querySelectorAll("input,select")) c.disabled = el.hidden;
  });
  document
    .querySelectorAll("[data-tab]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.tab === tab)),
    );
  form.elements.search.placeholder =
    tab === "complaints" ? "Reference ID or subject" : "Student ID or name";
  form.elements.search.disabled =
    (tab === "complaints" && !caps.complaintDetails) ||
    (tab === "attendance" &&
      !selectedEvents().every((e) => caps.attendanceDetails[e.source]));
  form.elements.officer.disabled =
    (tab === "complaints" && !caps.complaintDetails) ||
    (tab === "activities" && !caps.allOfficers);
  setOptions(
    form.elements.status,
    tab === "attendance"
      ? [
          "Not Registered",
          "Registered",
          "Checked In",
          "Completed",
          "Incomplete",
          "Absent",
        ]
      : model.COMPLAINT_STATUSES,
  );
  form.elements.status.value = state.status || "";
  document.querySelector("#reportExport").disabled =
    busy ||
    exporting ||
    !dataReady ||
    (tab === "complaints" && !caps.complaintExport);
}
function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">No ${tab === "complaints" ? "complaints" : "records"} found.</td></tr>`}</tbody></table>`;
}
function card(label, value, action = "", hint = "") {
  return `<div class="report-stat" title="${esc(hint || label)}">${action ? `<button ${action}>` : ""}<span>${esc(label)}</span><strong>${esc(value)}</strong>${action ? "</button>" : ""}</div>`;
}
function bars(title, rows, action = "group") {
  const max = Math.max(1, ...rows.map((r) => r.percentage ?? r.count ?? 0));
  return `<section class="report-card"><h2>${esc(title)}</h2>${rows.length ? rows.map((r) => `<button class="report-bar" data-${action}="${esc(r.value ?? r.label)}" title="${esc(r.tooltip || `${r.count ?? 0} records; ${pct(r.percentage ?? null)}`)}"><span>${esc(r.label)}</span><span class="report-bar-track"><span class="report-bar-fill" style="width:${Math.max(0, ((r.percentage ?? r.count ?? 0) / max) * 100)}%"></span></span><strong>${r.percentage == null ? num(r.count) : pct(r.percentage)}</strong></button>`).join("") : "<p>No data in this scope.</p>"}</section>`;
}
const colors = [
  "#245e96",
  "#468ab4",
  "#7bb6d4",
  "#a9cada",
  "#c49962",
  "#b3656e",
];
function donut(title, counts, attribute) {
  const values = Object.entries(counts),
    total = values.reduce((n, [, v]) => n + v, 0);
  let start = 0;
  const stops = values.map(([, count], i) => {
    const end = start + (total ? (count / total) * 100 : 0),
      stop = `${colors[i % colors.length]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `<section class="report-card"><h2>${esc(title)}</h2><div class="report-donut" role="img" aria-label="${esc(values.map(([k, n]) => `${k}: ${n}`).join(", "))}" style="background:${total ? `conic-gradient(${stops.join(",")})` : "#edf2ee"}"></div><div class="report-legend">${values.map(([label, count]) => `<button data-${attribute}="${esc(label)}">${esc(label)} · ${count} (${pct(model.ratio(count, total))})</button>`).join("")}</div></section>`;
}
function trend(title, series) {
  const labels = [
      ...new Set(series.flatMap((s) => s.rows.map((r) => r.label))),
    ].sort(),
    max = Math.max(1, ...series.flatMap((s) => s.rows.map((r) => r.count)));
  return `<section class="report-card"><h2>${esc(title)}</h2><svg viewBox="0 0 400 150" class="report-line" role="img" aria-label="${esc(title)}">${series.map((s, i) => `<polyline fill="none" stroke="${colors[i]}" stroke-width="3" points="${labels.map((label, j) => `${20 + (j * 360) / Math.max(1, labels.length - 1)},${125 - ((s.rows.find((r) => r.label === label)?.count || 0) / max) * 105}`).join(" ")}"/>`).join("")}</svg>${table(
    ["Month", ...series.map((s) => s.label)],
    labels.map((label) => [
      esc(label),
      ...series.map((s) =>
        num(s.rows.find((r) => r.label === label)?.count || 0),
      ),
    ]),
  )}</section>`;
}
function attendance() {
  const chosen = selectedEvents(),
    all = chosen.flatMap((e) => {
      const d = datasets.get(key(e));
      return d
        ? model.attendanceRows(
            d.event,
            d.population,
            [...d.registrations.values()],
            now(),
            d.complete,
          )
        : [];
    }),
    complete =
      chosen.length > 0 && chosen.every((e) => datasets.get(key(e))?.complete),
    closed =
      chosen.length > 0 &&
      chosen.every(
        (e) =>
          now() >
          participationWindow(datasets.get(key(e))?.event || e).outClose,
      ),
    view = model.attendanceView(all, state, { complete, closed }),
    rows = view.rows,
    s = view.statistics;

  for (const field of model.REPORT_LEVELS)
    setOptions(
      form.elements[field],
      all
        .filter((r) =>
          model.REPORT_LEVELS.slice(
            0,
            model.REPORT_LEVELS.indexOf(field),
          ).every((k) => !state[k] || r[k] === state[k]),
        )
        .map((r) => r[field] || "__missing__"),
      `All ${field === "college" ? "departments" : field === "yearLevel" ? "year levels" : field + "s"}`,
    );
  for (const field of model.REPORT_LEVELS)
    form.elements[field].value = state[field] || "";
  const level = model.REPORT_LEVELS.find((k) => !state[k]);
  context = [
    chosen.length === 1
      ? chosen[0].title
      : `${chosen.length} events / programs`,
    ...model.REPORT_LEVELS.map((k) => state[k]).filter(Boolean),
  ].join(" · ");
  reportOptions = {
    complete,
    closed,
    details: chosen.every((e) => caps.attendanceDetails[e.source]),
  };
  exportRows = rows;
  document.querySelector("#reportScope").textContent = !chosen.length
    ? "Select an event or program."
    : `${context}. ${complete ? "Historical eligible population saved during publication preparation." : "Legacy eligibility unavailable: eligible counts and eligibility-based rates are N/A."} ${chosen.length > 1 ? "Counts represent student-event opportunities; unique attendees are shown separately." : ""} ${state.status ? "Statistics and denominators use records matching the selected status; clear Status for overall event rates." : ""} ${closed ? "Attendance windows closed." : "Absence and incomplete rates remain pending until all selected attendance windows close."}`;
  document.querySelector("#reportStats").innerHTML = [
    ["Eligible students / opportunities", num(s.eligible)],
    ["Registered", num(s.registered)],
    ["Unregistered eligible", num(s.unregistered)],
    ["Actual attendees", num(s.attended)],
    ["Completed", num(s.completed)],
    ["Incomplete", num(s.incomplete)],
    ["Absent", num(s.absent)],
    [
      "Participation",
      pct(s.participationRate),
      `Actual attendees ${s.attended} ÷ eligible ${num(s.eligible)}`,
    ],
    [
      "Registration rate",
      pct(s.registrationRate),
      `Registered ${s.registered} ÷ eligible ${num(s.eligible)}`,
    ],
    [
      "Registered attendance rate",
      pct(s.attendanceRate),
      `Actual attendees ${s.attended} ÷ registered ${s.registered}`,
    ],
    [
      "Completion rate",
      pct(s.completionRate),
      `Completed ${s.completed} ÷ actual attendees ${s.attended}`,
    ],
    ["Unique actual attendees", num(s.uniqueAttendees)],
  ]
    .map(([k, v, hint]) => card(k, v, "", hint))
    .join("");
  const groups = level
    ? model.attendanceBreakdown(rows, level, { complete, closed })
    : [];
  const comparison = groups.map((r) => ({
    ...r,
    percentage: r.participationRate,
    tooltip: `Eligible: ${num(r.eligible)} · Registered: ${r.registered} · Actual attendees: ${r.attended} · Participation: ${pct(r.participationRate)}`,
  }));
  document.querySelector("#reportCharts").innerHTML =
    (level
      ? bars(
          `${level === "college" ? "Department" : level === "yearLevel" ? "Year level" : level} participation`,
          comparison,
        )
      : "") +
    donut("Participation status distribution", s.counts, "status") +
    (level
      ? `<section class="report-card"><h2>Eligible · Registered · Actual attendees</h2>${groups
          .map((r) => {
            const max = Math.max(
              1,
              ...groups.map((g) => g.eligible || g.registered),
            );
            return `<button class="report-bar" data-group="${esc(r.value)}"><span>${esc(r.label)}</span><span class="report-series">${[r.eligible, r.registered, r.attended].map((v) => `<i style="height:${v == null ? 0 : Math.max(2, (v / max) * 44)}px" title="${num(v)}"></i>`).join("")}</span><span>${num(r.eligible)} / ${r.registered} / ${r.attended}</span></button>`;
          })
          .join("")}</section>`
      : "");
  const crumbs = [
    ["University-wide", -1],
    ...model.REPORT_LEVELS.flatMap((k, i) =>
      state[k]
        ? [[state[k] === "__missing__" ? "Not recorded" : state[k], i]]
        : [],
    ),
  ];
  document.querySelector("#reportBreadcrumb").innerHTML = crumbs
    .map(([label, i]) => `<button data-crumb="${i}">${esc(label)}</button>`)
    .join('<span aria-hidden="true">›</span>');
  document.querySelector("#reportTableTitle").textContent = level
    ? "Classification breakdown"
    : "Individual student attendance";
  rendered = rows;
  if (level) {
    document.querySelector("#reportTable").innerHTML = table(
      [
        level === "college" ? "Department" : level,
        "Eligible",
        "Registered",
        "Attended",
        "Completed",
        "Incomplete",
        "Absent",
        "Participation rate",
      ],
      groups.map((r) => [
        `<button data-group="${esc(r.value)}">${esc(r.label)}</button>`,
        num(r.eligible),
        num(r.registered),
        num(r.attended),
        num(r.completed),
        num(r.incomplete),
        num(r.absent),
        pct(r.participationRate),
      ]),
    );
    document.querySelector("#reportPagination").innerHTML = "";
  } else
    showPage(
      [
        "Student",
        "Student ID",
        "Time-in",
        "Time-out",
        "Duration",
        "Status",
        "",
      ],
      rows,
      (r) => [
        esc(r.fullName || "Restricted"),
        esc(r.studentId || "—"),
        esc(date(r.timeInAtMs)),
        esc(date(r.timeOutAtMs)),
        r.durationMs == null
          ? "—"
          : `${Math.floor(r.durationMs / 3600000)}h ${Math.floor((r.durationMs % 3600000) / 60000)}m`,
        `<span class="report-badge">${esc(r.status)}</span>`,
        reportOptions.details
          ? `<button data-student="${esc(r.uid)}" data-attendance-event="${esc(r.source + "/" + r.eventId)}">View Record</button>`
          : "Aggregate access",
      ],
    );
}
function complaintReport() {
  const base = complaints.filter((r) =>
      model.complaintMatches(r, { ...state, status: "", college: "" }),
    ),
    statusRows = base.filter((r) => !state.status || r.status === state.status),
    rows = statusRows.filter((r) =>
      model.matchesScope(r, { college: state.college }),
    ),
    s = model.complaintMetrics(rows, now());
  exportRows = rows;
  reportOptions = { details: caps.complaintDetails };
  context = [
    "Complaints",
    state.status || "All statuses",
    state.college || "All departments",
  ].join(" · ");
  setOptions(
    form.elements.college,
    statusRows.map((r) => r.college || "__missing__"),
    "All Departments",
  );
  form.elements.college.value = state.college || "";
  setOptions(
    form.elements.officer,
    complaints.map((r) => r.assignedOfficer),
    "All assigned officers",
  );
  form.elements.officer.value = state.officer || "";
  document.querySelector("#reportScope").textContent =
    `${context}. Department share denominator: ${statusRows.length} complaints ${state.status ? `with status ${state.status}` : "under all statuses"}. Closed is counted as resolved only with a recorded resolved outcome. Average resolution time uses ${s.resolutionSamples} valid timestamp pairs; unavailable history is excluded.`;
  document.querySelector("#reportStats").innerHTML =
    card("Total complaints", num(s.total)) +
    model.COMPLAINT_STATUSES.map((k) =>
      card(k, num(s.counts[k]), `data-status="${esc(k)}"`),
    ).join("") +
    card("Verified resolution rate", pct(s.resolutionRate)) +
    card(
      "Average resolution",
      s.averageResolutionMs == null
        ? "N/A"
        : `${(s.averageResolutionMs / 86400000).toFixed(2)} days`,
    ) +
    card(
      "Average complaint age",
      s.averageAgeMs == null
        ? "N/A"
        : `${(s.averageAgeMs / 86400000).toFixed(2)} days`,
    ) +
    card("Assigned / Unassigned", `${s.assigned} / ${s.unassigned}`);
  document.querySelector("#reportCharts").innerHTML =
    donut("Status share within current reporting scope", s.counts, "status") +
    bars(
      "Department share of selected status",
      model.complaintBreakdown(statusRows, "college"),
      "department",
    ) +
    trend("Complaints submitted and verified resolved", [
      { label: "Submitted", rows: model.monthlyTrend(rows, "createdAtMs") },
      {
        label: "Resolved (dated)",
        rows: model.monthlyTrend(
          rows.filter(model.complaintResolved),
          "resolvedAtMs",
        ),
      },
    ]) +
    bars(
      "Recurring categories",
      model.complaintBreakdown(rows, "category"),
      "category",
    );
  document.querySelector("#reportBreadcrumb").innerHTML =
    `<button data-complaint-reset>Overall complaints</button>${state.status ? ` › <button data-complaint-status>${esc(state.status)}</button>` : ""}${state.college ? ` › <span>${esc(state.college)}</span>` : ""}`;
  document.querySelector("#reportTableTitle").textContent =
    caps.complaintDetails ? "Complaint records" : "Department breakdown";
  if (!caps.complaintDetails) {
    document.querySelector("#reportTable").innerHTML = table(
      ["Department", "Complaints", "Share"],
      model
        .complaintBreakdown(rows, "college", statusRows.length)
        .map((r) => [esc(r.label), num(r.count), pct(r.percentage)]),
    );
    document.querySelector("#reportPagination").innerHTML = "";
  } else
    showPage(
      [
        "Reference ID",
        "Subject",
        "Department",
        "Submitted",
        "Assigned officer",
        "Status",
        "Updated",
        "Resolved",
        "",
      ],
      rows,
      (r) => [
        esc(r.reference),
        esc(r.subject),
        esc(r.college || "Not recorded"),
        esc(date(r.createdAtMs)),
        esc(r.assignedOfficer || "Unassigned"),
        esc(r.status),
        esc(date(r.updatedAtMs)),
        esc(date(r.resolvedAtMs)),
        `<a href="../complaints/complaints.html?record=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">View Record</a>`,
      ],
    );
}
function activityReport() {
  const chosen = selectedEvents(),
    attendanceRows = chosen.flatMap((e) => {
      const d = datasets.get(key(e));
      return d
        ? model.attendanceRows(
            d.event,
            d.population,
            [...d.registrations.values()],
            now(),
            d.complete,
          )
        : [];
    }),
    filtered = model.attendanceView(attendanceRows, state, {
      complete: chosen.every((e) => datasets.get(key(e))?.complete),
    }),
    selectedIds = new Set(chosen.map((e) => e.id)),
    rows = activities.filter(
      (r) =>
        (!state.officer || r.officerUid === state.officer) &&
        (!state.activityType || r.action === state.activityType) &&
        (!state.from || model.day(r.createdAtMs) >= state.from) &&
        (!state.until || model.day(r.createdAtMs) <= state.until) &&
        (!["Events", "Programs"].includes(r.module) ||
          selectedIds.has(r.recordId)) &&
        (!state.academicYear ||
          ["Events", "Programs"].includes(r.module) ||
          r.administration === state.academicYear) &&
        (!state.semester || ["Events", "Programs"].includes(r.module)) &&
        (!state.college ||
          (["Events", "Programs"].includes(r.module) &&
            chosen.some(
              (e) =>
                e.id === r.recordId &&
                filtered.rows.some(
                  (p) => p.eventId === e.id && p.source === e.source,
                ),
            ))),
    ),
    cs = complaints.filter((r) =>
      model.complaintMatches(r, {
        college: state.college,
        from: state.from,
        until: state.until,
      }),
    );
  exportRows = rows;
  reportOptions = { details: true };
  context = "Student Council Activities";
  setOptions(
    form.elements.officer,
    caps.allOfficers ? activities.map((r) => r.officerUid) : [caps.actor.uid],
    "All authorized officers",
  );
  form.elements.officer.value = state.officer || "";
  setOptions(
    form.elements.activityType,
    activities.map((r) => r.action),
    "All activity types",
  );
  form.elements.activityType.value = state.activityType || "";
  setOptions(
    form.elements.college,
    attendanceRows.map((r) => r.college || "__missing__"),
    "All Departments",
  );
  form.elements.college.value = state.college || "";
  const conducted = chosen.filter(
      (e) =>
        e.status === "Completed" ||
        (filtered.rows.some(
          (r) => r.eventId === e.id && r.timeInAtMs != null,
        ) &&
          now() >= participationWindow(e).outClose),
    ),
    upcoming = chosen.filter((e) => participationWindow(e).inOpen > now()),
    ongoing = chosen.filter((e) => {
      const w = participationWindow(e);
      return w.inOpen <= now() && w.outClose >= now();
    });
  const months = new Map();
  for (const r of filtered.rows.filter((r) => r.timeInAtMs != null)) {
    const month = model.day(r.timeInAtMs).slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(r);
  }
  const completionTrend = [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rows]) => ({
      label,
      count: Number(model.attendanceStatistics(rows).completionRate.toFixed(2)),
    }));
  reportOptions.activitySummary = {
    conducted: conducted.length,
    upcoming: upcoming.length,
    ongoing: ongoing.length,
    participation: filtered.statistics,
    complaints: caps.complaints ? model.complaintMetrics(cs, now()) : null,
  };
  reportOptions.eventSummaries = chosen.map((e) => {
    const rows = filtered.rows.filter(
        (r) => r.eventId === e.id && r.source === e.source,
      ),
      complete = datasets.get(key(e))?.complete;
    return {
      ...e,
      metrics: model.attendanceStatistics(rows, { complete }),
      evidence: conducted.includes(e)
        ? "Conducted"
        : upcoming.includes(e)
          ? "Upcoming"
          : ongoing.includes(e)
            ? "Ongoing"
            : "Ended — conduct unconfirmed",
    };
  });
  reportOptions.completionTrend = completionTrend;
  document.querySelector("#reportScope").textContent =
    `${caps.allOfficers ? "Authorized council-wide" : "Your own"} audit activities only. Conducted events require recorded attendance after the window closes or an explicit Completed status. Missing historical audit entries are unavailable. Department and semester filters include only event-linked audit records with matching saved classifications; unclassified audit records are excluded.`;
  document.querySelector("#reportStats").innerHTML =
    card("Conducted events / programs", num(conducted.length)) +
    card("Upcoming", num(upcoming.length)) +
    card("Ongoing", num(ongoing.length)) +
    card("Actual attendances", num(filtered.statistics.attended)) +
    card("Completion rate", pct(filtered.statistics.completionRate)) +
    card("Available audit records", num(rows.length));
  document.querySelector("#reportCharts").innerHTML =
    trend("Events conducted per month", [
      {
        label: "Conducted",
        rows: model.monthlyTrend(
          conducted.map((e) => ({
            at: Date.parse(
              (e.eventDate || e.archivedEventDate) + "T12:00:00+08:00",
            ),
          })),
          "at",
        ),
      },
    ]) +
    trend("Student attendance and completion", [
      {
        label: "Time-in",
        rows: model.monthlyTrend(filtered.rows, "timeInAtMs"),
      },
      {
        label: "Completed",
        rows: model.monthlyTrend(
          filtered.rows.filter((r) => r.status === "Completed"),
          "timeOutAtMs",
        ),
      },
    ]) +
    trend("Attendance completion rate by time-in month", [
      { label: "Completion rate (%)", rows: completionTrend },
    ]) +
    bars(
      "Department participation",
      model
        .attendanceBreakdown(filtered.rows, "college", {
          complete: chosen.every((e) => datasets.get(key(e))?.complete),
        })
        .map((r) => ({ ...r, percentage: r.participationRate })),
      "department",
    ) +
    bars(
      "Activity distribution",
      model.complaintBreakdown(rows, "action"),
      "activity",
    ) +
    (caps.complaints
      ? trend("Complaints received versus verified resolved", [
          { label: "Received", rows: model.monthlyTrend(cs, "createdAtMs") },
          {
            label: "Resolved (dated)",
            rows: model.monthlyTrend(
              cs.filter(model.complaintResolved),
              "resolvedAtMs",
            ),
          },
        ])
      : "");
  document.querySelector("#reportBreadcrumb").innerHTML =
    "<span>Student Council Activities</span>";
  document.querySelector("#reportTableTitle").textContent =
    "Authorized officer activity";
  showPage(
    ["Recorded", "Officer", "Module", "Action", "Record", "Status"],
    rows,
    (r) => [
      esc(date(r.createdAtMs)),
      esc(r.officerName || r.officerUid),
      esc(r.module),
      esc(r.action),
      esc(r.recordTitle || r.recordId || "—"),
      esc(r.status),
    ],
  );
}
function showPage(headers, rows, map) {
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  page = Math.min(page, pages - 1);
  document.querySelector("#reportTable").innerHTML = table(
    headers,
    rows.slice(page * 50, page * 50 + 50).map(map),
  );
  document.querySelector("#reportPagination").innerHTML =
    `<button data-page="-1" ${page === 0 ? "disabled" : ""}>Previous</button><span>${page + 1} / ${pages} · ${rows.length} records</span><button data-page="1" ${page === pages - 1 ? "disabled" : ""}>Next</button>`;
}
function render() {
  if (!caps) return;
  configure();
  try {
    if (tab === "attendance") attendance();
    else if (tab === "complaints") complaintReport();
    else activityReport();
  } catch (error) {
    dataReady = false;
    notice(error.message, true);
    document.querySelector("#reportExport").disabled = true;
    for (const id of [
      "reportStats",
      "reportCharts",
      "reportTable",
      "reportPagination",
    ])
      document.getElementById(id).replaceChildren();
  }
  root.setAttribute("aria-busy", String(busy));
}
async function loadEvent(e, incremental = false) {
  let d = datasets.get(key(e));
  if (!d) {
    if (
      e.eligibilityPolicyVersion === 1 &&
      e.eligibilitySnapshotState !== "ready" &&
      caps.attendanceDetails[e.source]
    )
      await prepareEventEligibility(e.source, e.id, (p) =>
        notice(`Preparing eligible population · ${p.count} students captured…`),
      );
    const p = await allPages(call, {
      section: "attendance",
      source: e.source,
      eventId: e.id,
      phase: "population",
    });
    d = {
      population: p.rows,
      registrations: new Map(),
      event: p.event,
      complete: p.complete,
      since: 0,
    };
    datasets.set(key(e), d);
  }
  const started = now(),
    r = await allPages(call, {
      section: "attendance",
      source: e.source,
      eventId: e.id,
      phase: "registrations",
      ...(incremental && d.since ? { since: Math.max(0, d.since - 1000) } : {}),
    });
  if (
    d.event.eligibilitySnapshotId !== r.event.eligibilitySnapshotId ||
    (!d.complete && r.complete)
  ) {
    datasets.delete(key(e));
    return loadEvent({ ...e, ...r.event }, false);
  }
  if (d.complete && d.population.length !== d.event.eligibilityCapture?.count)
    throw Error(
      "The captured eligible population is incomplete. Reload the report.",
    );
  for (const row of r.rows) d.registrations.set(row.studentUid || row.uid, row);
  d.since = r.startedAtMs ?? started;
  d.event = r.event;
  const total = [...datasets.values()].reduce(
    (n, v) => n + v.population.length + v.registrations.size,
    0,
  );
  if (total > MAX_REPORT_ROWS) {
    datasets.delete(key(e));
    throw Error(
      "Reporting cache limit reached. Reload and select a narrower scope.",
    );
  }
  d.complete = r.complete;
  if (d.population.length + d.registrations.size > MAX_REPORT_ROWS)
    throw Error(
      "This event exceeds the reporting limit. Contact an administrator for an archival export.",
    );
  offset = r.nowMs - Date.now();
}
async function load(incremental = false) {
  if (busy) return;
  busy = true;
  form.inert = true;
  dataReady = false;
  root.setAttribute("aria-busy", "true");
  configure();
  notice("Loading actual records…");
  try {
    if (incremental && now() - lastCatalogRefresh > 300000) {
      const selected = new Set(
          [...eventsControl.selectedOptions].map((o) => o.value),
        ),
        fresh = [];
      for (const source of ["events", "programs"])
        fresh.push(
          ...(await allPages(call, { section: "catalog", source })).rows,
        );
      catalog = fresh;
      eventsControl.innerHTML = catalog
        .map(
          (e) =>
            `<option value="${esc(key(e))}" ${selected.has(key(e)) ? "selected" : ""}>${esc(e.title)} · ${esc(e.eventDate || e.archivedEventDate || "Date unavailable")} (${esc(e.source)})</option>`,
        )
        .join("");
      lastCatalogRefresh = now();
    }
    const selected = selectedEvents();
    if (selected.length > 20)
      throw Error("Select no more than 20 events or programs.");
    if (tab !== "complaints") {
      for (const e of selected) await loadEvent(e, incremental);
    }
    if (
      caps.complaints &&
      (tab === "complaints" || tab === "activities") &&
      (!loaded.has("complaints") || incremental)
    ) {
      const full = !incremental || now() - lastComplaintFull > 300000;
      const start = now(),
        r = await allPages(call, {
          section: "complaints",
          ...(!full && complaintSince
            ? { since: Math.max(0, complaintSince - 1000) }
            : {}),
        });
      const map = new Map(full ? [] : complaints.map((r) => [r.id, r]));
      if (full) lastComplaintFull = start;
      for (const row of r.rows) map.set(row.id, row);
      complaints = [...map.values()];
      complaintSince = r.startedAtMs ?? start;
      loaded.add("complaints");
    }
    if (tab === "activities" && (!loaded.has("activities") || incremental)) {
      const start = now(),
        map = new Map(activities.map((r) => [r.id, r]));
      for (const phase of ["officers", "attendance", "reports"]) {
        const r = await allPages(call, {
          section: "activities",
          phase,
          ...(incremental && activitySince
            ? { since: Math.max(0, activitySince - 1000) }
            : {}),
        });
        for (const row of r.rows) map.set(row.id, row);
      }
      activities = [...map.values()];
      activitySince = start;
      loaded.add("activities");
    }
    notice(
      "Updated " +
        date(now()) +
        " · Changes refresh automatically while this page is visible.",
    );
    initial = false;
    dataReady = true;
  } catch (error) {
    if (["permission-denied", "unauthenticated"].includes(error.code)) {
      datasets.clear();
      complaints = [];
      activities = [];
      loaded.clear();
    }
    notice(error.message, true);
    document.querySelector("#reportExport").disabled = true;
  } finally {
    busy = false;
    form.inert = false;
    root.setAttribute("aria-busy", "false");
    render();
  }
}
root.addEventListener("click", async (event) => {
  const b =
    event.target.closest("button") ||
    event.target
      .closest("#reportTable tbody tr")
      ?.querySelector("button[data-group],button[data-student]");
  if (!b) return;
  if (b.dataset.tab) {
    if (busy) return;
    tab = b.dataset.tab;
    state = {};
    page = 0;
    form.reset();
    save();
    render();
    await load();
  } else if (b.hasAttribute("data-group")) {
    const level = model.REPORT_LEVELS.find((k) => !state[k]);
    if (level) {
      state[level] = b.dataset.group;
      page = 0;
      save();
      render();
    }
  } else if (b.hasAttribute("data-crumb")) {
    for (const k of model.REPORT_LEVELS.slice(Number(b.dataset.crumb) + 1))
      delete state[k];
    page = 0;
    save();
    render();
  } else if (b.hasAttribute("data-status")) {
    state.status = state.status === b.dataset.status ? "" : b.dataset.status;
    form.elements.status.value = state.status;
    page = 0;
    save();
    render();
  } else if (b.hasAttribute("data-department")) {
    state.college = b.dataset.department;
    page = 0;
    save();
    render();
  } else if (b.hasAttribute("data-complaint-reset")) {
    delete state.status;
    delete state.college;
    form.elements.status.value = "";
    page = 0;
    save();
    render();
  } else if (b.hasAttribute("data-complaint-status")) {
    delete state.college;
    save();
    render();
  } else if (b.hasAttribute("data-page")) {
    page += Number(b.dataset.page);
    render();
  } else if (b.hasAttribute("data-student"))
    studentModal(b.dataset.student, b.dataset.attendanceEvent);
  else if (b.hasAttribute("data-activity")) {
    state.activityType = b.dataset.activity;
    form.elements.activityType.value = state.activityType;
    render();
  }
});
async function studentModal(uid, eventKey) {
  const records = rendered.filter((r) => r.uid === uid);
  if (!records.length || !reportOptions.details) return;
  const row =
      records.find((r) => r.source + "/" + r.eventId === eventKey) ||
      records[0],
    dialog = document.createElement("dialog");
  dialog.className = "report-detail";
  dialog.setAttribute("aria-label", "Individual student attendance");
  const fields = {
    "Student ID": row.studentId,
    "Full name": row.fullName,
    Department: row.college,
    Program: row.program,
    "Year level": row.yearLevel,
    Section: row.section,
    Event: row.eventTitle,
    Registration: date(row.registeredAtMs),
    "Time-in": date(row.timeInAtMs),
    "Time-out": date(row.timeOutAtMs),
    Duration:
      row.durationMs == null
        ? "—"
        : `${(row.durationMs / 3600000).toFixed(2)} hours`,
    Status: row.status,
    "Time-in officer": row.timeInOfficerUid || "Not recorded",
    "Time-out officer": row.timeOutOfficerUid || "Not recorded",
  };
  dialog.innerHTML = `<header><h2>Student attendance record</h2><button aria-label="Close">×</button></header><div class="report-detail-body"><dl>${Object.entries(
    fields,
  )
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "Not recorded")}</dd>`)
    .join(
      "",
    )}</dl><h3>Participation history in the selected reporting scope</h3>${table(
    ["Event", "Status", "Time-in", "Time-out"],
    records.map((r) => [
      esc(r.eventTitle),
      esc(r.status),
      esc(date(r.timeInAtMs)),
      esc(date(r.timeOutAtMs)),
    ]),
  )}</div>`;
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  const history = document.createElement("section");
  history.innerHTML =
    '<h3>Authorized participation history</h3><p role="status">Loading history…</p>';
  dialog.querySelector(".report-detail-body").append(history);
  try {
    const rows = [];
    for (const source of ["events", "programs"].filter(
      (source) => caps.attendanceDetails[source],
    )) {
      let after = null;
      const seen = new Set();
      do {
        const result = await call("participationHistory", {
          studentUid: uid,
          source,
          after,
        });
        rows.push(...result.rows);
        if (rows.length > 1000)
          throw Error(
            "History exceeds 1,000 records. Open Student Tracklist for further review.",
          );
        after = result.next;
        if (after && seen.has(after))
          throw Error("History pagination did not advance.");
        seen.add(after);
      } while (after && dialog.open);
    }
    if (dialog.open)
      history.innerHTML =
        "<h3>Authorized participation history</h3>" +
        table(
          [
            "Event / program",
            "Academic group",
            "Status",
            "Time-in",
            "Time-out",
          ],
          rows.map((r) => [
            esc(r.eventSnapshot?.title || r.eventId),
            esc(
              [
                r.academicSnapshot?.program,
                r.academicSnapshot?.yearLevel,
                r.academicSnapshot?.section,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
            esc(r.status),
            esc(date(r.timeInAtMs)),
            esc(date(r.timeOutAtMs)),
          ]),
        );
  } catch (error) {
    if (dialog.open) history.textContent = error.message;
  }
}
form.addEventListener("submit", (e) => e.preventDefault());
let searchTimer;
form.addEventListener("input", (e) => {
  if (e.target === eventsControl) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () => {
      read();
      render();
    },
    e.target.type === "search" ? 150 : 0,
  );
});
form.addEventListener("change", async (e) => {
  if (e.target === eventsControl) {
    page = 0;
    save();
    await load();
  }
});
form.addEventListener("reset", () => {
  if (initial || busy) return;
  queueMicrotask(() => {
    state = {};
    page = 0;
    form.querySelectorAll("input").forEach((c) => (c.value = ""));
    form
      .querySelectorAll("select:not(#reportEvents)")
      .forEach((c) => (c.value = ""));
    if (eventsControl.options.length) eventsControl.options[0].selected = true;
    save();
    load();
    render();
  });
});
document.querySelector("#reportExport").onclick = async () => {
  const button = document.querySelector("#reportExport");
  if (exporting) return;
  exporting = true;
  button.disabled = true;
  try {
    if (!dataReady)
      throw Error(
        "The report is incomplete. Resolve the loading error before exporting.",
      );
    if (busy) throw Error("Wait for the report to finish loading.");
    if (exportRows.length > MAX_EXCEL_ROWS)
      throw Error("Narrow your filters to 10,000 records or fewer for Excel.");
    if (tab === "attendance" && !selectedEvents().length)
      throw Error("Select an event first.");
    if (tab === "complaints" || tab === "activities") {
      loaded.delete("complaints");
      lastComplaintFull = 0;
    }
    await load(tab !== "complaints");
    if (!dataReady)
      throw Error("The complete current dataset could not be retrieved.");
    const type =
        tab === "attendance"
          ? reportOptions.details
            ? "attendance"
            : "attendance-summary"
          : tab === "complaints"
            ? caps.complaintDetails
              ? "complaints"
              : "complaints-summary"
            : "activities",
      audit = await call("reportingExportAudit", {
        type,
        filters: state,
        events: selectedEvents().map((e) => ({
          source: e.source,
          eventId: e.id,
        })),
        operationId: crypto.randomUUID(),
      }),
      book = buildReportingWorkbook(globalThis.ExcelJS, {
        type: tab,
        rows: exportRows,
        context: context + " | Filters: " + JSON.stringify(state),
        actor: audit.generatedBy,
        atMs: audit.atMs,
        ...reportOptions,
      }),
      bytes = await book.xlsx.writeBuffer(),
      url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = reportFilename(tab, context);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notice("Excel report downloaded.");
  } catch (e) {
    notice(e.message, true);
  } finally {
    exporting = false;
    button.disabled =
      !dataReady || (tab === "complaints" && !caps.complaintExport);
  }
};
try {
  caps = await call("reportingCapabilities");
  offset = caps.nowMs - Date.now();
  lastCatalogRefresh = now();
  if (!caps.complaints)
    document.querySelector('[data-tab="complaints"]').hidden = true;
  for (const source of ["events", "programs"])
    catalog.push(
      ...(await allPages(call, { section: "catalog", source })).rows,
    );
  catalog.sort((a, b) =>
    String(b.eventDate || "").localeCompare(String(a.eventDate || "")),
  );
  eventsControl.innerHTML = catalog
    .map(
      (e) =>
        `<option value="${esc(key(e))}">${esc(e.title)} · ${esc(e.eventDate || e.archivedEventDate || "Date unavailable")} (${esc(e.source)})</option>`,
    )
    .join("");
  document.querySelector("#reportYears").innerHTML = [
    ...new Set(catalog.map((e) => e.academicYear).filter(Boolean)),
  ]
    .map((v) => `<option value="${esc(v)}"></option>`)
    .join("");
  document.querySelector("#reportSemesters").innerHTML = [
    ...new Set(catalog.map((e) => e.semester).filter(Boolean)),
  ]
    .map((v) => `<option value="${esc(v)}"></option>`)
    .join("");
  let saved;
  try {
    saved = JSON.parse(
      sessionStorage.getItem("usc-reporting-context") || "null",
    );
  } catch {}
  if (saved) {
    tab =
      ["attendance", "activities", "complaints"].includes(saved.tab) &&
      !(saved.tab === "complaints" && !caps.complaints)
        ? saved.tab
        : "attendance";
    state = saved.state || {};
  }
  const selections = new Set(saved?.events || catalog.slice(0, 1).map(key));
  for (const option of eventsControl.options)
    option.selected = selections.has(option.value);
  configure();
  for (const [k, v] of Object.entries(state))
    if (form.elements[k]) form.elements[k].value = v;
  await load();
  setInterval(() => {
    if (!document.hidden && !busy) load(true);
  }, 30000);
  setInterval(() => {
    if (!document.hidden && !busy && tab === "attendance") render();
  }, 15000);
} catch (e) {
  notice(e.message, true);
  root.setAttribute("aria-busy", "false");
  document.querySelector("#reportExport").disabled = true;
}
