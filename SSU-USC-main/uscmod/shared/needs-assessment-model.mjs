export const QUESTION_TYPES = ["choice", "checkbox", "short", "long", "rating"];
export function surveyStatus(s, now = Date.now()) {
  if (["draft", "closed", "archived"].includes(s.state)) return s.state;
  return now < s.startsAt ? "scheduled" : now >= s.endsAt ? "closed" : "active";
}
const text = (v, n) =>
  typeof v === "string" && v.trim().length <= n ? v.trim() : "";
export function validateSurvey(input, departments) {
  const title = text(input.title, 160),
    description = text(input.description || "", 3000),
    instructions = text(input.instructions || "", 3000);
  if (
    (input.description && !description) ||
    (input.instructions && !instructions)
  )
    throw Error(
      "Description and instructions must each be at most 3000 characters.",
    );
  const startsAt = Number(input.startsAt),
    endsAt = Number(input.endsAt);
  if (
    !title ||
    !Number.isSafeInteger(startsAt) ||
    !Number.isSafeInteger(endsAt) ||
    !Number.isFinite(new Date(startsAt).getTime()) ||
    !Number.isFinite(new Date(endsAt).getTime()) ||
    endsAt <= startsAt
  )
    throw Error("Enter a title and valid start/deadline.");
  const department = input.department || "all";
  if (department !== "all" && !departments.includes(department))
    throw Error("Select a valid department.");
  if (
    !Array.isArray(input.questions) ||
    !input.questions.length ||
    input.questions.length > 40
  )
    throw Error("Add between 1 and 40 questions.");
  const questions = input.questions.map((q, i) => {
    const label = text(q.label, 500),
      type = q.type;
    if (!label || !QUESTION_TYPES.includes(type))
      throw Error(`Question ${i + 1}: enter a label and valid type.`);
    const options =
      ["choice", "checkbox"].includes(type) && Array.isArray(q.options)
        ? q.options.map((v) => text(v, 200))
        : [];
    if (
      ["choice", "checkbox"].includes(type) &&
      (options.length < 2 ||
        options.length > 20 ||
        options.some((v) => !v) ||
        new Set(options).size !== options.length)
    )
      throw Error(`Question ${i + 1}: enter 2–20 distinct answer options.`);
    return {
      id: `q${i + 1}`,
      label,
      type,
      required: q.required === true,
      options,
    };
  });
  return {
    title,
    description,
    instructions,
    startsAt,
    endsAt,
    department,
    questions,
  };
}
export function validateAnswers(survey, input, departments, now = Date.now()) {
  if (surveyStatus(survey, now) !== "active")
    throw Error("This survey is not accepting responses.");
  const department = input.department;
  if (
    !departments.includes(department) ||
    (survey.department !== "all" && survey.department !== department)
  )
    throw Error("Select the survey’s target department.");
  if (
    !input.answers ||
    typeof input.answers !== "object" ||
    Array.isArray(input.answers)
  )
    throw Error("Complete the questionnaire.");
  const answers = {};
  for (const q of survey.questions) {
    let value = input.answers[q.id];
    const missing =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && !value.length);
    if (missing) {
      if (q.required) throw Error(`Answer required: ${q.label}`);
      answers[q.id] = null;
      continue;
    }
    if (q.type === "choice" && !q.options.includes(value))
      throw Error(`Invalid answer: ${q.label}`);
    if (
      q.type === "checkbox" &&
      (!Array.isArray(value) ||
        value.length > q.options.length ||
        new Set(value).size !== value.length ||
        value.some((v) => !q.options.includes(v)))
    )
      throw Error(`Invalid selections: ${q.label}`);
    if (
      q.type === "rating" &&
      (!Number.isInteger(value) || value < 1 || value > 5)
    )
      throw Error(`Choose a rating from 1 to 5: ${q.label}`);
    if (["short", "long"].includes(q.type)) {
      value = text(value, q.type === "short" ? 500 : 5000);
      if (!value) throw Error(`Enter a valid response: ${q.label}`);
    }
    answers[q.id] = value;
  }
  return { department, answers };
}
// Small department groups are suppressed in both the UI and downloadable data.
export function surveyAnalytics(survey, rows, department = "all", minimum = 5) {
  const counts = Object.fromEntries(
    [...new Set(rows.map((r) => r.department))].map((d) => [
      d,
      rows.filter((r) => r.department === d).length,
    ]),
  );
  const selected =
    department === "all"
      ? rows
      : rows.filter((r) => r.department === department);
  const eligible =
    department === "all"
      ? selected.filter((r) => counts[r.department] >= minimum)
      : selected;
  const suppressed = eligible.length < minimum;
  const visible = suppressed ? [] : eligible;
  return {
    total: rows.length,
    selected: suppressed ? null : visible.length,
    suppressed,
    departments: Object.entries(counts).map(([name, count]) => ({
      name,
      count: count < minimum ? null : count,
    })),
    submissionDays: [
      ...new Set(
        visible
          .filter((r) => Number.isFinite(r.submittedAtMs))
          .map((r) => new Date(r.submittedAtMs).toISOString().slice(0, 10)),
      ),
    ]
      .sort()
      .map((day) => {
        const count = visible.filter(
          (r) =>
            Number.isFinite(r.submittedAtMs) &&
            new Date(r.submittedAtMs).toISOString().startsWith(day),
        ).length;
        return { day, count: count < minimum ? null : count };
      }),
    questions: survey.questions.map((q) => {
      const values = visible
        .map((r) => r.answers[q.id])
        .filter((v) => v !== null && v !== undefined);
      const options = q.type === "rating" ? [1, 2, 3, 4, 5] : q.options;
      const frequencies = options.map((option) => ({
        option,
        count: values.filter((v) =>
          Array.isArray(v) ? v.includes(option) : v === option,
        ).length,
      }));
      return {
        id: q.id,
        label: q.label,
        type: q.type,
        answered: values.length,
        frequencies: frequencies.map((v) => ({
          ...v,
          percentage: values.length
            ? Math.round((v.count / values.length) * 1000) / 10
            : 0,
        })),
        average:
          q.type === "rating" && values.length
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null,
        // Free text is shown without timestamps or per-response department identifiers.
        text: ["short", "long"].includes(q.type) ? values : [],
      };
    }),
  };
}
export function csvCell(value) {
  const s = String(value ?? "");
  return (
    '"' +
    (/^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" + s : s).replaceAll('"', '""') +
    '"'
  );
}
