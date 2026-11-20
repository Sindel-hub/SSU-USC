export const PUBLIC_MANAGEMENT_ACTIONS = Object.freeze([
  "surveys_available",
  "survey_public",
  "survey_submit",
  "activate",
]);
import {
  validateSurvey,
  validateAnswers,
  surveyStatus,
  surveyAnalytics,
} from "../../../shared/needs-assessment-model.mjs";
import { validateStudentRows } from "../../../shared/student-import-model.mjs";
import { SSU_PROGRAMS } from "../../../usc-admin/student-registration/js/ssu-programs.js";
import { effectiveOfficerPermissions } from "../../../shared/officer-permissions.js";

const departments = Object.keys(SSU_PROGRAMS);
const id = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw Error("Invalid record ID.");
  return value;
};
const write = (path, data, old) => ({
  path,
  data,
  ...(old ? { version: old.version } : {}),
});
const academicFields = [
  "studentId",
  "fullName",
  "college",
  "program",
  "yearLevel",
  "academicYear",
  "studentStanding",
  "institutionalEmail",
];
const academic = (p) =>
  Object.fromEntries(academicFields.map((k) => [k, p[k] ?? ""]));
const sameAcademic = (a, b) =>
  JSON.stringify(academic(a)) === JSON.stringify(academic(b));

// All database/auth/provider access is injected. Tests use an isolated transactional store.
export function createManagementService(io) {
  const now = () => (io.now ? io.now() : Date.now());
  async function privileged(actor, permission) {
    if (!actor?.uid) throw Error("Sign in to continue.");
    const p = await io.get(`users/${id(actor.uid)}`);
    if (
      !p ||
      p.data.isActive === false ||
      p.data.accountStatus !== "approved" ||
      p.data.accountRemoved ||
      p.data.accountRemovalPending
    )
      throw Error("Your account is not authorized.");
    if (p.data.role === "admin" && actor.role === "admin") return p.data;
    if (
      !permission ||
      p.data.role !== "officer" ||
      (p.data.studentStanding && p.data.studentStanding !== "active") ||
      !effectiveOfficerPermissions(p.data, {
        legacyFullAccess: false,
      }).includes(permission)
    )
      throw Error("You do not have permission for this operation.");
    return p.data;
  }
  async function bounded(collection, parent = "", limit = 10000) {
    const rows = await io.list(collection, parent, limit + 1);
    if (rows.length > limit)
      throw Error(
        "This dataset exceeds the safe interactive limit. Ask the administrator to arrange a paginated export.",
      );
    return rows;
  }
  async function audit(actor, action, target, details = {}) {
    return write(`audit_logs/${io.random()}`, {
      actorUid: actor.uid,
      action,
      target,
      details,
      createdAt: new Date(now()),
      createdAtMs: now(),
      source: "usc-management",
    });
  }
  async function surveyFor(surveyId) {
    const path = `needs_surveys/${id(surveyId)}`,
      old = await io.get(path);
    if (!old) throw Error("Survey not found.");
    return { path, old };
  }
  async function guardRate(key, maximum = 60, period = 3600000) {
    const path = `management_rate_limits/${await io.hash(key + ":" + Math.floor(now() / period))}`,
      old = await io.get(path);
    if ((old?.data.count || 0) >= maximum)
      throw Error("Too many requests. Please try again later.");
    return write(
      path,
      { count: (old?.data.count || 0) + 1, expiresAtMs: now() + period * 2 },
      old,
    );
  }
  async function records() {
    return bounded("student_masterlist");
  }
  async function linked(studentId) {
    const [claim, master, account] = await Promise.all([
      io.get(`student_id_claims/${studentId}`),
      io.get(`student_masterlist/${studentId}`),
      io.get(`school_accounts/${studentId}`),
    ]);
    const uid = claim?.data.uid || account?.data.uid;
    const user = uid ? await io.get(`users/${id(uid)}`) : null;
    return { claim, master, account, user, uid };
  }
  async function previewRow(row) {
    if (row.errors.length) return { ...row, kind: "invalid" };
    const p = await linked(row.data.studentId);
    let kind = "new";
    const errors = [...row.errors];
    if (p.claim || p.master || p.account) {
      if (
        !p.uid ||
        !p.user ||
        p.user.data.role !== "student" ||
        !p.master ||
        !p.account ||
        !p.claim ||
        p.user.data.studentId !== row.data.studentId ||
        p.claim.data.uid !== p.account.data.uid ||
        p.user.data.accountRemoved ||
        p.user.data.accountRemovalPending
      )
        errors.push(
          "Inconsistent existing account. Resolve in User Directory before importing.",
        );
      else if (p.user.data.accountStatus === "suspended")
        errors.push("Suspended account requires manual administrator review.");
      else if (
        (p.user.data.institutionalEmail || "") !== row.data.institutionalEmail
      )
        errors.push(
          "Email changes require the existing verified email workflow; keep the existing email in this file.",
        );
      if (
        p.master?.data.academicYear &&
        Number(row.data.academicYear.slice(0, 4)) <
          Number(p.master.data.academicYear.slice(0, 4))
      )
        errors.push(
          "This academic year is older than the current verified record.",
        );
      kind = errors.length
        ? "conflict"
        : sameAcademic(p.master.data, row.data)
          ? "unchanged"
          : "existing";
    }
    return {
      ...row,
      kind,
      errors,
      versions: {
        claim: p.claim?.version || "",
        master: p.master?.version || "",
        account: p.account?.version || "",
        user: p.user?.version || "",
      },
    };
  }
  async function applyRow(plan, row, actor) {
    const studentId = row.data.studentId,
      p = await linked(studentId),
      stamp = now();
    for (const key of ["claim", "master", "account", "user"])
      if ((p[key]?.version || "") !== row.versions[key])
        throw Error(
          `Student ${studentId} changed after preview. Prepare a new import.`,
        );
    if (row.kind === "unchanged") {
      return {
        kind: "unchanged",
        operations: p.master.data.reviewRequired
          ? [
              write(
                `student_masterlist/${studentId}`,
                {
                  reviewRequired: false,
                  reviewAcademicYear: "",
                  verifiedBy: actor.uid,
                  verifiedAtMs: stamp,
                },
                p.master,
              ),
            ]
          : [],
      };
    }
    let uid = p.uid;
    if (row.kind === "new") uid = await io.ensurePendingAccount(studentId); // deterministic UID; passwordless, disabled Auth record
    const pending =
      row.kind === "new" || p.user?.data.activationStatus === "pending";
    const accountStatus = pending ? "pending" : p.user.data.accountStatus;
    const active =
      row.data.studentStanding === "active" && accountStatus === "approved";
    const common = {
      ...row.data,
      enrollmentStatus:
        row.data.studentStanding === "active" ? "Enrolled" : "Not Enrolled",
      updatedAtMs: stamp,
    };
    const operations = [
      write(
        `student_masterlist/${studentId}`,
        {
          ...common,
          eligible: active,
          reviewRequired: false,
          verificationMethod: "annual_admin_import",
          verifiedBy: actor.uid,
          verifiedAtMs: stamp,
        },
        p.master,
      ),
      write(
        `school_accounts/${studentId}`,
        {
          ...common,
          uid,
          authEmail:
            p.account?.data.authEmail || `${studentId}@student.ssu-usc.local`,
          active,
        },
        p.account,
      ),
      write(
        `users/${uid}`,
        {
          ...common,
          uid,
          authEmail:
            p.user?.data.authEmail || `${studentId}@student.ssu-usc.local`,
          email: p.user?.data.email || row.data.institutionalEmail,
          role: "student",
          accountStatus,
          isActive: active,
          isVerifiedStudent: active,
          schoolProvisioned: true,
          ...(row.kind === "new"
            ? { createdAt: new Date(stamp), createdAtMs: stamp }
            : {}),
          ...(pending ? { activationStatus: "pending" } : {}),
        },
        p.user,
      ),
      write(`student_academic_history/${io.random()}`, {
        studentId,
        uid,
        previous: p.master ? academic(p.master.data) : null,
        current: academic(row.data),
        importId: plan.id,
        actorUid: actor.uid,
        createdAtMs: stamp,
      }),
    ];
    if (row.kind === "new") {
      operations.push(
        write(`student_id_claims/${studentId}`, {
          studentId,
          uid,
          authEmail: `${studentId}@student.ssu-usc.local`,
          institutionalEmail: row.data.institutionalEmail,
          createdBy: actor.uid,
          updatedAtMs: stamp,
        }),
      );
      operations.push(
        write(`login_aliases/id_${studentId}`, {
          uid,
          authEmail: `${studentId}@student.ssu-usc.local`,
          kind: "studentId",
          updatedAtMs: stamp,
        }),
      );
    }
    return { kind: row.kind, operations };
  }
  /**
   * @param {string} action
   * @param {Record<string, any>} body
   * @param {{uid:string, role:string}|null} actor
   * @param {string} network
   */
  return async function handle(action, body = {}, actor = null, network = "") {
    if (action === "surveys_available") {
      return {
        surveys: (await bounded("needs_surveys", "", 500))
          .filter((r) => r.data.state === "published" && r.data.endsAt > now())
          .map((r) => ({
            id: r.id,
            title: r.data.title,
            description: r.data.description,
            department: r.data.department,
            startsAt: r.data.startsAt,
            endsAt: r.data.endsAt,
            status: surveyStatus(r.data, now()),
          })),
      };
    }
    if (action === "survey_public") {
      const { old } = await surveyFor(body.id);
      if (old.data.state === "draft" || old.data.state === "archived")
        throw Error("Survey is unavailable.");
      const {
        title,
        description,
        instructions,
        department,
        questions,
        startsAt,
        endsAt,
      } = old.data;
      return {
        survey: {
          id: body.id,
          title,
          description,
          instructions,
          department,
          questions,
          startsAt,
          endsAt,
          state: old.data.state,
          status: surveyStatus(old.data, now()),
        },
        departments,
      };
    }
    if (action === "survey_submit") {
      if (!/^[a-f0-9]{32,64}$/.test(body.submissionKey || "") || body.website)
        throw Error("Invalid submission.");
      const { path, old } = await surveyFor(body.id);
      const response = validateAnswers(old.data, body, departments, now());
      const markerPath = `needs_submission_keys/${await io.hash(body.id + ":" + body.submissionKey)}`;
      if (await io.get(markerPath)) return { submitted: true, duplicate: true };
      const rate = await guardRate("survey:" + body.id + ":" + network, 60);
      await io.commit([
        write(path, { responseCount: (old.data.responseCount || 0) + 1 }, old),
        write(`needs_surveys/${body.id}/responses/${io.random()}`, {
          ...response,
          submittedAtMs: now(),
        }),
        write(markerPath, { surveyId: body.id, createdAtMs: now() }),
        rate,
      ]);
      return { submitted: true };
    }
    if (action === "activate") {
      if (
        !/^[a-f0-9]{64}$/.test(body.token || "") ||
        typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128
      )
        throw Error(
          "Use a valid activation link and a password of 12–128 characters.",
        );
      const path = `student_activation_tokens/${await io.hash(body.token)}`,
        token = await io.get(path);
      if (
        !token ||
        token.data.state !== "ready" ||
        token.data.expiresAtMs <= now()
      )
        throw Error(
          "This activation link has expired or was already used. Contact the administrator.",
        );
      const userPath = `users/${id(token.data.uid)}`,
        user = await io.get(userPath);
      if (
        !user ||
        user.data.activationStatus !== "pending" ||
        user.data.activationTokenHash !== (await io.hash(body.token))
      )
        throw Error("This activation link is no longer valid.");
      // Consume before crossing into Auth. A provider failure requires a fresh token;
      // it can never make the same bearer link reusable.
      await io.commit([
        write(path, { state: "consumed", consumedAtMs: now() }, token),
        await guardRate("activate:" + network, 20),
      ]);
      await io.activateAuth(token.data.uid, body.password);
      const latest = await io.get(userPath);
      if (latest.version !== user.version)
        throw Error(
          "Account changed during activation. Contact the administrator for a new link.",
        );
      const active = user.data.studentStanding === "active";
      const account = await io.get(`school_accounts/${user.data.studentId}`),
        master = await io.get(`student_masterlist/${user.data.studentId}`);
      await io.commit([
        write(
          userPath,
          {
            accountStatus: "approved",
            activationStatus: "active",
            isActive: active,
            isVerifiedStudent: active,
            activationTokenHash: "",
            activatedAtMs: now(),
          },
          user,
        ),
        write(`school_accounts/${user.data.studentId}`, { active }, account),
        write(
          `student_masterlist/${user.data.studentId}`,
          { eligible: active },
          master,
        ),
        write(`audit_logs/${io.random()}`, {
          action: "STUDENT_ACCOUNT_ACTIVATED",
          targetUid: token.data.uid,
          createdAt: new Date(now()),
          createdAtMs: now(),
        }),
      ]);
      return { activated: true };
    }
    const surveyActions = [
      "survey_list",
      "survey_save",
      "survey_state",
      "survey_analytics",
    ];
    await privileged(
      actor,
      action === "survey_links"
        ? "bulletin.manage"
        : surveyActions.includes(action)
          ? "needs.manage"
          : null,
    );
    if (action === "survey_links")
      return {
        surveys: (await bounded("needs_surveys", "", 500))
          .filter((r) => r.data.state === "published")
          .map((r) => ({
            id: r.id,
            title: r.data.title,
            status: surveyStatus(r.data, now()),
          })),
      };
    if (action === "survey_list")
      return {
        surveys: (await bounded("needs_surveys", "", 500)).map((r) => ({
          id: r.id,
          ...r.data,
          status: surveyStatus(r.data, now()),
        })),
        departments,
      };
    if (action === "survey_save") {
      const data = validateSurvey(body.survey, departments),
        surveyId = body.id ? id(body.id) : io.random();
      const path = `needs_surveys/${surveyId}`,
        old = await io.get(path);
      if (old && old.data.state !== "draft")
        throw Error(
          "Published survey questions and schedule are locked. Create a new survey instead.",
        );
      await io.commit([
        write(
          path,
          {
            ...data,
            state: "draft",
            responseCount: 0,
            updatedAtMs: now(),
            createdBy: old?.data.createdBy || actor.uid,
          },
          old,
        ),
        await audit(actor, "NEEDS_SURVEY_SAVED", surveyId),
      ]);
      return { id: surveyId };
    }
    if (action === "survey_state") {
      const { path, old } = await surveyFor(body.id),
        next = body.state;
      if (
        !(
          {
            draft: ["published", "archived"],
            published: ["closed", "archived"],
            closed: ["archived"],
            archived: [],
          }[old.data.state] || []
        ).includes(next)
      )
        throw Error("Invalid survey status transition.");
      if (next === "published" && old.data.endsAt <= now())
        throw Error("Set a future deadline before publishing.");
      await io.commit([
        write(path, { state: next, updatedAtMs: now() }, old),
        await audit(actor, "NEEDS_SURVEY_" + next.toUpperCase(), body.id),
      ]);
      return { state: next };
    }
    if (action === "survey_analytics") {
      const { old } = await surveyFor(body.id);
      if (
        body.department &&
        body.department !== "all" &&
        !departments.includes(body.department)
      )
        throw Error("Invalid department filter.");
      const rows = (await bounded("responses", `needs_surveys/${body.id}`)).map(
        (r) => r.data,
      );
      return {
        survey: {
          id: body.id,
          ...old.data,
          status: surveyStatus(old.data, now()),
        },
        analytics: surveyAnalytics(old.data, rows, body.department || "all"),
      };
    }
    if (action === "students_list")
      return {
        students: (await records()).map((r) => ({ id: r.id, ...r.data })),
        departments,
        programs: SSU_PROGRAMS,
      };
    if (action === "student_detail") {
      const studentId = id(body.studentId),
        p = await linked(studentId);
      if (!p.master) throw Error("Student not found.");
      const history = (await bounded("student_academic_history"))
        .filter((r) => r.data.studentId === studentId)
        .map((r) => r.data);
      // Existing participation records only. Never join anonymous survey responses.
      const events = [];
      for (const collection of ["events", "programs"]) {
        for (const event of await bounded(collection, "", 1000)) {
          const registration = p.uid
            ? await io.get(`${collection}/${event.id}/registrations/${p.uid}`)
            : null;
          if (registration)
            events.push({
              eventTitle: event.data.title || event.id,
              status: registration.data.status || "registered",
            });
        }
      }
      const submissions = (await bounded("complaints"))
        .filter(
          (r) =>
            r.data.studentUid === p.uid ||
            r.data.uid === p.uid ||
            r.data.studentId === studentId,
        )
        .map((r) => ({
          reference: r.id,
          status: r.data.status,
          createdAtMs: r.data.createdAtMs || null,
        }));
      return {
        student: p.master.data,
        account: {
          uid: p.uid,
          accountStatus: p.user?.data.accountStatus || "missing",
          activationStatus:
            p.user?.data.activationStatus ||
            (p.user ? "legacy account" : "missing"),
        },
        history,
        events,
        submissions,
      };
    }
    if (action === "import_preview") {
      const rows = validateStudentRows(body.table),
        years = new Set(rows.map((r) => r.data.academicYear));
      if (years.size !== 1)
        throw Error("Each import must contain a single academic year.");
      const checked = [];
      // Validation reads are independent; limit concurrency to avoid provider bursts.
      for (let offset = 0; offset < rows.length; offset += 10) {
        checked.push(
          ...(await Promise.all(
            rows.slice(offset, offset + 10).map(previewRow),
          )),
        );
      }
      const existing = await records(),
        incoming = new Set(rows.map((r) => r.data.studentId));
      const missing =
        body.annual === true
          ? existing
              .filter((r) => !incoming.has(r.id))
              .map((r) => ({ id: r.id, version: r.version }))
          : [];
      const importId = io.random(),
        stamp = now();
      const plan = {
        id: importId,
        rowCount: checked.length,
        missingCount: missing.length,
        invalidCount: checked.filter((r) => r.errors.length).length,
        duplicateCount: checked.filter((r) =>
          r.errors.some((e) => e.includes("Duplicate")),
        ).length,
        annual: body.annual === true,
        academicYear: [...years][0],
        actorUid: actor.uid,
        state: "preview",
        cursor: 0,
        missingCursor: 0,
        counts: { new: 0, existing: 0, unchanged: 0, flagged: 0 },
        createdAtMs: stamp,
        expiresAtMs: stamp + 3600000,
      };
      // Keep each Firestore document comfortably below 1 MiB. The metadata,
      // validated rows and absence snapshot are committed together before preview.
      const chunks = [];
      for (let offset = 0; offset < checked.length; offset += 50)
        chunks.push(
          write(
            `student_imports/${importId}/chunks/rows-${Math.floor(offset / 50)}`,
            { entries: checked.slice(offset, offset + 50) },
          ),
        );
      for (let offset = 0; offset < missing.length; offset += 100)
        chunks.push(
          write(
            `student_imports/${importId}/chunks/missing-${Math.floor(offset / 100)}`,
            { entries: missing.slice(offset, offset + 100) },
          ),
        );
      const planPath = `student_imports/${importId}`;
      await io.commit([write(planPath, { ...plan, state: "preparing" })]);
      try {
        for (let offset = 0; offset < chunks.length; offset += 25)
          await io.commit(chunks.slice(offset, offset + 25));
        const prepared = await io.get(planPath);
        await io.commit([
          write(planPath, { state: "preview" }, prepared),
          await audit(actor, "STUDENT_IMPORT_PREVIEW", importId, {
            rows: rows.length,
          }),
        ]);
      } catch (error) {
        const incomplete = await io.get(planPath);
        if (incomplete)
          await io.commit([write(planPath, { state: "failed" }, incomplete)]);
        throw error;
      }
      return {
        id: importId,
        rows: checked.map(({ versions, ...r }) => r),
        missing: missing.length,
        canApply: checked.every((r) => !r.errors.length),
        expiresAtMs: plan.expiresAtMs,
      };
    }
    if (action === "import_preview_details") {
      const plan = await io.get(`student_imports/${id(body.id)}`);
      if (!plan || plan.data.actorUid !== actor.uid)
        throw Error("Import not found for this administrator.");
      return {
        id: body.id,
        rows: (await bounded("chunks", `student_imports/${body.id}`, 250))
          .filter((c) => c.id.startsWith("rows-"))
          .sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)))
          .flatMap((c) => c.data.entries)
          .map(({ versions, ...r }) => r),
        missing: plan.data.missingCount,
        canApply:
          ["preview", "applying"].includes(plan.data.state) &&
          plan.data.invalidCount === 0 &&
          plan.data.expiresAtMs > now(),
        expiresAtMs: plan.data.expiresAtMs,
        counts: plan.data.counts,
      };
    }
    if (action === "import_apply") {
      if (body.confirm !== true)
        throw Error("Confirm the import preview first.");
      const path = `student_imports/${id(body.id)}`;
      // Bounded, resumable work: every row and its progress marker are one atomic commit.
      for (let step = 0; step < 20; step++) {
        const old = await io.get(path),
          plan = old?.data;
        if (!plan || plan.actorUid !== actor.uid)
          throw Error("Import not found for this administrator.");
        if (plan.state === "complete")
          return { done: true, counts: plan.counts };
        if (!["preview", "applying"].includes(plan.state))
          throw Error(
            "Preview preparation is incomplete. Upload the file again.",
          );
        if (plan.expiresAtMs <= now())
          throw Error("Import preview expired. Prepare a new preview.");
        if (plan.invalidCount > 0)
          throw Error(
            "Correct every invalid/conflicting row before applying this file.",
          );
        if (plan.cursor < plan.rowCount) {
          const chunk = await io.get(
              `${path}/chunks/rows-${Math.floor(plan.cursor / 50)}`,
            ),
            row = chunk.data.entries[plan.cursor % 50];
          const result = await applyRow(plan, row, actor);
          const counts = {
            ...plan.counts,
            [result.kind]: plan.counts[result.kind] + 1,
          };
          await io.commit([
            ...result.operations,
            write(
              path,
              { cursor: plan.cursor + 1, state: "applying", counts },
              old,
            ),
            await audit(actor, "STUDENT_IMPORT_ROW", row.data.studentId, {
              importId: plan.id,
              kind: result.kind,
            }),
          ]);
        } else if (plan.missingCursor < plan.missingCount) {
          const chunk = await io.get(
            `${path}/chunks/missing-${Math.floor(plan.missingCursor / 100)}`,
          );
          const target = chunk.data.entries[plan.missingCursor % 100],
            student = await io.get(`student_masterlist/${target.id}`);
          if (!student || student.version !== target.version)
            throw Error(
              `Missing student ${target.id} changed after preview. Review before retrying with a new file.`,
            );
          await io.commit([
            write(
              `student_masterlist/${target.id}`,
              { reviewRequired: true, reviewAcademicYear: plan.academicYear },
              student,
            ),
            write(
              path,
              {
                missingCursor: plan.missingCursor + 1,
                counts: { ...plan.counts, flagged: plan.counts.flagged + 1 },
              },
              old,
            ),
          ]);
        } else {
          await io.commit([
            write(path, { state: "complete", completedAtMs: now() }, old),
            await audit(
              actor,
              "STUDENT_IMPORT_COMPLETED",
              plan.id,
              plan.counts,
            ),
          ]);
          return { done: true, counts: plan.counts };
        }
      }
      const plan = (await io.get(path)).data;
      return {
        done: false,
        counts: plan.counts,
        processed: plan.cursor,
        flagged: plan.missingCursor,
      };
    }
    if (action === "import_history")
      return {
        imports: (await bounded("student_imports", "", 1000)).map((r) => ({
          id: r.id,
          state: r.data.state,
          counts: r.data.counts,
          academicYear: r.data.academicYear,
          createdAtMs: r.data.createdAtMs,
          cursor: r.data.cursor,
          total: r.data.rowCount,
          invalid: r.data.invalidCount,
          duplicates: r.data.duplicateCount,
        })),
      };
    if (action === "student_status") {
      if (
        ![
          "active",
          "inactive",
          "graduated",
          "leave",
          "transferred",
          "withdrawn",
          "eliminated",
        ].includes(body.status)
      )
        throw Error("Invalid student status.");
      const studentId = id(body.studentId),
        p = await linked(studentId);
      if (
        !p.user ||
        !p.master ||
        !p.account ||
        p.user.data.role !== "student" ||
        p.user.data.accountRemoved ||
        p.user.data.accountRemovalPending
      )
        throw Error("Resolve this account in User Directory first.");
      const active =
        body.status === "active" && p.user.data.accountStatus === "approved";
      const change = {
        studentStanding: body.status,
        enrollmentStatus:
          body.status === "active" ? "Enrolled" : "Not Enrolled",
        updatedAtMs: now(),
      };
      await io.commit([
        write(
          `student_masterlist/${studentId}`,
          { ...change, eligible: active, reviewRequired: false },
          p.master,
        ),
        write(
          `users/${p.uid}`,
          { ...change, isActive: active, isVerifiedStudent: active },
          p.user,
        ),
        write(`school_accounts/${studentId}`, { ...change, active }, p.account),
        write(`student_academic_history/${io.random()}`, {
          studentId,
          uid: p.uid,
          previous: academic(p.master.data),
          current: academic({ ...p.master.data, ...change }),
          actorUid: actor.uid,
          createdAtMs: now(),
        }),
        await audit(actor, "STUDENT_STATUS_CHANGED", studentId, {
          from: p.master.data.studentStanding,
          to: body.status,
        }),
      ]);
      return { updated: true };
    }
    if (action === "activation_issue") {
      const studentId = id(body.studentId),
        p = await linked(studentId);
      if (
        !p.user ||
        p.user.data.activationStatus !== "pending" ||
        p.user.data.accountStatus !== "pending"
      )
        throw Error(
          "Only pending imported accounts can receive activation instructions.",
        );
      if (body.delivery !== "email" && body.identityChecked !== true)
        throw Error(
          "Verify the student’s identity in person before issuing a sealed activation link.",
        );
      if (body.delivery === "email" && !p.user.data.institutionalEmail)
        throw Error(
          "No verified-source email is recorded. Use in-person identity verification.",
        );
      const token = io.random() + io.random(),
        hash = await io.hash(token),
        stamp = now();
      await io.commit([
        write(`student_activation_tokens/${hash}`, {
          uid: p.uid,
          state: "ready",
          expiresAtMs: stamp + 86400000,
          createdAtMs: stamp,
        }),
        write(`users/${p.uid}`, { activationTokenHash: hash }, p.user),
        await audit(actor, "STUDENT_ACTIVATION_ISSUED", studentId, {
          delivery: body.delivery === "email" ? "email" : "in-person",
        }),
      ]);
      const url = io.portalUrl + "/survey/activate.html#token=" + token;
      if (body.delivery === "email") {
        if (!p.user.data.institutionalEmail)
          throw Error(
            "No verified-source email is recorded. Use in-person identity verification.",
          );
        await io.sendActivation(p.user.data.institutionalEmail, url);
        return { sent: true };
      }
      return { url, expiresAtMs: stamp + 86400000 };
    }
    throw Error("Unknown management operation.");
  };
}
