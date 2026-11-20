import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateManagementConfig } from "../supabase/functions/usc-management/config.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function validateStagingPublicConfig(config) {
  const keys = Object.keys(config || {});
  const allowedKeys = [
    "projectName",
    "supabaseProjectRef",
    "supabasePublishableKey",
    "portalUrl",
    "firebase",
  ];
  if (keys.some((key) => !allowedKeys.includes(key)))
    throw Error(
      "Only public configuration fields are accepted; never include server secrets.",
    );
  if (keys.some((key) => /secret|private|service.?role|token/i.test(key)))
    throw Error(
      "Only public configuration belongs in the frontend configuration file.",
    );
  if (config?.projectName !== "ssu-usc-email-staging")
    throw Error(
      "Confirm the named staging project before preparing its frontend configuration.",
    );
  if (
    !/^[a-z]{20}$/.test(config.supabaseProjectRef || "") ||
    config.supabaseProjectRef === "svgfxatigtjdrwzibjbu"
  )
    throw Error(
      "Supply the actual isolated staging Supabase project reference, not its display name.",
    );
  const firebase = config.firebase;
  const firebaseKeys = [
    "apiKey",
    "authDomain",
    "projectId",
    "appId",
    "storageBucket",
    "messagingSenderId",
    "measurementId",
    "databaseURL",
  ];
  if (
    firebase &&
    Object.entries(firebase).some(
      ([key, value]) =>
        !firebaseKeys.includes(key) || typeof value !== "string",
    )
  )
    throw Error(
      "Only public Firebase web configuration fields are accepted; never include service-account credentials.",
    );
  if (
    !firebase ||
    ["apiKey", "authDomain", "projectId", "appId"].some(
      (key) => typeof firebase[key] !== "string" || !firebase[key].trim(),
    ) ||
    firebase.projectId === "universitystudentcouncil-856cc"
  )
    throw Error(
      "Supply the isolated staging Firebase public web configuration.",
    );
  if (
    Object.keys(firebase).some((key) =>
      /secret|private|service.?role|token/i.test(key),
    )
  )
    throw Error(
      "Never include Firebase service-account credentials in frontend configuration.",
    );
  if (
    typeof config.supabasePublishableKey !== "string" ||
    !config.supabasePublishableKey.startsWith("sb_publishable_")
  )
    throw Error("Supply the staging Supabase public publishable key.");
  const portal = new URL(config.portalUrl);
  if (
    portal.protocol !== "https:" ||
    portal.pathname !== "/" ||
    portal.search ||
    portal.hash ||
    portal.username ||
    portal.password
  )
    throw Error("Supply the staging portal HTTPS origin.");
  return { ...config, portalUrl: portal.origin };
}
export async function prepareBackend(outDir, publicConfig = null) {
  const output = path.resolve(outDir);
  // An output is a new artifact, never a mutation of the checkout or existing deployment.
  if (output === root || output.startsWith(root + path.sep))
    throw Error(
      "Write the staging package outside the application source directory.",
    );
  try {
    await fs.access(output);
    throw Error("Output directory already exists. Choose a new directory.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const staging = publicConfig
    ? validateStagingPublicConfig(publicConfig)
    : null;
  const mappings = [];
  const add = (source, target, replace = []) =>
    mappings.push({ source, target, replace });
  for (const name of [
    "index.ts",
    "service.mjs",
    "workbook.ts",
    "auth-adapter.mjs",
    "http.mjs",
    "config.mjs",
  ]) {
    add(
      "supabase/functions/usc-management/" + name,
      "supabase/functions/usc-management/" + name,
      [
        ["../../../shared/", "./_app/shared/"],
        ["../../../usc-admin/", "./_app/usc-admin/"],
      ],
    );
  }
  add(
    "supabase/functions/_shared/usc-email-common.ts",
    "supabase/functions/_shared/usc-email-common.ts",
  );
  for (const name of [
    "needs-assessment-model.mjs",
    "student-import-model.mjs",
    "officer-permissions.js",
  ])
    add(
      "shared/" + name,
      "supabase/functions/usc-management/_app/shared/" + name,
    );
  add(
    "usc-admin/student-registration/js/ssu-programs.js",
    "supabase/functions/usc-management/_app/usc-admin/student-registration/js/ssu-programs.js",
  );
  const manifest = [];
  for (const item of mappings) {
    let source = await fs.readFile(path.join(root, item.source), "utf8");
    for (const [from, to] of item.replace) source = source.replaceAll(from, to);
    const target = path.join(output, item.target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
    manifest.push({
      source: item.source,
      target: item.target,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  }
  await fs.writeFile(
    path.join(output, "supabase/config.toml"),
    "[functions.usc-management]\nverify_jwt = false\n",
  );
  await fs.writeFile(
    path.join(output, "deno.json"),
    JSON.stringify({ nodeModulesDir: "auto", lock: false }, null, 2) + "\n",
  );
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        service: "usc-management",
        projectName: "ssu-usc-email-staging",
        projectRef: staging?.supabaseProjectRef || null,
        files: manifest,
      },
      null,
      2,
    ) + "\n",
  );
  await fs.copyFile(
    path.join(root, "docs/management-backend.md"),
    path.join(output, "README.md"),
  );
  await fs.copyFile(
    path.join(root, "supabase/functions/usc-management/.env.example"),
    path.join(output, ".env.example"),
  );
  await fs.copyFile(
    path.join(root, "config/management-staging.public.example.json"),
    path.join(output, "staging-public.example.json"),
  );
  if (staging) {
    const origin = "https://" + staging.supabaseProjectRef + ".supabase.co";
    const original = await fs.readFile(
      path.join(root, "shared/app-config.js"),
      "utf8",
    );
    // Append after existing defaults so the staging values cannot be reset to empty.
    const overrides =
      "\n// Generated public staging configuration — no server secrets.\n" +
      [
        ["USC_FIREBASE_CONFIG", staging.firebase],
        [
          "USC_MANAGEMENT_FUNCTION_URL",
          origin + "/functions/v1/usc-management",
        ],
        ["USC_SUPABASE_EMAIL_FUNCTION_URL", origin + "/functions/v1/usc-email"],
        ["USC_FACEBOOK_FUNCTION_URL", origin + "/functions/v1/usc-facebook"],
      ]
        .map(
          ([key, value]) =>
            "globalThis." + key + " = " + JSON.stringify(value) + ";",
        )
        .join("\n") +
      "\n";
    const target = path.join(output, "frontend/shared");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(
      path.join(target, "app-config.js"),
      original + overrides,
    );
    const media = await fs.readFile(
      path.join(root, "supabase/supabase-config.js"),
      "utf8",
    );
    await fs.mkdir(path.join(output, "frontend/supabase"), { recursive: true });
    await fs.writeFile(
      path.join(output, "frontend/supabase/supabase-config.js"),
      media
        .replace(
          /export const SUPABASE_URL = .*;/,
          "export const SUPABASE_URL = " + JSON.stringify(origin) + ";",
        )
        .replace(
          /export const SUPABASE_ANON_KEY = .*;/,
          "export const SUPABASE_ANON_KEY = " +
            JSON.stringify(staging.supabasePublishableKey) +
            ";",
        ),
    );
  }
  return {
    output,
    service: "usc-management",
    files: manifest.length,
    frontendConfigured: !!staging,
    projectName: "ssu-usc-email-staging",
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--check-env")) {
      const values = Object.fromEntries(Object.entries(process.env));
      const config = validateManagementConfig(values);
      console.log(
        JSON.stringify({
          configured: true,
          projectId: config.projectId,
          projectRef: config.projectRef,
          portalOrigin: config.portalOrigin,
        }),
      );
    } else {
      const index = args.indexOf("--out");
      if (index < 0 || !args[index + 1])
        throw Error(
          "Usage: node scripts/prepare-management-backend.mjs --out /tmp/new-backend-package [--public-config /private/path/staging-public.json]",
        );
      const configIndex = args.indexOf("--public-config");
      const config =
        configIndex >= 0
          ? JSON.parse(await fs.readFile(args[configIndex + 1], "utf8"))
          : null;
      console.log(
        JSON.stringify(await prepareBackend(args[index + 1], config)),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
