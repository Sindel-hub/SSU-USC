import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { fixture } from "../helpers/management-fixture.mjs";
import { parseCsv } from "../../shared/student-import-model.mjs";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  f = fixture();
f.setTime(Date.now());
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!file.startsWith(root + "/")) throw Error("Forbidden");
    const content = await fs.readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".webp": "image/webp",
        ".csv": "text/csv",
      }[path.extname(file)] || "application/octet-stream",
    );
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port,
  endpoint = "https://staging.test/functions/v1/usc-management";
const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Manila",
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
await context.addInitScript(
  ({ endpoint }) => {
    window.USC_MANAGEMENT_FUNCTION_URL = endpoint;
    sessionStorage.setItem(
      "studentProfile",
      JSON.stringify({
        uid: "admin",
        role: "admin",
        fullName: "Test Administrator",
      }),
    );
  },
  { endpoint },
);
await context.route("**/shared/auth-guard.js*", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: "globalThis.USC_AUTH_READY=Promise.resolve(true);",
  }),
);
await context.route("**/firebase/firebase-config.js", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: "export const auth={currentUser:{getIdToken:async()=> 'test-admin'}};",
  }),
);
// Shared profile/notification services are covered independently; keep this
// workflow isolated from live identity/data services while rendering the real shell.
await context.route("**/shared/profile-manager.js*", (route) =>
  route.fulfill({ contentType: "text/javascript", body: "" }),
);
await context.route("**/dashboard/js/notifications.js*", (route) =>
  route.fulfill({ contentType: "text/javascript", body: "" }),
);
await context.route("**/firebase-auth.js", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: "export async function signOut() {}",
  }),
);
await context.route(endpoint, async (route) => {
  try {
    const body = route.request().postDataJSON();
    if (body.file) {
      body.table = parseCsv(
        Buffer.from(body.file.base64, "base64").toString("utf8"),
      );
      delete body.file;
    }
    const actor = route.request().headers()["x-firebase-token"]
      ? { uid: "admin", role: "admin" }
      : null;
    const result = await f.handle(
      body.action,
      body,
      actor,
      "browser-fixture-network",
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...result }),
    });
  } catch (error) {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: error.message }),
    });
  }
});
const shots =
  process.env.USC_MANAGEMENT_SCREENSHOT_DIR ||
  path.join(root, "docs/needs-assessment-review");
await fs.mkdir(shots, { recursive: true });
try {
  await page.goto(origin + "/usc-admin/needs-assessment/needs-assessment.html");
  await page.getByText("No surveys yet.", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Create Survey", exact: true })
    .click();
  await page
    .locator("[name=title]")
    .fill("Student services priorities — TEST DATA");
  await page
    .locator("[name=description]")
    .fill("Local workflow verification with synthetic responses.");
  await page
    .locator("[name=instructions]")
    .fill("Select the service you would most like USC to prioritize.");
  await page.locator("[name=label]").fill("Which service needs more support?");
  await page
    .locator("[name=options]")
    .fill("Library access\nCampus transport\nStudent activities");
  const start = new Date(Date.now() - 3600000),
    end = new Date(Date.now() + 86400000);
  const local = (d) =>
    new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 16);
  await page.locator("[name=startsAt]").fill(local(start));
  await page.locator("[name=endsAt]").fill(local(end));
  await page.screenshot({
    path: path.join(shots, "survey-builder-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).waitFor();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.locator(".badge").filter({ hasText: "active" }).waitFor();
  const [{ id: surveyId }] = await f.io.list("needs_surveys");
  await page.goto(origin + "/survey/list.html");
  await page.getByRole("link", { name: "Take Survey", exact: true }).waitFor();
  assert.ok(
    (
      await page
        .getByRole("link", { name: "Take Survey", exact: true })
        .getAttribute("href")
    ).endsWith(surveyId),
  );
  await page.goto(origin + "/survey/index.html?id=" + surveyId);
  await page.getByRole("button", { name: "Submit Survey" }).waitFor();
  await page.locator("#department").selectOption("College of Engineering");
  await page.getByLabel("Library access", { exact: true }).check();
  await page.screenshot({
    path: path.join(shots, "survey-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(shots, "survey-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Submit Survey" }).click();
  await page
    .getByText("Your response has been submitted successfully.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    (await f.io.list("responses", "needs_surveys/" + surveyId)).length,
    1,
  );
  await page.reload();
  await page
    .getByText("Your response has been submitted successfully.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    (await f.io.list("responses", "needs_surveys/" + surveyId)).length,
    1,
  );
  for (let i = 0; i < 4; i++)
    await f.handle(
      "survey_submit",
      {
        id: surveyId,
        department: "College of Engineering",
        answers: { q1: i < 2 ? "Campus transport" : "Library access" },
        submissionKey: (i + 1).toString(16).padStart(32, "0"),
      },
      null,
      "test-seed-network",
    );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/usc-admin/needs-assessment/needs-assessment.html");
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await page.getByText("Total: 5 responses", { exact: false }).waitFor();
  assert.equal(await page.locator("progress").count(), 3);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV summary" }).click();
  assert.equal(
    (await download).suggestedFilename(),
    "needs-assessment-summary.csv",
  );
  await page.screenshot({
    path: path.join(shots, "survey-analytics-desktop.png"),
    fullPage: true,
  });
  await page.goto(origin + "/usc-admin/student-records/student-records.html");
  await page
    .getByText("No matching student records.", { exact: true })
    .waitFor();
  await page
    .locator("#importFile")
    .setInputFiles(
      path.join(root, "usc-admin/student-records/student-import-template.csv"),
    );
  await page.getByRole("button", { name: "Validate & Preview" }).click();
  await page
    .getByText("Ready for administrator review and confirmation.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Apply Confirmed Import" })
      .isDisabled(),
    true,
  );
  await page.screenshot({
    path: path.join(shots, "student-import-preview-desktop.png"),
    fullPage: true,
  });
  await page.locator("#confirmImport").check();
  await page.getByRole("button", { name: "Apply Confirmed Import" }).click();
  await page
    .getByRole("button", { name: "View Profile", exact: true })
    .waitFor();
  assert.equal(
    (await f.io.get("users/import_000123")).data.accountStatus,
    "pending",
  );
  await page.getByRole("button", { name: "View Profile", exact: true }).click();
  await page.getByText("Activation: pending", { exact: false }).waitFor();
  await page.locator("#identityChecked").check();
  await page
    .getByRole("button", { name: "Issue Private In-person Link" })
    .click();
  await page.locator("#privateLink:not([hidden])").waitFor();
  const linkText = await page.locator("#privateLink").textContent(),
    token = linkText.split("#token=")[1];
  assert.ok(token);
  await page.goto(origin + "/survey/activate.html#token=" + token);
  assert.equal(new URL(page.url()).hash, "");
  await page.locator("#newPassword").fill("test-secure-password-2026");
  await page.locator("#confirmPassword").fill("test-secure-password-2026");
  await page
    .getByRole("button", { name: "Activate Account", exact: true })
    .click();
  await page.getByText("Account activated.", { exact: false }).waitFor();
  assert.equal(
    (await f.io.get("users/import_000123")).data.activationStatus,
    "active",
  );
  await page.goto(origin + "/usc-admin/student-records/student-records.html");
  await page
    .getByRole("button", { name: "View Profile", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(shots, "student-records-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const attachment = await page.evaluate(async (origin) => {
    const { attachSurveyButton } = await import(
      origin + "/shared/management-client.js"
    );
    document.body.innerHTML =
      '<div><p id="testBulletinContent">Bulletin announcement</p></div>';
    const content = document.getElementById("testBulletinContent");
    attachSurveyButton(content, "published_1");
    const href = document
      .querySelector(".attached-survey-link")
      .getAttribute("href");
    attachSurveyButton(content, "published_2");
    const count = document.querySelectorAll(".attached-survey-link").length;
    attachSurveyButton(content, "../../private");
    const rejected = document.querySelectorAll(".attached-survey-link").length;
    return { href, count, rejected };
  }, origin);
  assert.ok(attachment.href.endsWith("/survey/index.html?id=published_1"));
  assert.equal(attachment.count, 1);
  assert.equal(attachment.rejected, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: builder → publish → public desktop/mobile questionnaire → submit → duplicate protection → real service analytics/CSV → import preview/confirmation → pending account → private activation. Browser uses isolated transactional fixtures, not live Firebase or real student records.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
