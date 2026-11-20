// Keep authenticated student navigation in the existing dashboard shell.
// Survey API calls and validation are reused from the public controllers.
const allowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (allowed !== true) await new Promise(() => {});
const questionnaire = new URLSearchParams(location.search).has("id");
document.getElementById("surveyCatalog").hidden = questionnaire;
document.getElementById("surveyQuestionnaire").hidden = !questionnaire;
await import(questionnaire ? "../../survey/survey.js" : "../../survey/list.js");
