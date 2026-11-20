import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs
  .readFileSync(
    new URL("../firebase/firebase-config.js", import.meta.url),
    "utf8",
  )
  .replace(/^import .*;\n/gm, "")
  .replace("export const firebaseConfig", "const firebaseConfig")
  .replace(/^export \{.*\};$/gm, "");
function initialize(override) {
  const selected = [];
  const context = {
    USC_FIREBASE_CONFIG: override,
    location: { hostname: "localhost" },
    initializeApp: (config) => {
      selected.push(config);
      return {};
    },
    getFirestore: () => ({}),
    getAuth: () => ({}),
    getFunctions: () => ({}),
  };
  vm.runInNewContext(source, context);
  return selected;
}
test("Firebase keeps existing default values when no staging override is supplied", () => {
  assert.equal(initialize()[0].projectId, "universitystudentcouncil-856cc");
});
test("explicit staging Firebase config selects the isolated project", () => {
  const override = {
    apiKey: "staging-public-api-key",
    authDomain: "staging.example",
    projectId: "isolated-ssu-staging",
    appId: "staging-app",
  };
  assert.equal(initialize(override)[0], override);
});
test("an invalid staging config fails before Firebase can initialize the production project", () => {
  assert.throws(
    () => initialize({ projectId: "" }),
    /Invalid staging Firebase configuration/,
  );
});
