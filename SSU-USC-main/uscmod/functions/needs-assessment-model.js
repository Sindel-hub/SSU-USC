"use strict";
const DEPARTMENTS = Object.freeze(['College of Education', 'College of Arts and Sciences', 'College of Nursing and Health Sciences', 'College of Engineering', 'College of Industrial Technology']);
function fail(message) { const e = new Error(message); e.code = 'invalid-argument'; throw e; }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function validateSurvey(input) {
  if (!input || typeof input !== 'object') fail('Survey is required.');
  const title = text(input.title, 160, 'Title');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 3000) fail('Description is too long.');
  if (!Array.isArray(input.departments)) fail("Select target departments.");
  const departments = [...new Set(input.departments)];
  if (!departments.length || departments.some(d => !DEPARTMENTS.includes(d))) fail('Select valid target departments.');
  const opensAt = Number(input.opensAt), closesAt = Number(input.closesAt);
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || opensAt <= 0 || closesAt <= opensAt) fail('Closing time must follow the opening time.');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 30) fail('Add between 1 and 30 questions.');
  const questions = input.questions.map((q, i) => {
    if (!q || typeof q !== 'object') fail('Invalid question.');
    if (Array.isArray(q.options) && q.options.length > 15) fail('Maximum 15 choices.');
    const id = `q${i + 1}`, label = text(q.label, 300, 'Question');
    if (!['single', 'multiple', 'rating', 'text'].includes(q.type)) fail('Unknown question type.');
    const options = ['single', 'multiple'].includes(q.type) ? (Array.isArray(q.options) ? q.options.map(v => text(v, 150, 'Option')) : []) : [];
    if (['single', 'multiple'].includes(q.type) && (options.length < 2 || options.length > 15 || new Set(options).size !== options.length)) fail('Choice questions need 2–15 distinct options.');
    return { id, label, type: q.type, required: q.required !== false, options };
  });
  return { title, description, departments, opensAt, closesAt, questions };
}
function surveyStatus(s, now = Date.now()) {
  if (s.status !== 'published') return s.status;
  return now < s.opensAt ? 'scheduled' : now >= s.closesAt ? 'closed' : 'open';
}
function validateResponse(survey, input, now = Date.now()) {
  if (surveyStatus(survey, now) !== 'open') fail('This survey is not accepting responses.');
  if (!survey.departments.includes(input?.department)) fail('Select a department targeted by this survey.');
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) fail('Answers are required.');
  if (Object.keys(input.answers).some(id => !survey.questions.some(q => q.id === id))) fail('Unexpected question.');
  const answers = {};
  for (const q of survey.questions) {
    const v = input.answers[q.id];
    const blank = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (blank) { if (q.required) fail(`Answer: ${q.label}`); continue; }
    if (q.type === 'text') answers[q.id] = text(v, 2000, q.label);
    if (q.type === 'rating') { if (!Number.isInteger(v) || v < 1 || v > 5) fail('Ratings must be from 1 to 5.'); answers[q.id] = v; }
    if (q.type === 'single') { if (!q.options.includes(v)) fail('Invalid choice.'); answers[q.id] = v; }
    if (q.type === 'multiple') { if (!Array.isArray(v) || !v.length || v.length > q.options.length || new Set(v).size !== v.length || v.some(x => !q.options.includes(x))) fail('Invalid choices.'); answers[q.id] = v; }
  }
  return { department: input.department, answers };
}
module.exports = { DEPARTMENTS, validateSurvey, validateResponse, surveyStatus };
