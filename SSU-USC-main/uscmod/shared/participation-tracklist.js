import { hostedManagementCall as call } from "./hosted-management-client.js";
import { showParticipationHistory } from "./participation-history.js";
import {
  PARTICIPATION_STATUSES,
  manilaTime,
  durationLabel,
} from "./event-participation-model.mjs";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function mountParticipationTracklist(source) {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "mini-btn light";
  launcher.textContent = "Student Participation Tracklist";
  const heading = document.querySelector("#recentEventsList")?.closest(".card");
  if (heading) heading.before(launcher);
  else document.querySelector("main")?.append(launcher);
  launcher.onclick = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "participation-dialog";
    dialog.innerHTML =
      '<button type="button" class="participation-close" aria-label="Close student tracklist">×</button><h2>Student Participation Tracklist</h2><div class="participation-controls"><label>View<select data-view><option value="students">Students</option><option value="participation">Registration and attendance</option></select></label><label>Student ID or name<input type="search" data-search></label>' +
      [
        ["college", "Department"],
        ["program", "Program"],
        ["yearLevel", "Year level"],
        ["section", "Section"],
      ]
        .map(
          ([key, label]) =>
            `<label>${label}<select data-academic="${key}"><option value="">All</option></select></label>`,
        )
        .join("") +
      '<label data-event-filter hidden>Event or program<input type="search" data-event></label><label data-event-filter hidden>Participation status<select data-status><option value="">All</option>' +
      PARTICIPATION_STATUSES.filter((s) => s !== "Not Registered")
        .map((s) => `<option>${s}</option>`)
        .join("") +
      '</select></label><label data-event-filter hidden>From<input type="date" data-from></label><label data-event-filter hidden>Until<input type="date" data-until></label><button type="button" data-clear>Clear filters</button></div><p role="status">Loading…</p><div class="participation-scroll"><table class="participation-table"><thead></thead><tbody></tbody></table></div><button type="button" data-more hidden>Load more records</button>';
    document.body.append(dialog);
    dialog.showModal();
    let rows = [],
      after = null,
      version = 0;
    const get = (selector) => dialog.querySelector(selector),
      selectors = [...dialog.querySelectorAll("[data-academic]")];
    const selected = () =>
      Object.fromEntries(
        selectors.map((select) => [select.dataset.academic, select.value]),
      );
    function options() {
      const values = selected();
      for (const select of selectors) {
        const key = select.dataset.academic;
        const prior = selectors.slice(0, selectors.indexOf(select));
        const choices = [
          ...new Set(
            rows
              .filter((row) =>
                prior.every(
                  (control) =>
                    !values[control.dataset.academic] ||
                    values[control.dataset.academic] ===
                      row[control.dataset.academic],
                ),
              )
              .map((row) => row[key])
              .filter(Boolean),
          ),
        ].sort();
        select.replaceChildren(
          new Option("All", ""),
          ...choices.map((value) => new Option(value, value)),
        );
        select.value = choices.includes(values[key]) ? values[key] : "";
      }
    }
    function render() {
      const term = get("[data-search]").value.toLowerCase(),
        values = selected(),
        records = get("[data-view]").value === "participation",
        eventTerm = get("[data-event]").value.toLowerCase(),
        status = get("[data-status]").value,
        from = get("[data-from]").value,
        until = get("[data-until]").value;
      const shown = rows.filter(
        (row) =>
          (!term ||
            `${row.studentId} ${row.fullName}`.toLowerCase().includes(term)) &&
          Object.entries(values).every(
            ([key, value]) => !value || value === row[key],
          ) &&
          (!records ||
            ((!eventTerm ||
              row.eventSnapshot?.title?.toLowerCase().includes(eventTerm)) &&
              (!status || row.status === status) &&
              (!from || row.eventSnapshot?.eventDate >= from) &&
              (!until || row.eventSnapshot?.eventDate <= until))),
      );
      get("thead").innerHTML =
        "<tr>" +
        [
          "Student",
          "Academic record",
          ...(records
            ? [
                "Event / Program",
                "Registration",
                "Time-in / out",
                "Duration",
                "Status",
              ]
            : []),
          "History",
        ]
          .map((label) => `<th>${label}</th>`)
          .join("") +
        "</tr>";
      get("tbody").innerHTML = shown.length
        ? shown
            .map(
              (row) =>
                `<tr><td>${escape(row.fullName)}<br>${escape(row.studentId)}${row.removed ? "<br>Archived account" : ""}</td><td>${escape([row.college, row.program, row.yearLevel, row.section].filter(Boolean).join(" · "))}</td>${records ? `<td>${escape(row.eventSnapshot?.title || row.eventId)}<br>${escape(row.eventSnapshot?.eventDate)}</td><td>${escape(manilaTime(row.registeredAtMs))}</td><td>${escape(manilaTime(row.timeInAtMs))}<br>${escape(manilaTime(row.timeOutAtMs))}</td><td>${escape(durationLabel(row.durationMs))}</td><td>${escape(row.status)}</td>` : ""}<td><button type="button" data-history="${escape(row.uid)}">View Record</button></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="${records ? 8 : 3}">No matching records in the loaded results.</td></tr>`;
      get('[role="status"]').textContent =
        `${shown.length} matches · ${rows.length} records loaded${after ? " · Load more to search additional records" : ""}${records ? " · Use an event’s Manage Attendance view for eligible students who have not registered." : ""}`;
    }
    async function load() {
      const current = version,
        button = get("[data-more]");
      button.disabled = true;
      try {
        const page = await call("participationStudents", {
          source,
          after,
          view: get("[data-view]").value,
        });
        if (!dialog.open || current !== version) return;
        rows.push(...page.rows);
        after = page.next;
        button.hidden = !after;
        options();
        render();
      } catch (error) {
        if (current === version)
          get('[role="status"]').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }
    get(".participation-close").onclick = () => dialog.close();
    dialog.onclose = () => {
      version++;
      dialog.remove();
    };
    get("[data-view]").onchange = () => {
      version++;
      rows = [];
      after = null;
      dialog
        .querySelectorAll("[data-event-filter]")
        .forEach(
          (control) =>
            (control.hidden = get("[data-view]").value !== "participation"),
        );
      get('[role="status"]').textContent = "Loading…";
      load();
    };
    dialog
      .querySelectorAll("input")
      .forEach((input) => (input.oninput = render));
    get("[data-status]").onchange = render;
    selectors.forEach(
      (select) =>
        (select.onchange = () => {
          options();
          render();
        }),
    );
    get("[data-more]").onclick = load;
    get("[data-clear]").onclick = () => {
      dialog.querySelectorAll("input").forEach((input) => (input.value = ""));
      selectors.forEach((select) => (select.value = ""));
      get("[data-status]").value = "";
      options();
      render();
    };
    get("tbody").onclick = (event) => {
      const uid = event.target.closest("[data-history]")?.dataset.history;
      if (uid) showParticipationHistory(uid, source);
    };
    load();
  };
}
