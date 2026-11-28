import { SSU_PROGRAMS } from "../usc-admin/student-registration/js/ssu-programs.js";
import { hostedManagementCall } from "./hosted-management-client.js";
import { validateParticipationSchedule } from "./event-participation-model.mjs";
export function bindParticipationForm(form, source) {
  const labels = {
    registrationOpensAtMs: "Registration opens",
    registrationClosesAtMs: "Registration closes",
    timeInOpensAtMs: "Time-in opens",
    timeInClosesAtMs: "Time-in closes",
    timeOutOpensAtMs: "Time-out opens",
    timeOutClosesAtMs: "Time-out closes",
  };
  const panel = document.createElement("fieldset");
  panel.className = "event-form-section participation-card";
  panel.innerHTML =
    '<legend>Registration and attendance</legend><p>Schedules use Asia/Manila time. Choose all students or specific academic groups.</p><div class="participation-grid"></div>';
  const grid = panel.querySelector(".participation-grid");
  for (const [key, label] of Object.entries(labels)) {
    const element = document.createElement("label");
    element.textContent = label;
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.required = true;
    input.dataset.participationSchedule = key;
    element.append(input);
    grid.append(element);
  }
  const terms = {};
  for (const [key, label] of Object.entries({
    academicYear: "Academic year",
    semester: "Semester",
  })) {
    const el = document.createElement("label");
    el.textContent = label;
    const control = document.createElement("input");
    control.maxLength = 80;
    control.dataset.reportingTerm = key;
    el.append(control);
    grid.append(el);
    terms[key] = control;
  }
  const groups = {};
  for (const [key, label] of Object.entries({
    college: "Departments",
    program: "Programs",
    yearLevel: "Year levels",
    section: "Sections",
  })) {
    const element = document.createElement("label");
    element.textContent = label;
    const select = document.createElement("select");
    select.multiple = true;
    select.size = 4;
    select.dataset.participationGroup = key;
    element.append(select);
    grid.append(element);
    groups[key] = select;
  }
  const all = document.createElement("label");
  all.className = "participation-all";
  all.innerHTML = '<input type="checkbox" checked> All students';
  panel.insertBefore(all, grid);
  const allControl = all.querySelector("input");
  allControl.onchange = () => {
    Object.values(groups).forEach((select) => {
      select.disabled = allControl.checked;
      select.parentElement.hidden = allControl.checked;
      if (allControl.checked)
        for (const option of select.options) option.selected = false;
    });
    more.hidden = allControl.checked;
    sync();
  };
  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "Load student year levels and sections";
  panel.append(more);
  const message = document.createElement("p");
  message.role = "status";
  panel.append(message);
  const submit = form.querySelector('[type="submit"]');
  (submit.closest(".row-actions") || submit).before(panel);
  const values = (select) =>
    [...select.selectedOptions].map((option) => option.value);
  let academic = [],
    after = null;
  function fillOptions(select, options) {
    const selected = values(select);
    select.replaceChildren(
      ...[...new Set(options)].sort().map((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = selected.includes(value);
        return option;
      }),
    );
  }
  fillOptions(groups.college, Object.keys(SSU_PROGRAMS));
  function sync() {
    const colleges = values(groups.college);
    fillOptions(
      groups.program,
      Object.entries(SSU_PROGRAMS)
        .filter(([college]) => !colleges.length || colleges.includes(college))
        .flatMap(([, programs]) => programs),
    );
    const programs = values(groups.program);
    const available = academic.filter(
      (row) =>
        (!colleges.length || colleges.includes(row.college)) &&
        (!programs.length || programs.includes(row.program)),
    );
    fillOptions(
      groups.yearLevel,
      available.map((row) => row.yearLevel).filter(Boolean),
    );
    const years = values(groups.yearLevel);
    fillOptions(
      groups.section,
      available
        .filter((row) => !years.length || years.includes(row.yearLevel))
        .map((row) => row.section)
        .filter(Boolean),
    );
  }
  Object.values(groups).forEach((select) =>
    select.addEventListener("change", sync),
  );
  sync();
  more.addEventListener("click", async () => {
    more.disabled = true;
    try {
      const page = await hostedManagementCall("participationAcademicGroups", {
        source,
        after,
      });
      academic.push(...page.rows);
      after = page.next;
      sync();
      more.textContent = after
        ? "Load more student groups"
        : "Student groups loaded";
      more.disabled = !after;
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
      more.disabled = false;
    }
  });
  const mode = form.querySelector("#eventRegistrationMode");
  if (mode) {
    mode.replaceChildren(new Option("Register inside USC Portal", "internal"));
    mode.value = "internal";
  }
  form
    .querySelector("#eventExternalRegistrationField")
    ?.setAttribute("hidden", "");
  const deadline = form.querySelector("#eventRegistrationDeadline");
  form
    .querySelector("#eventRegistrationDeadlineField")
    ?.setAttribute("hidden", "");
  if (deadline) deadline.required = false;
  for (const id of ["eventStartTime", "eventEndTime"]) {
    const control = form.querySelector("#" + id);
    if (control) control.required = true;
  }
  let savedParticipation = null;
  function read() {
    const input = {
      targetParticipants: Object.fromEntries(
        Object.entries(groups).map(([key, select]) => [key, values(select)]),
      ),
    };
    for (const control of panel.querySelectorAll(
      "[data-participation-schedule]",
    ))
      input[control.dataset.participationSchedule] = Date.parse(
        control.value + ":00+08:00",
      );
    const config = validateParticipationSchedule(input);
    const result = {
      ...config,
      ...Object.fromEntries(
        Object.entries(terms).map(([key, input]) => [key, input.value.trim()]),
      ),
    };
    if (
      savedParticipation?.participationStarted &&
      Object.entries(result).some(
        ([key, value]) =>
          JSON.stringify(savedParticipation[key] ?? "") !==
          JSON.stringify(value ?? ""),
      )
    )
      throw Error(
        "Registration has started. Participation schedules and academic classifications are locked.",
      );
    return result;
  }
  panel.addEventListener("input", () => {
    if (deadline) {
      const closing = panel.querySelector(
        '[data-participation-schedule="registrationClosesAtMs"]',
      );
      deadline.value = closing.value;
    }
  });
  let fillVersion = 0;
  function fill(saved = {}) {
    fillVersion++;
    savedParticipation = saved;
    for (const [key, input] of Object.entries(terms))
      input.value = saved[key] || "";
    for (const control of panel.querySelectorAll(
      "[data-participation-schedule]",
    )) {
      const value = saved[control.dataset.participationSchedule];
      control.value = value
        ? new Date(value + 8 * 3600000).toISOString().slice(0, 16)
        : "";
    }
    for (const [key, select] of Object.entries(groups)) {
      const selected = saved.targetParticipants?.[key] || [];
      fillOptions(
        select,
        [...select.options].map((option) => option.value).concat(selected),
      );
      for (const option of select.options)
        option.selected = selected.includes(option.value);
    }
    if (mode) mode.value = "internal";
    allControl.checked = !Object.values(saved.targetParticipants || {}).some(
      (values) => values.length,
    );
    Object.values(groups).forEach((select) => {
      select.disabled = allControl.checked;
      select.parentElement.hidden = allControl.checked;
    });
    more.hidden = allControl.checked;
    if (deadline)
      deadline.value = panel.querySelector(
        '[data-participation-schedule="registrationClosesAtMs"]',
      ).value;
  }
  form.addEventListener("reset", () => {
    const version = fillVersion;
    queueMicrotask(() => {
      if (version === fillVersion) fill();
    });
  });
  fill();
  return { read, fill };
}
