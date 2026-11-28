import { hostedManagementCall as call } from "./hosted-management-client.js";
import { styleParticipationDialog } from "./participation-ui.js";
import {
  collectParticipation,
  filterParticipation,
  buildParticipationWorkbook,
} from "./participation-export.mjs";
let excelReady;
function excel() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!excelReady)
    excelReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL(
        "../vendor/exceljs/exceljs-4.4.0.min.js",
        import.meta.url,
      ).href;
      script.onload = () =>
        globalThis.ExcelJS
          ? resolve(globalThis.ExcelJS)
          : reject(Error("Excel writer could not load."));
      script.onerror = () =>
        reject(
          Error(
            "Excel writer could not load. Check your connection and reopen analytics.",
          ),
        );
      document.head.append(script);
    }).catch((error) => {
      excelReady = null;
      throw error;
    });
  return excelReady;
}
export function showParticipationExport(source, eventId) {
  const dialog = document.createElement("dialog");
  dialog.className = "participation-dialog participation-export-dialog";
  dialog.innerHTML =
    '<button type="button" class="participation-close" aria-label="Close Excel analytics">×</button><h2>Excel participation analytics</h2><p data-export-title></p><div class="participation-controls">' +
    [
      ["program", "Program"],
      ["yearLevel", "Year level"],
      ["section", "Section"],
    ]
      .map(
        ([key, label]) =>
          `<label>${label}<select data-export-filter="${key}"><option value="">All</option></select></label>`,
      )
      .join("") +
    '<button type="button" data-export-overall>Overall</button></div><p role="status">Loading registrations…</p><p>Includes every page of registered participants. Academic groups reflect saved registration details.</p><button type="button" data-export-download disabled>Download Excel (.xlsx)</button>';
  styleParticipationDialog(dialog);
  document.body.append(dialog);
  dialog.showModal();
  const message = dialog.querySelector('[role="status"]'),
    download = dialog.querySelector("[data-export-download]"),
    selects = [...dialog.querySelectorAll("[data-export-filter]")];
  let rows = [],
    event = {},
    version = 0;
  const filters = () =>
    Object.fromEntries(
      selects.map((select) => [select.dataset.exportFilter, select.value]),
    );
  function render() {
    const values = filters();
    for (const [index, select] of selects.entries()) {
      const prior = Object.fromEntries(
        selects
          .slice(0, index)
          .map((control) => [control.dataset.exportFilter, control.value]),
      );
      const available = filterParticipation(rows, prior);
      const choices = [
        ...new Set(
          available.map(
            (row) => row[select.dataset.exportFilter] || "__missing__",
          ),
        ),
      ].sort();
      select.replaceChildren(
        new Option("All", ""),
        ...choices.map(
          (value) =>
            new Option(value === "__missing__" ? "Not recorded" : value, value),
        ),
      );
      select.value = choices.includes(values[select.dataset.exportFilter])
        ? values[select.dataset.exportFilter]
        : "";
    }
    message.textContent = `${filterParticipation(rows, filters()).length} of ${rows.length} registrations selected`;
  }
  dialog.querySelector(".participation-close").onclick = () => dialog.close();
  dialog.onclose = () => {
    version++;
    dialog.remove();
  };
  selects.forEach((select) => {
    select.disabled = true;
    select.onchange = render;
  });
  dialog.querySelector("[data-export-overall]").onclick = () => {
    selects.forEach((select) => (select.value = ""));
    render();
  };
  (async () => {
    try {
      rows = await collectParticipation(
        async (after) => {
          const page = await call("participationRoster", {
            source,
            eventId,
            after,
          });
          event = page.event;
          return page;
        },
        (count) =>
          (message.textContent = `Loading registrations… ${count} loaded`),
        () => dialog.open,
      );
      if (!dialog.open) return;
      dialog.querySelector("[data-export-title]").textContent = event.title;
      selects.forEach((select) => (select.disabled = false));
      download.disabled = false;
      render();
    } catch (error) {
      if (dialog.open) message.textContent = error.message;
    }
  })();
  download.onclick = async () => {
    const current = version,
      selected = filters();
    download.disabled = true;
    try {
      const ExcelJS = await excel();
      const book = buildParticipationWorkbook(ExcelJS, {
        event,
        rows,
        filters: selected,
      });
      const buffer = await book.xlsx.writeBuffer();
      if (!dialog.open || current !== version) return;
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `participation-${eventId}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.textContent = "Excel analytics downloaded.";
    } catch (error) {
      if (dialog.open) message.textContent = error.message;
    } finally {
      download.disabled = false;
    }
  };
}
