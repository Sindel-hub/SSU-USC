import {
  managementRequest as request,
  escapeHtml as e,
} from "../shared/management-client.js";
import { validateAnswers } from "../shared/needs-assessment-model.mjs";
const $ = (id) => document.getElementById(id),
  surveyId = new URLSearchParams(location.search).get("id");
let survey, departments, key;
function status(text, error = false) {
  $("surveyStatus").textContent = text;
  $("surveyStatus").classList.toggle("error", error);
}
function confirmation() {
  status(
    "Your response has been submitted successfully. Thank you for participating in this student needs assessment.",
  );
  $("questionnaire").hidden = true;
}
try {
  const data = await request(
    "survey_public",
    { id: surveyId },
    { publicAccess: true },
  );
  survey = data.survey;
  departments = data.departments;
  $("surveyTitle").textContent = survey.title;
  key = crypto.randomUUID().replaceAll("-", "");
  let alreadySent = false;
  try {
    const saved = localStorage.getItem("needs-key:" + surveyId);
    if (saved) key = saved;
    else localStorage.setItem("needs-key:" + surveyId, key);
    alreadySent = !!localStorage.getItem("needs-sent:" + surveyId);
  } catch {}
  if (alreadySent) confirmation();
  else if (survey.status !== "active")
    status(
      "This survey is " + survey.status + " and is not accepting responses.",
    );
  else {
    $("questionnaire").hidden = false;
    $("description").textContent = survey.description;
    $("instructions").textContent = survey.instructions;
    $("schedule").textContent =
      `Available ${new Date(survey.startsAt).toLocaleString()} – ${new Date(survey.endsAt).toLocaleString()}`;
    $("department").innerHTML =
      '<option value="">Select department</option>' +
      departments
        .filter((d) => survey.department === "all" || survey.department === d)
        .map((d) => `<option>${e(d)}</option>`)
        .join("");
    $("publicQuestions").innerHTML = survey.questions
      .map(
        (q) =>
          `<fieldset class="question form-field"><legend>${e(q.label)} ${q.required ? "(required)" : "(optional)"}</legend>${["choice", "checkbox"].includes(q.type) ? q.options.map((o, i) => `<label><input type="${q.type === "choice" ? "radio" : "checkbox"}" name="${q.id}" value="${e(o)}" ${q.type === "choice" && q.required ? "required" : ""}>${e(o)}</label>`).join("") : q.type === "rating" ? `<label>Rating (1 = lowest, 5 = highest)<select name="${q.id}" ${q.required ? "required" : ""}><option value="">Select rating</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>` : q.type === "short" ? `<label>Your answer<input name="${q.id}" maxlength="500" ${q.required ? "required" : ""}></label>` : `<label>Your answer<textarea name="${q.id}" maxlength="5000" ${q.required ? "required" : ""}></textarea></label>`}</fieldset>`,
      )
      .join("");
    status("Answer the questions below. Required questions are marked.");
  }
} catch (error) {
  status(error.message, true);
}
$("responseForm").onsubmit = async (event) => {
  event.preventDefault();
  if ($("submitSurvey").disabled) return;
  $("submitSurvey").disabled = true;
  try {
    const form = new FormData(event.target),
      answers = {};
    for (const q of survey.questions) {
      const v = form.get(q.id);
      answers[q.id] =
        q.type === "checkbox"
          ? form.getAll(q.id)
          : q.type === "rating" && v
            ? Number(v)
            : v || null;
    }
    validateAnswers(
      survey,
      { department: $("department").value, answers },
      departments,
    );
    await request(
      "survey_submit",
      {
        id: surveyId,
        department: $("department").value,
        answers,
        submissionKey: key,
        website: form.get("website"),
      },
      { publicAccess: true },
    );
    try {
      localStorage.setItem("needs-sent:" + surveyId, "true");
    } catch {}
    confirmation();
  } catch (error) {
    status(error.message, true);
  } finally {
    $("submitSurvey").disabled = false;
  }
};
