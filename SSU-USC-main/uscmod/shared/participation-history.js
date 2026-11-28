import {
  styleParticipationDialog,
  participationBadge,
} from "./participation-ui.js";
import { hostedManagementCall as call } from "./hosted-management-client.js";
import { manilaTime, durationLabel } from "./event-participation-model.mjs";
const text = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export async function showParticipationHistory(studentUid, source) {
  const dialog = document.createElement("dialog");
  dialog.className = "participation-dialog";
  dialog.innerHTML =
    '<button type="button" class="participation-close" aria-label="Close participation record">×</button><h2>Student Participation History</h2><div role="status">Loading…</div><div data-profile></div><div class="participation-stats"></div><div class="participation-controls"><label>Search events<input type="search" data-search></label><label>From<input type="date" data-from></label><label>Until<input type="date" data-until></label><label>Status<select><option value="">All statuses</option>' +
    [
      "Not Registered",
      "Registered",
      "Checked In",
      "Completed",
      "Incomplete",
      "Absent",
    ]
      .map((status) => `<option>${status}</option>`)
      .join("") +
    '</select></label></div><div class="participation-scroll"><table class="participation-table"><thead><tr><th>Event / Program</th><th>Registration</th><th>Time-in / out</th><th>Duration</th><th>Status</th><th>Academic record</th></tr></thead><tbody></tbody></table></div><button type="button" data-more>Load more history</button>';
  styleParticipationDialog(dialog);
  document.body.append(dialog);
  dialog.showModal();
  let rows = [],
    after = null,
    phase = "history",
    eligibleSource = source || "events";
  dialog.querySelector(".participation-close").onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  function render() {
    const term = dialog.querySelector("[data-search]").value.toLowerCase(),
      status = dialog.querySelector("select").value,
      from = dialog.querySelector("[data-from]").value,
      until = dialog.querySelector("[data-until]").value;
    const selected = rows.filter(
      (row) =>
        (!term || row.eventSnapshot?.title?.toLowerCase().includes(term)) &&
        (!status || row.status === status) &&
        (!from || row.eventSnapshot?.eventDate >= from) &&
        (!until || row.eventSnapshot?.eventDate <= until),
    );
    dialog.querySelector("tbody").innerHTML = selected.length
      ? selected
          .map(
            (row) =>
              `<tr><td>${text(row.eventSnapshot?.title || row.eventId)}<br>${text(row.eventSnapshot?.eventDate)}</td><td>${text(manilaTime(row.registeredAtMs || row.registeredAt))}</td><td>${text(manilaTime(row.timeInAtMs))}<br>${text(manilaTime(row.timeOutAtMs))}</td><td>${text(durationLabel(row.durationMs))}</td><td>${participationBadge(row.status)}</td><td>${text(Object.values(row.academicSnapshot || {}).join(" · "))}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="6">No participation records found in the loaded history.</td></tr>';
    const totals = {
      "Eligible events": rows.length,
      "Registered events": rows.filter((row) => row.status !== "Not Registered")
        .length,
      Completed: rows.filter((row) => row.status === "Completed").length,
      Incomplete: rows.filter((row) => row.status === "Incomplete").length,
      Absent: rows.filter((row) => row.status === "Absent").length,
    };
    dialog.querySelector(".participation-stats").innerHTML = Object.entries(
      totals,
    )
      .map(
        ([label, count]) =>
          `<div>${text(label)}<strong>${count}</strong></div>`,
      )
      .join("");
  }
  async function load() {
    const button = dialog.querySelector("[data-more]");
    button.disabled = true;
    try {
      const page = await call(
        phase === "history" ? "participationHistory" : "participationEligible",
        {
          studentUid,
          source: phase === "history" ? source : eligibleSource,
          after,
        },
      );
      if (!dialog.open) return;
      const ids = new Set(rows.map((row) => `${row.source}_${row.eventId}`));
      rows.push(
        ...page.rows.filter((row) => !ids.has(`${row.source}_${row.eventId}`)),
      );
      after = page.next;
      if (page.student)
        dialog.querySelector("[data-profile]").textContent = [
          page.student.fullName,
          page.student.studentId,
          page.student.college,
          page.student.program,
          page.student.yearLevel,
          page.student.section,
        ]
          .filter(Boolean)
          .join(" · ");
      if (!after) {
        if (phase === "history") phase = "eligible";
        else if (!source && eligibleSource === "events")
          eligibleSource = "programs";
        else phase = "done";
      }
      button.hidden = phase === "done";
      button.textContent =
        phase === "history" ? "Load more history" : "Load more eligible events";
      dialog.querySelector('[role="status"]').textContent =
        phase === "done"
          ? "History loaded. Eligible events use the current academic profile; registered records preserve the original academic snapshot."
          : `${rows.length} records loaded. Summary counts apply to loaded records. Load more to include the remaining history and eligible events.`;
      render();
    } catch (error) {
      dialog.querySelector('[role="status"]').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }
  dialog.querySelectorAll("input").forEach((input) => (input.oninput = render));
  dialog.querySelector("select").onchange = render;
  dialog.querySelector("[data-more]").onclick = load;
  await load();
}
