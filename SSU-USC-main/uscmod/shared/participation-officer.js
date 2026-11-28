import {
  styleParticipationDialog,
  participationBadge,
} from "./participation-ui.js";
import { hostedManagementCall as call } from "./hosted-management-client.js";
import {
  manilaTime,
  durationLabel,
  PARTICIPATION_STATUSES,
} from "./event-participation-model.mjs";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function mountParticipationOfficer(source) {
  const dialog = document.createElement("dialog");
  dialog.className = "participation-dialog";
  dialog.innerHTML =
    '<button type="button" class="participation-close" aria-label="Close attendance">×</button><h2>Event Participation Monitoring</h2><h3 data-event-title></h3><div class="participation-message" role="status" aria-live="polite"></div><div class="participation-stats"></div><div class="participation-tabs"><button type="button" data-roster-tab aria-pressed="true">Participants</button><button type="button" data-scanner-tab aria-pressed="false">Scan attendance</button></div><section data-roster><div class="participation-controls"><label>Search student<input type="search" data-search placeholder="Student ID or name"></label><label>Status<select data-status><option value="">All</option>' +
    PARTICIPATION_STATUSES.map((status) => `<option>${status}</option>`).join(
      "",
    ) +
    '</select></label><button type="button" data-refresh>Refresh</button></div><div class="participation-scroll"><table class="participation-table"><thead><tr><th>Student</th><th>Time-in / out</th><th>Duration</th><th>Status</th><th>Record</th></tr></thead><tbody></tbody></table></div><button type="button" data-more hidden>Load more</button></section><section class="participation-card" data-scanner hidden><h3>Attendance scanner</h3><div class="participation-controls"><label>Mode<select data-mode><option value="">Choose scanning mode</option><option value="in">Time-in</option><option value="out">Time-out</option></select></label><label>Camera<select data-camera></select></label><button type="button" data-start>Start camera</button><button type="button" data-stop>Stop camera</button></div><video class="participation-camera" autoplay muted playsinline hidden></video><canvas hidden></canvas><div data-identity></div><button type="button" data-confirm hidden>Confirm Identity and Record Attendance</button><button type="button" data-next>Scan next student</button><h4>Recent attendance activity</h4><ul data-recent></ul></section>';
  styleParticipationDialog(dialog);
  document.body.append(dialog);
  const get = (selector) => dialog.querySelector(selector),
    message = get('[role="status"]');
  let eventId = "",
    rows = [],
    next = null,
    rosterUnregistered = false,
    stream = null,
    frame = 0,
    pending = null,
    requestVersion = 0,
    busy = false,
    cameraGeneration = 0;
  const request = (action, data = {}) =>
    call(action, { source, eventId, ...data });
  function stop() {
    cameraGeneration++;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    get("video").hidden = true;
    get("video").srcObject = null;
  }
  function clearIdentity() {
    pending = null;
    get("[data-identity]").replaceChildren();
    get("[data-confirm]").hidden = true;
  }
  function selectPanel(scanner) {
    get("[data-roster]").hidden = scanner;
    get("[data-scanner]").hidden = !scanner;
    get("[data-roster-tab]").setAttribute("aria-pressed", String(!scanner));
    get("[data-scanner-tab]").setAttribute("aria-pressed", String(scanner));
    if (!scanner) {
      if (pending || busy) requestVersion++;
      stop();
      clearIdentity();
    }
    message.textContent = "";
  }
  get("[data-roster-tab]").onclick = () => selectPanel(false);
  get("[data-scanner-tab]").onclick = () => selectPanel(true);
  dialog.querySelector(".participation-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    requestVersion++;
    stop();
    clearIdentity();
  });
  get("[data-mode]").addEventListener("change", () => {
    requestVersion++;
    clearIdentity();
  });
  get("[data-camera]").addEventListener("change", () => {
    requestVersion++;
    stop();
    clearIdentity();
  });
  function render() {
    const term = get("[data-search]").value.trim().toLowerCase(),
      status = get("[data-status]").value;
    const shown = rows.filter(
      (row) =>
        (!term ||
          `${row.studentId} ${row.fullName}`.toLowerCase().includes(term)) &&
        (!status || row.status === status),
    );
    get("tbody").innerHTML = shown.length
      ? shown
          .map(
            (row) =>
              `<tr><td><strong>${escape(row.fullName)}</strong><br>${escape(row.studentId)}<br>${escape([row.college, row.program, row.yearLevel, row.section].filter(Boolean).join(" · "))}</td><td>${escape(manilaTime(row.timeInAtMs))}<br>${escape(manilaTime(row.timeOutAtMs))}</td><td>${escape(durationLabel(row.durationMs))}</td><td>${participationBadge(row.status)}</td><td><button type="button" data-student="${escape(row.uid)}">View Record</button></td></tr>`,
          )
          .join("")
      : '<tr><td colspan="5">No participants found on this page. Load more records if available.</td></tr>';
  }
  async function load(append = false) {
    const version = ++requestVersion;
    clearIdentity();
    get("[data-refresh]").disabled = true;
    try {
      const status = get("[data-status]").value;
      if (!append) {
        rosterUnregistered = status === "Not Registered";
        next = null;
      }
      const page = await request("participationRoster", {
        after: append ? next : null,
        unregistered: rosterUnregistered,
      });
      if (version !== requestVersion || !dialog.open) return;
      rows = append ? [...rows, ...page.rows] : page.rows;
      next = page.next;
      const moreEligible = !next && !rosterUnregistered && !status;
      if (moreEligible) rosterUnregistered = true;
      get("[data-event-title]").textContent = page.event.title;
      get(".participation-stats").innerHTML = Object.entries(page.totals)
        .map(
          ([key, value]) =>
            `<div>${escape({ registered: "Registered", checkedIn: "Checked in", checkedOut: "Checked out", completed: "Completed", incomplete: "Incomplete", absent: "Absent" }[key])}<strong>${value}</strong></div>`,
        )
        .join("");
      get("[data-more]").hidden = !next && !moreEligible;
      get("[data-more]").textContent = moreEligible
        ? "Load eligible unregistered students"
        : "Load more";
      get("[data-recent]").replaceChildren(
        ...page.recent.map((item) => {
          const entry = document.createElement("li");
          entry.textContent = `${item.studentName || item.studentId} — ${item.mode === "in" ? "Time-in" : "Time-out"} ${manilaTime(item.recordedAtMs)}`;
          return entry;
        }),
      );
      message.textContent = "";
      render();
    } catch (error) {
      if (version === requestVersion) message.textContent = error.message;
    } finally {
      get("[data-refresh]").disabled = false;
    }
  }
  get("[data-search]").oninput = render;
  get("[data-status]").onchange = () => load();
  get("[data-refresh]").onclick = () => load();
  get("[data-more]").onclick = () => load(true);
  get("[data-stop]").onclick = stop;
  get("[data-next]").onclick = () => {
    requestVersion++;
    clearIdentity();
    message.textContent = "Ready for the next student.";
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      clearIdentity();
      requestVersion++;
    }
  });
  async function lookup(qr) {
    if (busy || pending || !dialog.open) return;
    const mode = get("[data-mode]").value;
    if (!mode) {
      message.textContent = "Select Time-in or Time-out mode first.";
      return;
    }
    busy = true;
    const version = requestVersion;
    try {
      const result = await request("participationLookup", { qr, mode });
      if (version !== requestVersion || !dialog.open) return;
      pending = result;
      const p = result.student;
      get("[data-identity]").innerHTML =
        `<h4>${escape(p.fullName)}</h4><p>${escape(p.studentId)} · ${escape(p.college)}<br>${escape(p.program)} · ${escape(p.yearLevel)} · ${escape(p.section)}</p><p>${escape(result.registrationStatus)} · ${escape(result.attendanceStatus)}</p><p>Compare the student’s physical school ID before confirming ${mode === "in" ? "time-in" : "time-out"}.</p>`;
      if (
        p.photoURL &&
        /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(p.photoURL)
      ) {
        const image = document.createElement("img");
        image.src = p.photoURL;
        image.alt = "Student profile";
        image.className = "participation-photo";
        get("[data-identity]").prepend(image);
      }
      get("[data-confirm]").hidden = false;
      message.textContent = "Identity confirmation required.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  async function scanFrame(generation) {
    if (generation !== cameraGeneration || !stream || !dialog.open) return;
    try {
      const video = get("video"),
        canvas = get("canvas");
      if (
        !busy &&
        !pending &&
        video.readyState >= 2 &&
        video.videoWidth &&
        video.videoHeight
      ) {
        const width = video.videoWidth,
          height = video.videoHeight;
        const center = Math.min(width, height, 720);
        // Preserve small QR modules in the central area instead of shrinking the
        // whole camera image to 640px. Also search the full frame for off-center codes.
        const regions = [
          [(width - center) / 2, (height - center) / 2, center, center],
          [0, 0, width, height],
        ];
        let found;
        for (const [x, y, w, h] of regions) {
          const scale = Math.min(1, 1280 / Math.max(w, h));
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(
            video,
            x,
            y,
            w,
            h,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          found = globalThis.jsQR(pixels.data, pixels.width, pixels.height, {
            inversionAttempts: "attemptBoth",
          });
          if (found) break;
        }
        if (found) {
          await lookup(found.data);
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    } catch (error) {
      message.textContent =
        "Unable to read the camera image. Stop and restart the camera.";
      console.warn("Attendance QR frame could not be read:", error.name);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (generation === cameraGeneration && stream && dialog.open)
        frame = requestAnimationFrame(() => scanFrame(generation));
    }
  }
  get("[data-start]").onclick = async () => {
    if (!get("[data-mode]").value) {
      message.textContent = "Choose a scanning mode first.";
      return;
    }
    stop();
    const generation = cameraGeneration;
    try {
      if (typeof globalThis.jsQR !== "function")
        throw Error(
          "The QR scanner could not load. Refresh the page and try again.",
        );
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("Camera scanning requires a supported browser and HTTPS.");
      const deviceId = get("[data-camera]").value;
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
        audio: false,
      });
      if (!dialog.open || generation !== cameraGeneration) {
        requestedStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = requestedStream;
      const video = get("video");
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      const devices = await (
        navigator.mediaDevices.enumerateDevices?.() || Promise.resolve([])
      ).catch(() => []);
      get("[data-camera]").replaceChildren(
        ...devices
          .filter((device) => device.kind === "videoinput")
          .map(
            (device, index) =>
              new Option(
                device.label || `Camera ${index + 1}`,
                device.deviceId,
              ),
          ),
      );
      const activeDevice = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (
        activeDevice &&
        [...get("[data-camera]").options].some(
          (option) => option.value === activeDevice,
        )
      )
        get("[data-camera]").value = activeDevice;
      message.textContent =
        "Camera ready. Hold the full QR code steady near the center, with its white border visible.";
      scanFrame(generation);
    } catch (error) {
      stop();
      message.textContent =
        error.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in browser settings and try again."
          : error.message;
    }
  };
  get("[data-confirm]").onclick = async () => {
    if (!pending || busy) return;
    busy = true;
    get("[data-confirm]").disabled = true;
    const version = requestVersion;
    const identity = pending,
      mode = get("[data-mode]").value;
    try {
      const result = await request("participationConfirm", {
        confirmation: identity.confirmation,
        identityConfirmed: true,
      });
      if (version !== requestVersion || !dialog.open) return;
      const entry = document.createElement("li");
      entry.textContent = `${identity.student.fullName} — ${mode === "in" ? "Time-in" : "Time-out"} ${manilaTime(mode === "in" ? result.timeInAtMs : result.timeOutAtMs)}`;
      get("[data-recent]").prepend(entry);
      while (get("[data-recent]").children.length > 10)
        get("[data-recent]").lastElementChild.remove();
      clearIdentity();
      await load();
      message.textContent = entry.textContent;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      get("[data-confirm]").disabled = false;
    }
  };
  get("tbody").addEventListener("click", async (event) => {
    const uid = event.target.closest("[data-student]")?.dataset.student;
    if (!uid) return;
    const { showParticipationHistory } =
      await import("./participation-history.js");
    showParticipationHistory(uid, source);
  });
  function buttons() {
    for (const button of document.querySelectorAll(
      "[data-view-participants]",
    )) {
      if (button.parentElement.querySelector("[data-manage-attendance]"))
        continue;
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = button.className;
      manage.dataset.manageAttendance = button.dataset.viewParticipants;
      manage.textContent = "Manage Attendance";
      button.after(manage);
    }
  }
  const observer = new MutationObserver(buttons);
  observer.observe(
    document.getElementById("recentEventsList") || document.body,
    { childList: true, subtree: true },
  );
  buttons();
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-manage-attendance]");
    if (!button) return;
    stop();
    rows = [];
    next = null;
    eventId = button.dataset.manageAttendance;
    get("[data-search]").value = "";
    get("[data-status]").value = "";
    get("[data-recent]").replaceChildren();
    get("[data-mode]").value = "";
    selectPanel(false);
    dialog.showModal();
    load();
  });
}
