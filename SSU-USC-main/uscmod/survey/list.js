import {
  managementRequest as request,
  escapeHtml as e,
  surveyUrl,
} from "../shared/management-client.js";
const status = document.getElementById("listStatus");
try {
  const { surveys } = await request(
    "surveys_available",
    {},
    { publicAccess: true },
  );
  status.textContent = surveys.length
    ? "Choose an available questionnaire below. Department and enrollment are self-reported, and cannot be verified without sign-in."
    : "No surveys are available yet. Check the Bulletin Board for upcoming consultations.";
  document.getElementById("availableSurveys").innerHTML = surveys
    .map(
      (s) =>
        `<article class="panel"><h2>${e(s.title)}</h2><span class="badge">${e(s.status)}</span><p>${e(s.description)}</p><p>${e(s.department === "all" ? "All departments" : s.department)}</p><p class="muted">${e(new Date(s.startsAt).toLocaleString())} – ${e(new Date(s.endsAt).toLocaleString())}</p><a class="button" href="${e(surveyUrl(s.id))}">${s.status === "active" ? "Take Survey" : "View Schedule"}</a></article>`,
    )
    .join("");
} catch (error) {
  status.textContent = error.message;
  status.classList.add("error");
}
