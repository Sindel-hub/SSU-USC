import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { fixture } from "../helpers/management-fixture.mjs";
import { ALL_OFFICER_PERMISSIONS } from "../../shared/officer-permissions.js";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const beforeRoot = process.env.USC_NEEDS_UI_BASELINE;
const shots =
  process.env.USC_NEEDS_UI_SCREENSHOTS || "/tmp/ssu-needs-assessment-ui";
const f = fixture();
f.setTime(Date.now());
const survey = await f.handle(
  "survey_save",
  {
    survey: {
      title: "Student services priorities — UI TEST DATA",
      description:
        "An isolated consultation used to compare the existing dashboard layouts.",
      instructions: "Choose the service USC should prioritize.",
      department: "all",
      startsAt: Date.now() - 3600000,
      endsAt: Date.now() + 86400000,
      questions: [
        {
          label: "Which service needs more support?",
          type: "choice",
          required: true,
          options: ["Library access", "Campus transport", "Student activities"],
        },
        {
          label: "What would help you most?",
          type: "long",
          required: false,
          options: [],
        },
      ],
    },
  },
  { uid: "admin", role: "admin" },
);
await f.handle(
  "survey_state",
  { id: survey.id, state: "published" },
  { uid: "admin", role: "admin" },
);
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const baseline = beforeRoot && pathname.startsWith("/before/");
    const directory = baseline ? beforeRoot : root;
    const target = path.resolve(
      directory,
      "." + (baseline ? pathname.slice(7) : pathname),
    );
    if (!target.startsWith(directory + "/")) throw Error("Invalid path");
    const data = await fs.readFile(target);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".webp": "image/webp",
      }[path.extname(target)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "Asia/Manila",
});
await context.addInitScript(
  ({ permissions }) => {
    window.USC_MANAGEMENT_FUNCTION_URL =
      "https://staging.test/functions/v1/usc-management";
    if (location.pathname.endsWith("/index/index.html")) return;
    const officer = location.pathname.includes("/usc-admin/");
    sessionStorage.setItem("activeSession", "true");
    sessionStorage.setItem(
      "studentProfile",
      JSON.stringify({
        uid: officer ? "officer" : "student-fixture",
        role: officer ? "officer" : "student",
        fullName: officer ? "Test USC Officer" : "Test Student",
        officerPermissions: permissions,
        officerPermissionSource: "custom",
      }),
    );
  },
  { permissions: ALL_OFFICER_PERMISSIONS },
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
    body: "export const auth={currentUser:{uid:'fixture',getIdToken:async()=> 'fixture-token'}};",
  }),
);
await context.route("**/firebase-auth.js", (route) =>
  route.fulfill({
    contentType: "text/javascript",
    body: "export async function signOut() {}",
  }),
);
for (const pattern of [
  "**/shared/profile-manager.js*",
  "**/dashboard/js/notifications.js*",
  "**/usc-admin/shared/js/admin-auth.js*",
  "**/usc-admin/events/js/events.js*",
  "**/dashboard/js/bulletin.js*",
])
  await context.route(pattern, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
await context.route(
  "https://staging.test/functions/v1/usc-management",
  async (route) => {
    try {
      const body = route.request().postDataJSON();
      const actor = route.request().headers()["x-firebase-token"]
        ? { uid: "officer", role: "officer" }
        : null;
      const result = await f.handle(
        body.action,
        body,
        actor,
        "ui-test-network",
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
  },
);
// Optional local copies of the exact existing CDN assets make screenshots
// reproducible when this environment blocks the public font CDN.
if (process.env.USC_NEEDS_UI_FONT_ASSETS) {
  await context.route(
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/**",
    async (route) => {
      const relative = new URL(route.request().url()).pathname.split(
        "/6.4.0/",
      )[1];
      const file = path.resolve(process.env.USC_NEEDS_UI_FONT_ASSETS, relative);
      const data = await fs.readFile(file);
      await route.fulfill({
        contentType: file.endsWith(".css") ? "text/css" : "font/woff2",
        body: data,
      });
    },
  );
}
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function settle() {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
const metrics = async (selectors) => {
  await settle();
  return page.evaluate(
    (selectors) =>
      Object.fromEntries(
        selectors.map((selector) => {
          const el = document.querySelector(selector),
            s = getComputedStyle(el),
            b = el.getBoundingClientRect();
          return [
            selector,
            {
              width: Math.round(b.width),
              height: Math.round(b.height),
              left: Math.round(b.left),
              color: s.color,
              background: s.backgroundColor,
              backgroundImage: s.backgroundImage,
              font: s.fontFamily,
              fontSize: s.fontSize,
              padding: s.padding,
              borderRadius: s.borderRadius,
              boxShadow: s.boxShadow,
            },
          ];
        }),
      ),
    selectors,
  );
};
async function capture(name) {
  await fs.mkdir(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, name + ".png"),
    fullPage: true,
  });
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Unexpected horizontal page overflow at " + page.url(),
  );
}
try {
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + "/usc-admin/events/events.html");
    await page.locator(".sidebar").waitFor({ state: "attached" });
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar").dataset.mobileNavigationBound ===
        "true",
    );
    const officerSelectors = [
      ".top-banner",
      ".top-nav",
      ".sidebar",
      ".sidebar .nav-btn",
    ];
    const officerReference = await metrics(officerSelectors);
    await capture("officer-reference-" + label);
    await page.goto(
      origin + "/usc-admin/needs-assessment/needs-assessment.html",
    );
    await page.getByRole("button", { name: "Results", exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar").dataset.mobileNavigationBound ===
        "true",
    );
    assert.deepEqual(
      await metrics(officerSelectors),
      officerReference,
      "Officer shell changed at " + label,
    );
    assert.equal(
      await page.locator(".sidebar a.active").getAttribute("href"),
      "../needs-assessment/needs-assessment.html",
    );
    await noOverflow();
    await capture("officer-needs-" + label);
    if (width <= 820) {
      const toggle = page.locator("[data-sidebar-toggle]");
      await toggle.click();
      await page.locator(".sidebar.open").waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page
        .getByRole("button", { name: "Close officer navigation" })
        .click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    }
    await page.locator("#newSurvey").click();
    await page
      .locator("#surveyForm [name=title]")
      .fill("Survey draft — UI test");
    await noOverflow();
    await capture("officer-editor-" + label);
    await page.locator("#cancelEdit").click();
    await page.locator("#officerQuickSearch").fill("needs");
    await page.locator("#officerSearchResults a").first().waitFor();
    assert.ok(
      (
        await page
          .locator("#officerSearchResults a")
          .first()
          .getAttribute("href")
      ).includes("needs-assessment"),
    );
    await page.goto(origin + "/dashboard/bulletin.html");
    const studentSelectors = [
      ".dashboard-header",
      ".student-sidebar",
      ".student-nav-link",
      ".student-module-toolbar",
    ];
    const studentReference = await metrics(studentSelectors);
    await capture("student-reference-" + label);
    await page.goto(origin + "/dashboard/needs-assessment.html");
    await page
      .getByRole("link", { name: "Take Survey", exact: true })
      .waitFor();
    assert.deepEqual(
      await metrics(studentSelectors),
      studentReference,
      "Student shell changed at " + label,
    );
    assert.equal(await page.locator(".student-nav-link.active").count(), 1);
    assert.equal(
      await page.locator(".student-nav-link.active").getAttribute("href"),
      "needs-assessment.html",
    );
    await noOverflow();
    await capture("student-needs-" + label);
    await page.getByRole("link", { name: "Take Survey", exact: true }).click();
    await page
      .getByRole("button", { name: "Submit Survey", exact: true })
      .waitFor();
    assert.ok(page.url().includes("/dashboard/needs-assessment.html?id="));
    assert.deepEqual(
      await metrics(studentSelectors),
      studentReference,
      "Questionnaire left the student shell at " + label,
    );
    await noOverflow();
    await capture("student-questionnaire-" + label);
    await page
      .getByRole("link", { name: "All surveys", exact: false })
      .first()
      .click();
    await page
      .getByRole("link", { name: "Take Survey", exact: true })
      .waitFor();
    await page.locator('.student-nav-link[href="bulletin.html"]').click();
    await page.locator(".bulletin-page-main").waitFor();
    assert.deepEqual(
      await metrics(studentSelectors),
      studentReference,
      "Returning to Bulletin changed the shell at " + label,
    );
    if (beforeRoot) {
      await page.goto(
        origin + "/before/usc-admin/needs-assessment/needs-assessment.html",
      );
      await page
        .getByRole("button", { name: "Results", exact: true })
        .waitFor();
      await capture("before-officer-" + label);
      await page.goto(origin + "/before/survey/list.html");
      await page
        .getByRole("link", { name: "Take Survey", exact: true })
        .waitFor();
      await capture("before-student-" + label);
    }
  }
  // No session is needed for the public link; its API requests stay anonymous.
  await context.clearCookies();
  await page.goto(origin + "/survey/index.html?id=" + survey.id);
  await page.evaluate(() => sessionStorage.clear());
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  await page
    .getByRole("button", { name: "Submit Survey", exact: true })
    .waitFor();
  assert.equal(await page.locator('script[src*="auth-guard"]').count(), 0);
  assert.equal(await page.locator(".student-sidebar").count(), 0);
  await page.locator("#department").selectOption("College of Engineering");
  await page.getByLabel("Library access", { exact: true }).check();
  await page
    .getByRole("button", { name: "Submit Survey", exact: true })
    .click();
  await page
    .getByText("Your response has been submitted successfully.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    (await f.io.list("responses", "needs_surveys/" + survey.id)).length,
    1,
  );
  await noOverflow();
  await capture("public-confirmation-mobile");
  // The shared Bulletin reader keeps authenticated links inside the dashboard.
  await page.goto(origin + "/dashboard/needs-assessment.html");
  await page.getByRole("link", { name: "Take Survey", exact: true }).waitFor();
  const bulletinHref = await page.evaluate(async (id) => {
    const { attachSurveyButton } =
      await import("../shared/management-client.js");
    const container = document.createElement("div"),
      text = document.createElement("p");
    container.append(text);
    document.body.append(container);
    attachSurveyButton(text, id);
    const href = container.querySelector("a").href;
    container.remove();
    return href;
  }, survey.id);
  assert.ok(
    bulletinHref.includes("/dashboard/needs-assessment.html?id=" + survey.id),
  );
  // Only the destination document is stubbed; exercise both new shell handlers.
  await context.route("**/index/index.html", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Sign in</h1>" }),
  );
  await page.locator("#studentLogout").click();
  await page.waitForURL("**/index/index.html");
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  await page.goto(origin + "/usc-admin/needs-assessment/needs-assessment.html");
  await page.getByRole("button", { name: "Results", exact: true }).waitFor();
  await page.locator("[data-sidebar-toggle]").click();
  await page.locator(".sidebar.open").waitFor();
  await page.locator("#needsLogout").click();
  await page.waitForURL("**/index/index.html");
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: matching officer/student shell geometry and computed styles at desktop/tablet/mobile; active states; officer drawer open/close/Escape; module search; editor controls; student navigation and in-dashboard questionnaire; return navigation; authenticated bulletin links; shell logout; anonymous public submission. Data/auth services are isolated fixtures.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
