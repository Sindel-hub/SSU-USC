import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  prepareBackend,
  validateStagingPublicConfig,
} from "../scripts/prepare-management-backend.mjs";
const config = () => ({
  projectName: "ssu-usc-email-staging",
  supabaseProjectRef: "abcdefghijklmnopqrst",
  supabasePublishableKey: "sb_publishable_test_staging",
  portalUrl: "https://staging.example",
  firebase: {
    apiKey: "public-api-key",
    authDomain: "staging.example",
    projectId: "isolated-ssu-staging",
    appId: "public-app-id",
  },
});
test("backend package contains its complete local import closure inside the functions directory", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ssu-backend-"));
  const output = path.join(temp, "package");
  try {
    const result = await prepareBackend(output);
    assert.equal(result.frontendConfigured, false);
    const manifest = JSON.parse(
      await fs.readFile(path.join(output, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.projectName, "ssu-usc-email-staging");
    for (const item of manifest.files) {
      const file = path.join(output, item.target),
        source = await fs.readFile(file, "utf8");
      for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
        const dependency = path.resolve(path.dirname(file), match[1]);
        assert.ok(
          dependency.startsWith(
            path.join(output, "supabase/functions") + path.sep,
          ),
          dependency,
        );
        await fs.access(dependency);
      }
    }
    await assert.rejects(prepareBackend(output), /already exists/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test("public staging configuration rejects production references and server secrets", () => {
  assert.equal(
    validateStagingPublicConfig(config()).projectName,
    "ssu-usc-email-staging",
  );
  assert.throws(
    () =>
      validateStagingPublicConfig({
        ...config(),
        supabaseProjectRef: "svgfxatigtjdrwzibjbu",
      }),
    /actual isolated/,
  );
  assert.throws(
    () =>
      validateStagingPublicConfig({
        ...config(),
        firebase: { ...config().firebase, private_key: "do-not-write" },
      }),
    /credentials/,
  );
  assert.throws(
    () =>
      validateStagingPublicConfig({
        ...config(),
        service_role_key: "do-not-write",
      }),
    /Only public/,
  );
});
test("generated frontend configuration selects staging after current defaults and contains no server credentials", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ssu-staging-"));
  try {
    const output = path.join(temp, "package");
    await prepareBackend(output, config());
    const text = await fs.readFile(
      path.join(output, "frontend/shared/app-config.js"),
      "utf8",
    );
    const context = {};
    vm.runInNewContext(text, context);
    assert.equal(
      context.USC_MANAGEMENT_FUNCTION_URL,
      "https://abcdefghijklmnopqrst.supabase.co/functions/v1/usc-management",
    );
    assert.equal(context.USC_FIREBASE_CONFIG.projectId, "isolated-ssu-staging");
    assert.ok(!text.includes("BEGIN PRIVATE KEY"));
    const media = await fs.readFile(
      path.join(output, "frontend/supabase/supabase-config.js"),
      "utf8",
    );
    assert.ok(!media.includes("svgfxatigtjdrwzibjbu"));
    assert.ok(media.includes("sb_publishable_test_staging"));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
