import { effectiveOfficerPermissions } from "../../shared/officer-permissions.js";
import {
  managementRequest as request,
  escapeHtml as e,
  surveyUrl,
  download,
} from "../../shared/management-client.js";
import { csvCell } from "../../shared/needs-assessment-model.mjs";
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const $ = (id) => document.getElementById(id),
  form = $("surveyForm");
let surveys = [],
  departments = [],
  editing = "",
  questions = [],
  selected = "",
  report = null,
  busy = false;
function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
async function run(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
  }
}
const options = (all = true) =>
  `${all ? '<option value="all">All departments</option>' : ""}${departments.map((d) => `<option>${e(d)}</option>`).join("")}`;
async function load() {
  const data = await request("survey_list");
  surveys = data.surveys;
  departments = data.departments;
  $("surveys").innerHTML = surveys.length
    ? surveys
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map(
          (s) =>
            `<article class="card card-body panel survey-card"><h3>${e(s.title)}</h3><span class="badge">${e(s.status)}</span><p>${e(s.description)}</p><p class="muted">${e(s.department === "all" ? "All departments" : s.department)} · ${s.responseCount || 0} responses</p><p class="muted">${e(new Date(s.startsAt).toLocaleString())} – ${e(new Date(s.endsAt).toLocaleString())}</p><div class="row"><button class="btn primary" data-action="analytics" data-id="${s.id}">Results</button>${s.state === "draft" ? `<button data-action="edit" data-id="${s.id}" class="btn light secondary">Edit Draft</button><button class="btn primary" data-action="published" data-id="${s.id}">Publish</button>` : ""}${s.state === "published" ? `<button data-action="copy" data-id="${s.id}" class="btn light secondary">Copy Survey Link</button><button data-action="closed" data-id="${s.id}" class="btn light secondary">Close Survey</button>` : ""}${s.state !== "archived" ? `<button data-action="archived" data-id="${s.id}" class="btn light secondary">Archive</button>` : ""}</div></article>`,
        )
        .join("")
    : '<p class="card card-body panel">No surveys yet. Create your first needs assessment.</p>';
  status(
    "Surveys loaded. Access is enforced by your assigned officer permissions.",
  );
}
function readQuestions() {
  return [...$("questions").children].map((el, i) => ({
    id: questions[i]?.id,
    label: el.querySelector("[name=label]").value,
    type: el.querySelector("[name=type]").value,
    required: el.querySelector("[name=required]").checked,
    options: el
      .querySelector("[name=options]")
      .value.split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
  }));
}
function drawQuestions() {
  $("questions").innerHTML = questions
    .map(
      (q, i) =>
        `<fieldset class="question"><legend>Question ${i + 1}</legend><label>Question text<input name="label" value="${e(q.label)}" maxlength="500" required></label><label>Answer type<select name="type">${[
          ["choice", "Multiple choice"],
          ["checkbox", "Checkboxes"],
          ["short", "Short text"],
          ["long", "Long text"],
          ["rating", "Rating (1–5)"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${q.type === v ? "selected" : ""}>${l}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Options (one per line, for choice and checkbox questions)<textarea name="options">${e(q.options.join("\n"))}</textarea></label><label><input type="checkbox" name="required" ${q.required ? "checked" : ""}>Required answer</label><div class="question-actions"><button type="button" class="btn light secondary" data-q="${i}" data-move="-1" ${i === 0 ? "disabled" : ""}>Move up</button><button type="button" class="btn light secondary" data-q="${i}" data-move="1" ${i === questions.length - 1 ? "disabled" : ""}>Move down</button><button type="button" class="btn light secondary" data-q="${i}" data-remove>Remove</button></div></fieldset>`,
    )
    .join("");
}
function edit(s = {}) {
  editing = s.id || "";
  form.reset();
  for (const key of ["title", "description", "instructions"])
    form.elements[key].value = s[key] || "";
  form.elements.department.innerHTML = options();
  form.elements.department.value = s.department || "all";
  for (const key of ["startsAt", "endsAt"]) {
    const d = new Date(
      s[key] || Date.now() + (key === "endsAt" ? 86400000 : 0),
    );
    form.elements[key].value = new Date(
      d.getTime() - d.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  }
  questions = structuredClone(
    s.questions || [{ label: "", type: "choice", required: true, options: [] }],
  );
  drawQuestions();
  $("editor").hidden = false;
  $("editorTitle").textContent = editing ? "Edit draft" : "Create survey";
  form.elements.title.focus();
}
$("newSurvey").onclick = () => edit();
$("cancelEdit").onclick = () => {
  $("editor").hidden = true;
};
$("addQuestion").onclick = () => {
  questions = readQuestions();
  if (questions.length >= 40) {
    status("Maximum 40 questions.", true);
    return;
  }
  questions.push({ label: "", type: "short", required: false, options: [] });
  drawQuestions();
};
$("questions").onclick = (event) => {
  const b = event.target.closest("[data-q]");
  if (!b) return;
  questions = readQuestions();
  const i = Number(b.dataset.q);
  if (b.hasAttribute("data-remove")) questions.splice(i, 1);
  else {
    const j = i + Number(b.dataset.move);
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  drawQuestions();
};
form.onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    questions = readQuestions();
    const survey = Object.fromEntries(new FormData(form));
    survey.startsAt = new Date(form.elements.startsAt.value).getTime();
    survey.endsAt = new Date(form.elements.endsAt.value).getTime();
    survey.questions = questions;
    await request("survey_save", { id: editing || undefined, survey });
    $("editor").hidden = true;
    await load();
    status("Draft saved. Review the questions before publishing.");
  });
};
$("surveys").onclick = (event) => {
  const b = event.target.closest("[data-action]");
  if (!b) return;
  run(async () => {
    const s = surveys.find((s) => s.id === b.dataset.id),
      a = b.dataset.action;
    if (a === "edit") return edit(s);
    if (a === "copy") {
      await navigator.clipboard.writeText(surveyUrl(s.id));
      status(
        "Survey link copied. Attach it using the survey selector in Bulletin Board.",
      );
      return;
    }
    if (a === "analytics") {
      selected = s.id;
      $("resultsDepartment").innerHTML = options();
      await analytics();
      $("results").scrollIntoView();
      return;
    }
    if (
      !confirm(
        a === "published"
          ? "Publish this survey? Questions and schedule will be locked."
          : `Set this survey to ${a}?`,
      )
    )
      return;
    await request("survey_state", { id: s.id, state: a });
    await load();
  });
};
function findings(q) {
  if (!["choice", "checkbox"].includes(q.type) || !q.answered) return "";
  const max = Math.max(...q.frequencies.map((f) => f.count));
  if (!max) return "";
  return (
    "Most selected: " +
    q.frequencies
      .filter((f) => f.count === max)
      .map((f) => f.option)
      .join(", ") +
    ` (${max} responses).`
  );
}
async function analytics() {
  report = await request("survey_analytics", {
    id: selected,
    department: $("resultsDepartment").value || "all",
  });
  $("results").hidden = false;
  $("resultsTitle").textContent = report.survey.title;
  const a = report.analytics,
    s = report.survey;
  $("resultsOverview").textContent =
    `${s.status} · Target: ${s.department} · ${new Date(s.startsAt).toLocaleString()} – ${new Date(s.endsAt).toLocaleString()} · Total: ${a.total} responses · Selected group: ${a.selected ?? "suppressed"}`;
  $("analytics").innerHTML =
    `<h3>Responses by department</h3>${a.departments.length ? a.departments.map((d) => `<p>${e(d.name)}: <strong>${d.count ?? "Fewer than 5 — suppressed"}</strong></p>`).join("") : "<p>No responses yet.</p>"}${a.suppressed ? '<p class="notice">Results hidden for this small department group.</p>' : a.questions.map((q) => `<section class="question"><h3>${e(q.label)}</h3><p>${e(findings(q))}</p><p>${q.answered} answered${q.average !== null ? " · Average rating: " + q.average.toFixed(2) : ""}</p>${q.frequencies.map((f) => `<p>${e(f.option)}: ${f.count} (${f.percentage}%)<progress value="${f.count}" max="${Math.max(q.answered, 1)}" aria-label="${e(f.option)}: ${f.percentage}%"></progress></p>`).join("")}${q.text.map((t) => `<p class="answer-text">${e(t)}</p>`).join("")}${q.answered === 0 ? "<p>No answers recorded.</p>" : ""}</section>`).join("")}`;
  if (a.submissionDays.length)
    $("analytics").insertAdjacentHTML(
      "beforeend",
      "<h3>Submission dates (UTC)</h3>" +
        a.submissionDays
          .map(
            (d) =>
              `<p>${e(d.day)}: ${d.count ?? "Fewer than 5 — suppressed"}</p>`,
          )
          .join(""),
    );
}
$("resultsDepartment").onchange = () => run(analytics);
$("closeResults").onclick = () => {
  $("results").hidden = true;
};
$("printReport").onclick = () => window.print();
$("exportCsv").onclick = () => {
  if (!report) return;
  const a = report.analytics,
    rows = [
      ["Survey", report.survey.title],
      ["Department", $("resultsDepartment").value],
      ["Total responses", a.total],
      ["Selected responses", a.selected ?? "Suppressed"],
      ["Question", "Answer", "Count", "Percentage", "Average rating"],
    ];
  for (const day of a.submissionDays)
    rows.push(["Submission date (UTC)", day.day, day.count ?? "Suppressed"]);
  if (!a.suppressed)
    for (const q of a.questions) {
      for (const f of q.frequencies)
        rows.push([q.label, f.option, f.count, f.percentage, q.average ?? ""]);
      for (const t of q.text) rows.push([q.label, t, "", "", ""]);
    }
  download(
    "needs-assessment-summary.csv",
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
  );
};
const profile = JSON.parse(sessionStorage.getItem("studentProfile") || "{}");
if (
  profile.role === "admin" ||
  (profile.role === "officer" &&
    effectiveOfficerPermissions(profile, { legacyFullAccess: false }).includes(
      "needs.manage",
    ))
)
  await run(load);
else {
  $("newSurvey").disabled = true;
  status(
    "Ask the System Administrator to assign Manage Needs Assessment permission to your officer account.",
    true,
  );
}
