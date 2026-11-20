import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/management-fixture.mjs";
import {
  validateSurvey,
  validateAnswers,
  surveyStatus,
  surveyAnalytics,
  csvCell,
} from "../shared/needs-assessment-model.mjs";
import {
  IMPORT_HEADERS,
  parseCsv,
  validateStudentRows,
} from "../shared/student-import-model.mjs";
const department = "College of Engineering",
  program = "Bachelor of Science in Computer Engineering";
const admin = { uid: "admin", role: "admin" },
  officer = { uid: "officer", role: "officer" };
const table = (id = "000123", year = "2", status = "Active") => [
  IMPORT_HEADERS,
  [id, "Sample Student", department, program, year, "", "2026–2027", status],
];
const definition = () => ({
  title: "Student needs",
  description: "Plan services",
  instructions: "Do not enter identifying details.",
  department: "all",
  startsAt: 1000,
  endsAt: 10000,
  questions: [
    {
      label: "Your priority",
      type: "choice",
      required: true,
      options: ["Library", "Transport"],
    },
    {
      label: "Select interests",
      type: "checkbox",
      required: false,
      options: ["Arts", "Sports"],
    },
    { label: "Rate access", type: "rating", required: true },
    { label: "Suggestion", type: "long", required: false },
  ],
});
async function published(f) {
  const saved = await f.handle(
    "survey_save",
    { survey: definition() },
    officer,
  );
  await f.handle("survey_state", { id: saved.id, state: "published" }, officer);
  return saved.id;
}
const answers = {
  q1: "Library",
  q2: ["Sports"],
  q3: 4,
  q4: "Extend opening hours",
};

test("survey validation rejects malformed definitions, schedules and answers", () => {
  const s = validateSurvey(definition(), [department]);
  s.state = "published";
  assert.equal(surveyStatus(s, 999), "scheduled");
  assert.equal(surveyStatus(s, 1000), "active");
  assert.equal(surveyStatus(s, 10000), "closed");
  assert.throws(
    () => validateSurvey({ ...definition(), endsAt: 500 }, [department]),
    /deadline/,
  );
  assert.throws(
    () =>
      validateSurvey(
        {
          ...definition(),
          questions: [
            { label: "Bad", type: "choice", options: ["Same", "Same"] },
          ],
        },
        [department],
      ),
    /distinct/,
  );
  assert.throws(
    () =>
      validateAnswers(
        s,
        { department, answers: { q1: "Library" } },
        [department],
        2000,
      ),
    /required/,
  );
  assert.throws(
    () =>
      validateAnswers(
        s,
        { department, answers: { ...answers, q3: 6 } },
        [department],
        2000,
      ),
    /rating/,
  );
  assert.throws(
    () =>
      validateAnswers(
        s,
        { department, answers: { ...answers, q2: ["Unknown"] } },
        [department],
        2000,
      ),
    /selections/,
  );
  assert.throws(
    () => validateAnswers(s, { department, answers }, [department], 10000),
    /not accepting/,
  );
  assert.throws(
    () =>
      validateAnswers(
        { ...s, department: "Other" },
        { department, answers },
        [department],
        2000,
      ),
    /target department/,
  );
});

test("officer creates, publishes and locks survey; anonymous responses use server counts and idempotency", async () => {
  const f = fixture(),
    surveyId = await published(f);
  const publicData = await f.handle("survey_public", { id: surveyId });
  assert.equal(publicData.survey.title, "Student needs");
  assert.equal(publicData.survey.createdBy, undefined);
  await assert.rejects(
    f.handle("survey_save", { id: surveyId, survey: definition() }, officer),
    /locked/,
  );
  const submission = {
    id: surveyId,
    department,
    answers,
    submissionKey: "a".repeat(32),
  };
  await f.handle("survey_submit", submission, null, "hashed-network");
  assert.equal(
    (await f.handle("survey_submit", submission, null, "hashed-network"))
      .duplicate,
    true,
  );
  const survey = await f.io.get("needs_surveys/" + surveyId);
  assert.equal(survey.data.responseCount, 1);
  const rows = await f.io.list("responses", "needs_surveys/" + surveyId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.uid, undefined);
  assert.equal(rows[0].data.studentId, undefined);
  await f.handle("survey_state", { id: surveyId, state: "closed" }, officer);
  await assert.rejects(
    f.handle(
      "survey_submit",
      { ...submission, submissionKey: "b".repeat(32) },
      null,
      "hashed-network",
    ),
    /not accepting/,
  );
});

test("private survey endpoints enforce assigned roles; students cannot read analytics or import records", async () => {
  const f = fixture();
  f.seed("users/student", {
    role: "student",
    isActive: true,
    accountStatus: "approved",
  });
  const surveyId = await published(f);
  await assert.rejects(
    f.handle("survey_analytics", { id: surveyId }),
    /Sign in/,
  );
  await assert.rejects(
    f.handle(
      "survey_analytics",
      { id: surveyId },
      { uid: "student", role: "student" },
    ),
    /permission/,
  );
  await assert.rejects(f.handle("students_list", {}, officer), /permission/);
  f.seed("users/officer", {
    role: "officer",
    isActive: true,
    accountStatus: "approved",
    officerPermissions: ["dashboard.view"],
    officerPermissionSource: "custom",
  });
  await assert.rejects(f.handle("survey_list", {}, officer), /permission/);
});

test("server rate limiting rejects excessive distinct submissions", async () => {
  const f = fixture(),
    surveyId = await published(f);
  for (let i = 0; i < 60; i++)
    await f.handle(
      "survey_submit",
      {
        id: surveyId,
        department,
        answers,
        submissionKey: i.toString(16).padStart(32, "0"),
      },
      null,
      "same-network",
    );
  await assert.rejects(
    f.handle(
      "survey_submit",
      { id: surveyId, department, answers, submissionKey: "f".repeat(32) },
      null,
      "same-network",
    ),
    /Too many/,
  );
  assert.equal(
    (await f.io.get("needs_surveys/" + surveyId)).data.responseCount,
    60,
  );
});

test("analytics use actual frequencies and ratings and suppress small department results", () => {
  const s = validateSurvey(definition(), [department]);
  const rows = Array.from({ length: 5 }, () => ({ department, answers }));
  rows.push({
    department: "Small group",
    answers: { ...answers, q1: "Transport", q4: "Private" },
  });
  const all = surveyAnalytics(s, rows);
  assert.equal(all.total, 6);
  assert.equal(all.selected, 5);
  assert.equal(all.questions[0].frequencies[0].count, 5);
  assert.equal(all.questions[0].frequencies[0].percentage, 100);
  assert.equal(all.questions[2].average, 4);
  assert.deepEqual(
    all.questions[3].text,
    Array(5).fill("Extend opening hours"),
  );
  const small = surveyAnalytics(s, rows, "Small group");
  assert.equal(small.suppressed, true);
  assert.equal(small.selected, null);
  assert.deepEqual(small.questions[3].text, []);
  assert.equal(surveyAnalytics(s, rows.slice(0, 1)).suppressed, true);
  assert.equal(csvCell(' =HYPERLINK("bad")'), '"\' =HYPERLINK(""bad"")"');
});

test("CSV parsing preserves leading zeros and quotes, rejects malformed records and duplicates", () => {
  assert.deepEqual(
    parseCsv(
      '\uFEFFStudent ID,Name\r\n000123,"Doe, Jane"\r\n000124,"A ""quoted"" name"',
    ),
    [
      ["Student ID", "Name"],
      ["000123", "Doe, Jane"],
      ["000124", 'A "quoted" name'],
    ],
  );
  assert.throws(() => parseCsv('"unclosed'), /Unclosed/);
  const valid = validateStudentRows(table());
  assert.equal(valid[0].data.studentId, "000123");
  assert.equal(valid[0].errors.length, 0);
  const duplicate = table();
  duplicate.push([...duplicate[1]]);
  assert.match(validateStudentRows(duplicate)[1].errors.join(" "), /Duplicate/);
  const invalid = table();
  invalid[1][3] = "Wrong program";
  invalid[1][6] = "2026–2029";
  assert.equal(validateStudentRows(invalid)[0].errors.length, 2);
});

test("preview does not create accounts; confirmed import creates pending identities and preserves academic history on yearly update", async () => {
  const f = fixture(),
    preview = await f.handle("import_preview", { table: table() }, admin);
  assert.equal(f.auth.size, 0);
  assert.equal(preview.rows[0].kind, "new");
  await assert.rejects(
    f.handle("import_apply", { id: preview.id }, admin),
    /Confirm/,
  );
  const result = await f.handle(
    "import_apply",
    { id: preview.id, confirm: true },
    admin,
  );
  assert.equal(result.done, true);
  assert.equal(result.counts.new, 1);
  const user = await f.io.get("users/import_000123");
  assert.equal(user.data.activationStatus, "pending");
  assert.equal(user.data.accountStatus, "pending");
  assert.equal(user.data.isActive, false);
  const updated = table("000123", "3");
  updated[1][6] = "2027–2028";
  const second = await f.handle("import_preview", { table: updated }, admin);
  assert.equal(second.rows[0].kind, "existing");
  await f.handle("import_apply", { id: second.id, confirm: true }, admin);
  assert.equal(f.auth.size, 1);
  assert.equal(
    (await f.io.get("student_masterlist/000123")).data.yearLevel,
    "3rd Year",
  );
  assert.equal((await f.io.list("student_academic_history")).length, 2);
  assert.equal(
    (await f.handle("import_apply", { id: second.id, confirm: true }, admin))
      .counts.existing,
    1,
  );
});

test("annual synchronization flags absent students, and never graduates or deactivates them implicitly", async () => {
  const f = fixture();
  let p = await f.handle("import_preview", { table: table() }, admin);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  p = await f.handle(
    "import_preview",
    { table: table("000124"), annual: true },
    admin,
  );
  assert.equal(p.missing, 1);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  const old = (await f.io.get("student_masterlist/000123")).data;
  assert.equal(old.reviewRequired, true);
  assert.equal(old.studentStanding, "active");
});

test("invalid imports apply no records; a stale preview cannot overwrite newer records", async () => {
  const f = fixture(),
    bad = table();
  bad.push([...bad[1]]);
  let p = await f.handle("import_preview", { table: bad }, admin);
  assert.equal(p.canApply, false);
  await assert.rejects(
    f.handle("import_apply", { id: p.id, confirm: true }, admin),
    /Correct every/,
  );
  assert.equal(f.auth.size, 0);
  p = await f.handle("import_preview", { table: table() }, admin);
  f.seed("student_masterlist/000123", {
    studentId: "000123",
    fullName: "Concurrent record",
  });
  await assert.rejects(
    f.handle("import_apply", { id: p.id, confirm: true }, admin),
    /changed after preview/,
  );
  assert.equal(f.auth.size, 0);
});

test("failed atomic submission leaves neither response nor count behind", async () => {
  const f = fixture(),
    surveyId = await published(f);
  f.failNext();
  await assert.rejects(
    f.handle(
      "survey_submit",
      { id: surveyId, department, answers, submissionKey: "c".repeat(32) },
      null,
      "network",
    ),
    /injected/,
  );
  assert.equal(
    (await f.io.get("needs_surveys/" + surveyId)).data.responseCount,
    0,
  );
  assert.equal(
    (await f.io.list("responses", "needs_surveys/" + surveyId)).length,
    0,
  );
});

test("activation requires identity check, expires, invalidates older links and prevents reuse", async () => {
  const f = fixture(),
    p = await f.handle("import_preview", { table: table() }, admin);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  await assert.rejects(
    f.handle("activation_issue", { studentId: "000123" }, admin),
    /Verify/,
  );
  const first = await f.handle(
      "activation_issue",
      { studentId: "000123", delivery: "in-person", identityChecked: true },
      admin,
    ),
    token1 = new URLSearchParams(new URL(first.url).hash.slice(1)).get("token");
  const second = await f.handle(
      "activation_issue",
      { studentId: "000123", delivery: "in-person", identityChecked: true },
      admin,
    ),
    token2 = new URLSearchParams(new URL(second.url).hash.slice(1)).get(
      "token",
    );
  await assert.rejects(
    f.handle(
      "activate",
      { token: token1, password: "a-secure-password" },
      null,
      "network",
    ),
    /no longer valid/,
  );
  const result = await f.handle(
    "activate",
    { token: token2, password: "a-secure-password" },
    null,
    "network",
  );
  assert.equal(result.activated, true);
  await assert.rejects(
    f.handle(
      "activate",
      { token: token2, password: "another-password" },
      null,
      "network",
    ),
    /already used/,
  );
  assert.equal(
    (await f.io.get("users/import_000123")).data.accountStatus,
    "approved",
  );
  assert.equal(f.auth.get("import_000123").disabled, false);
  const p2 = await f.handle(
    "import_preview",
    { table: table("000124") },
    admin,
  );
  await f.handle("import_apply", { id: p2.id, confirm: true }, admin);
  const third = await f.handle(
      "activation_issue",
      { studentId: "000124", identityChecked: true },
      admin,
    ),
    token3 = new URLSearchParams(new URL(third.url).hash.slice(1)).get("token");
  f.setTime(90000000);
  await assert.rejects(
    f.handle(
      "activate",
      { token: token3, password: "a-secure-password" },
      null,
      "network",
    ),
    /expired/,
  );
});

test("status changes preserve history and do not attach anonymous responses", async () => {
  const f = fixture(),
    p = await f.handle("import_preview", { table: table() }, admin);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  await f.handle(
    "student_status",
    { studentId: "000123", status: "graduated" },
    admin,
  );
  assert.equal((await f.io.get("users/import_000123")).data.isActive, false);
  assert.equal(
    (await f.io.get("student_masterlist/000123")).data.studentStanding,
    "graduated",
  );
  const detail = await f.handle(
    "student_detail",
    { studentId: "000123" },
    admin,
  );
  assert.equal(detail.history.length, 2);
  assert.equal(detail.responses, undefined);
});

test("multi-chunk imports resume idempotently across request boundaries and keep plan documents small", async () => {
  const f = fixture();
  const rows = [
    IMPORT_HEADERS,
    ...Array.from(
      { length: 125 },
      (_, i) => table(String(i).padStart(6, "0"))[1],
    ),
  ];
  const p = await f.handle("import_preview", { table: rows }, admin);
  const stored = await f.io.get("student_imports/" + p.id);
  assert.equal(stored.data.rows, undefined);
  assert.equal(stored.data.rowCount, 125);
  assert.equal(
    (await f.io.list("chunks", "student_imports/" + p.id)).length,
    3,
  );
  const original = await f.handle(
    "import_preview_details",
    { id: p.id },
    admin,
  );
  assert.equal(original.rows.length, 125);
  assert.equal(original.rows[50].data.studentId, "000050");
  let result;
  let calls = 0;
  do {
    result = await f.handle("import_apply", { id: p.id, confirm: true }, admin);
    calls++;
  } while (!result.done);
  assert.ok(calls > 1);
  assert.equal(result.counts.new, 125);
  assert.equal(f.auth.size, 125);
  assert.equal(
    (await f.handle("import_apply", { id: p.id, confirm: true }, admin)).counts
      .new,
    125,
  );
});

test("older annual records cannot replace the current verified academic year", async () => {
  const f = fixture();
  let p = await f.handle("import_preview", { table: table() }, admin);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  const older = table();
  older[1][6] = "2025–2026";
  p = await f.handle("import_preview", { table: older }, admin);
  assert.equal(p.canApply, false);
  assert.match(p.rows[0].errors.join(" "), /older/);
});

test("public survey catalog exposes active/scheduled metadata only and hides drafts, closures and owner details", async () => {
  const f = fixture();
  const draft = await f.handle(
    "survey_save",
    { survey: definition() },
    officer,
  );
  const publishedId = await published(f);
  const result = await f.handle("surveys_available");
  assert.equal(result.surveys.length, 1);
  assert.equal(result.surveys[0].id, publishedId);
  assert.equal(result.surveys[0].questions, undefined);
  assert.equal(result.surveys[0].createdBy, undefined);
  assert.notEqual(result.surveys[0].id, draft.id);
  await f.handle("survey_state", { id: publishedId, state: "closed" }, officer);
  assert.equal((await f.handle("surveys_available")).surveys.length, 0);
});

test("a verified record reappearing in an import clears its absence flag without duplicating its account", async () => {
  const f = fixture();
  let p = await f.handle("import_preview", { table: table() }, admin);
  await f.handle("import_apply", { id: p.id, confirm: true }, admin);
  const old = await f.io.get("student_masterlist/000123");
  f.seed("student_masterlist/000123", { ...old.data, reviewRequired: true });
  p = await f.handle("import_preview", { table: table() }, admin);
  assert.equal(p.rows[0].kind, "unchanged");
  const result = await f.handle(
    "import_apply",
    { id: p.id, confirm: true },
    admin,
  );
  assert.equal(result.counts.unchanged, 1);
  assert.equal(
    (await f.io.get("student_masterlist/000123")).data.reviewRequired,
    false,
  );
  assert.equal(f.auth.size, 1);
});

test("browser-provisioned officers use their trusted assigned profile without requiring a nonexistent officer custom claim", async () => {
  const f = fixture();
  const result = await f.handle(
    "survey_list",
    {},
    { uid: "officer", role: "" },
  );
  assert.deepEqual(result.surveys, []);
  await assert.rejects(
    f.handle("students_list", {}, { uid: "officer", role: "" }),
    /permission/,
  );
  f.seed("users/officer", {
    role: "officer",
    isActive: true,
    accountStatus: "approved",
    studentStanding: "inactive",
    officerPermissions: ["needs.manage"],
    officerPermissionSource: "custom",
  });
  await assert.rejects(
    f.handle("survey_list", {}, { uid: "officer", role: "" }),
    /permission/,
  );
});
