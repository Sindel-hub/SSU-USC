// Presentation helpers shared only by the participation interfaces.
const statuses = new Set([
  "Not Registered",
  "Registered",
  "Checked In",
  "Completed",
  "Incomplete",
  "Absent",
]);
export function participationBadge(status) {
  if (!statuses.has(status)) return "—";
  return `<span class="participation-badge" data-state="${status.toLowerCase().replaceAll(" ", "-")}">${status}</span>`;
}
export function styleParticipationDialog(dialog) {
  const title = dialog.querySelector("h2"),
    close = dialog.querySelector(".participation-close");
  if (!title || !close) return;
  const header = document.createElement("header");
  header.className = "participation-dialog-header";
  const titles = document.createElement("div"),
    eyebrow = document.createElement("span");
  eyebrow.className = "participation-eyebrow";
  eyebrow.textContent = "Events & programs";
  titles.append(eyebrow, title);
  header.append(titles, close);
  dialog.prepend(header);
}
