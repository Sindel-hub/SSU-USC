import {
  managementRequest as request,
  escapeHtml as e,
} from "../../shared/management-client.js";
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const $ = (id) => document.getElementById(id);
let students = [],
  plan = null,
  currentStudent = "",
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
    if ($("studentDialog").open) $("detailStatus").textContent = error.message;
  } finally {
    busy = false;
  }
}
const options = (values) =>
  '<option value="">All</option>' +
  [...new Set(values)]
    .filter(Boolean)
    .sort()
    .map((v) => `<option>${e(v)}</option>`)
    .join("");
async function load() {
  const data = await request("students_list");
  students = data.students;
  $("filterDepartment").innerHTML = options(data.departments);
  $("filterProgram").innerHTML = options(Object.values(data.programs).flat());
  $("filterAcademic").innerHTML = options(students.map((s) => s.academicYear));
  render();
  await history();
  status(
    "Student records loaded. Only System Administrators can use this module.",
  );
}
function render() {
  const term = $("search").value.trim().toLowerCase(),
    filters = [
      ["filterDepartment", "college"],
      ["filterProgram", "program"],
      ["filterYear", "yearLevel"],
      ["filterAcademic", "academicYear"],
    ];
  const filtered = students.filter(
    (s) =>
      (!term ||
        String(s.studentId || s.id)
          .toLowerCase()
          .includes(term) ||
        String(s.fullName || "")
          .toLowerCase()
          .includes(term)) &&
      filters.every(([el, key]) => !$(el).value || s[key] === $(el).value) &&
      (!$("filterStatus").value ||
        ($("filterStatus").value === "review"
          ? s.reviewRequired
          : s.studentStanding === $("filterStatus").value)),
  );
  $("studentCount").textContent =
    `${filtered.length} of ${students.length} students`;
  $("students").innerHTML = filtered.length
    ? filtered
        .map(
          (s) =>
            `<tr><td>${e(s.studentId)}</td><td>${e(s.fullName)}</td><td>${e(s.college)}<br><small>${e(s.program)}</small></td><td>${e(s.yearLevel)}<br>${e(s.academicYear || "Not recorded")}</td><td>${e(s.studentStanding)}${s.reviewRequired ? "<br><strong>Review required</strong>" : ""}</td><td><button class="secondary" data-student="${e(s.studentId)}">View Profile</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6">No matching student records.</td></tr>';
}
$("filters").oninput = render;
async function history() {
  const data = await request("import_history");
  $("history").innerHTML = data.imports.length
    ? data.imports
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .map(
          (i) =>
            `<div class="question"><strong>${e(i.academicYear)} · ${e(i.state)}</strong><p>${e(new Date(i.createdAtMs).toLocaleString())} · ${i.cursor}/${i.total} rows processed · ${i.counts.new} new · ${i.counts.existing} updated · ${i.counts.unchanged} unchanged · ${i.counts.flagged} flagged · ${i.invalid} invalid/conflicting · ${i.duplicates} duplicate</p>${["preview","applying"].includes(i.state) && i.invalid === 0 ? `<button data-resume="${i.id}" class="secondary">Review / Resume</button>` : ""}</div>`,
        )
        .join("")
    : "<p>No imports yet.</p>";
}
$("importForm").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const file = $("importFile").files[0];
    if (!file || file.size > 5 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name))
      throw Error("Choose a CSV/XLSX file no larger than 5 MB.");
    status("Validating file and checking existing Student IDs…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    plan = await request("import_preview", {
      file: { name: file.name, base64: btoa(binary) },
      annual: $("annualImport").checked,
    });
    showPreview();
    status("Preview ready. Review the rows and import summary.");
    await history();
  });
};
function showPreview() {
  $("preview").hidden = false;
  $("confirmImport").checked = false;
  $("applyImport").disabled = true;
  const counts = {};
  for (const row of plan.rows) counts[row.kind] = (counts[row.kind] || 0) + 1;
  $("previewSummary").textContent =
    Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(" · ") +
    ` · ${plan.missing} absent students to flag. Preview expires ${new Date(plan.expiresAtMs).toLocaleString()}.`;
  $("previewRows").innerHTML = plan.rows
    .map(
      (r) =>
        `<tr><td>${r.row}</td><td>${e(r.data.studentId)}</td><td>${e(r.data.fullName)}</td><td>${e(r.kind)}</td><td>${e(r.errors.join(" ")) || "Valid"}</td></tr>`,
    )
    .join("");
  $("importProgress").textContent = plan.canApply
    ? "Ready for administrator review and confirmation."
    : "This preview cannot be applied. Correct the file or create a fresh preview. Any completed rows remain recorded in Import History.";
}
$("confirmImport").onchange = () => {
  $("applyImport").disabled = !plan?.canApply || !$("confirmImport").checked;
};
async function apply(importId) {
  let result;
  $("applyImport").disabled = true;
  do {
    result = await request("import_apply", { id: importId, confirm: true });
    $("importProgress").textContent = JSON.stringify(result.counts);
    status("Applying confirmed import… " + JSON.stringify(result.counts));
  } while (!result.done);
  $("confirmImport").checked = false;
  plan = null;
  await load();
  status("Import complete. " + JSON.stringify(result.counts));
}
$("applyImport").onclick = () =>
  run(async () => {
    if (!plan?.canApply || !$("confirmImport").checked) return;
    await apply(plan.id);
  });
$("history").onclick = (event) => {
  const b = event.target.closest("[data-resume]");
  if (!b) return;
  run(async () => {
    plan = await request("import_preview_details", { id: b.dataset.resume });
    showPreview();
    $("preview").scrollIntoView();
    status(
      "Review the original preview and confirm to resume. Completed rows remain applied.",
    );
  });
};
async function detail(studentId) {
  const data = await request("student_detail", { studentId });
  currentStudent = studentId;
  const s = data.student;
  $("studentDetail").innerHTML =
    `<h3>${e(s.fullName)}</h3><p>${e(s.studentId)} · ${e(s.college)} · ${e(s.program)}</p><p>${e(s.yearLevel)} · ${e(s.academicYear || "Academic year not recorded")}</p><p>Academic status: <strong>${e(s.studentStanding)}</strong><br>Account: ${e(data.account.accountStatus)}<br>Activation: ${e(data.account.activationStatus)}</p><p>Contact email: ${e(s.institutionalEmail || "Not recorded")}</p><h3>Academic / status history</h3>${
      data.history.length
        ? data.history
            .sort((a, b) => b.createdAtMs - a.createdAtMs)
            .map(
              (h) =>
                `<div class="question"><p>${e(new Date(h.createdAtMs).toLocaleString())}</p><p>Before: ${e(h.previous ? Object.values(h.previous).join(" · ") : "New record")}</p><p>After: ${e(Object.values(h.current).join(" · "))}</p></div>`,
            )
            .join("")
        : "<p>No imported history recorded.</p>"
    }<h3>Existing participation</h3>${data.events.length ? data.events.map((v) => `<p>${e(v.eventTitle)}: ${e(v.status)}</p>`).join("") : "<p>No event registrations recorded.</p>"}<h3>Existing service submissions</h3>${data.submissions.length ? data.submissions.map((v) => `<p>${e(v.reference)}: ${e(v.status)}</p>`).join("") : "<p>No service submissions recorded.</p>"}<p class="muted">Anonymous survey responses are never attached to this profile.</p>`;
  $("academicStatus").value = s.studentStanding;
  $("activationControls").hidden = data.account.activationStatus !== "pending";
  $("identityChecked").checked = false;
  $("privateLink").hidden = true;
  $("privateLink").textContent = "";
  $("detailStatus").textContent = "";
  if (!$("studentDialog").open) $("studentDialog").showModal();
}
$("students").onclick = (event) => {
  const b = event.target.closest("[data-student]");
  if (b) run(() => detail(b.dataset.student));
};
$("closeStudent").onclick = () => {
  $("privateLink").textContent = "";
  $("studentDialog").close();
};
$("saveStudentStatus").onclick = () =>
  run(async () => {
    if (
      !confirm(
        "Update this student’s verified academic status? This changes portal access and preserves history.",
      )
    )
      return;
    await request("student_status", {
      studentId: currentStudent,
      status: $("academicStatus").value,
    });
    await load();
    await detail(currentStudent);
    $("detailStatus").textContent = "Status updated and audited.";
  });
$("emailActivation").onclick = () =>
  run(async () => {
    await request("activation_issue", {
      studentId: currentStudent,
      delivery: "email",
    });
    $("detailStatus").textContent =
      "Activation instructions sent to the verified-source email.";
  });
$("offlineActivation").onclick = () =>
  run(async () => {
    if (!$("identityChecked").checked)
      throw Error(
        "Check the student’s identity in person before issuing this private link.",
      );
    const data = await request("activation_issue", {
      studentId: currentStudent,
      delivery: "in-person",
      identityChecked: true,
    });
    $("privateLink").hidden = false;
    $("privateLink").textContent =
      "Private link — share only with the verified student: " + data.url;
    $("detailStatus").textContent =
      "One-time link issued. Expires in 24 hours. Do not include it in reports or logs.";
  });
await run(load);
