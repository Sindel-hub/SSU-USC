export async function managementRequest(
  action,
  payload = {},
  { publicAccess = false } = {},
) {
  const endpoint = String(globalThis.USC_MANAGEMENT_FUNCTION_URL || "").trim();
  if (
    !/^https:\/\/[^\s]+\/functions\/v1\/usc-management$/.test(endpoint) &&
    !(
      location.hostname === "localhost" &&
      /^http:\/\/127\.0\.0\.1:54321\/functions\/v1\/usc-management$/.test(
        endpoint,
      )
    )
  )
    throw Error(
      "Needs Assessment and Student Records require the staging usc-management service. Configure USC_MANAGEMENT_FUNCTION_URL after backend setup.",
    );
  const headers = { "Content-Type": "application/json" };
  if (!publicAccess) {
    const { auth } = await import("../firebase/firebase-config.js");
    if (!auth.currentUser) throw Error("Your session expired. Sign in again.");
    headers["x-firebase-token"] = await auth.currentUser.getIdToken();
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
    credentials: "omit",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true)
    throw Error(data.message || "Service unavailable. Try again later.");
  return data;
}
export function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function surveyUrl(id) {
  return new URL(
    "/survey/index.html?id=" + encodeURIComponent(id),
    location.origin,
  ).href;
}
export function download(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function attachSurveyButton(container, surveyId) {
  container?.parentElement?.querySelector(".attached-survey-link")?.remove();
  if (!container || !surveyId || !/^[a-zA-Z0-9_-]{1,128}$/.test(surveyId))
    return;
  const a = document.createElement("a");
  a.className = "attached-survey-link";
  a.textContent = "Take Survey";
  a.href = surveyUrl(surveyId);
  a.style.cssText =
    "display:inline-block;margin:16px 0;padding:12px 20px;background:#174f98;color:white;border-radius:10px;font-weight:700";
  container.after(a);
}
