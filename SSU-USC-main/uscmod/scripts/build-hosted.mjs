import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readPublicSettings } = require('../server/settings.cjs');
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_FOLDERS = ['activate', 'assets', 'complaint', 'config', 'dashboard', 'data', 'email', 'firebase', 'home', 'index', 'shared', 'supabase', 'survey', 'usc-admin', 'vendor'];
function privateName(name) {
  return name.startsWith('.') || /\.(?:local-backup|cjs|log|pem|key|sql|toml|yaml|yml|sh|ps1|py)$/i.test(name) || /(?:secret|service[-_]account|credentials|private[-_]key)/i.test(name) || /^(?:seed-local|configure-local|local-activation-test)/.test(name);
}
async function copyPublic(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    if (privateName(item.name) || item.name === 'node_modules') continue;
    const from = path.join(source, item.name), to = path.join(destination, item.name);
    if (item.isSymbolicLink()) throw Error('Public build cannot contain symbolic links.');
    if (item.isDirectory()) await copyPublic(from, to);
    else if (item.isFile()) {
      if (/\.(?:js|mjs|html|json|txt|css|csv|svg)$/i.test(item.name) && /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(await fs.readFile(from, 'utf8'))) throw Error('Private key material was found in public input.');
      await fs.copyFile(from, to);
    }
  }
}
export async function buildHosted({ root = DEFAULT_ROOT, output = path.join(root, 'dist'), env = process.env } = {}) {
  const settings = readPublicSettings(env);
  if (path.resolve(output) === path.resolve(root) || !path.resolve(output).startsWith(path.resolve(root) + path.sep)) throw Error('Build output must be a separate directory inside the project root.');
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  for (const folder of PUBLIC_FOLDERS) {
    try { await fs.access(path.join(root, folder)); } catch { continue; }
    if (folder === 'supabase') {
      await fs.mkdir(path.join(output, folder), { recursive: true });
      await fs.copyFile(path.join(root, folder, 'supabase-config.js'), path.join(output, folder, 'supabase-config.js'));
    } else {
      await copyPublic(path.join(root, folder), path.join(output, folder));
    }
  }
  const firebaseFile = path.join(output, 'firebase/firebase-config.js');
  let firebase = await fs.readFile(firebaseFile, 'utf8');
  const configPattern = /export const firebaseConfig = \{[\s\S]*?\n\};/;
  if (!configPattern.test(firebase)) throw Error('Firebase web configuration template was not found.');
  firebase = firebase.replace(configPattern, `export const firebaseConfig = ${JSON.stringify(settings.webConfig, null, 2)};`);
  await fs.writeFile(firebaseFile, firebase);
  const appFile = path.join(output, 'shared/app-config.js');
  let appConfig = await fs.readFile(appFile, 'utf8');
  appConfig = appConfig.replace(/globalThis\.USC_APP_CHECK_SITE_KEY = [^;]*;/, `globalThis.USC_APP_CHECK_SITE_KEY = ${JSON.stringify(settings.appCheckSiteKey)};`);
  appConfig += `\nglobalThis.USC_ENVIRONMENT = ${JSON.stringify(settings.environment)};\n`;
  if (settings.environment === 'production') {
    appConfig += `globalThis.USC_PUBLIC_ORIGIN = ${JSON.stringify(settings.publicOrigin)};\n`;
  }
  if (settings.environment === 'staging') {
    // Existing Supabase-backed features are deliberately unavailable in staging
    // rather than pointing an isolated preview at production records/services.
    await fs.writeFile(path.join(output, 'supabase/supabase-config.js'), `export const SUPABASE_URL = "https://example.invalid";\nexport const SUPABASE_ANON_KEY = "staging-disabled";\nexport const SUPABASE_PUBLIC_BUCKET = "usc-public-media";\nexport const SUPABASE_PRIVATE_BUCKET = "usc-private-documents";\nexport const SUPABASE_BUCKET = SUPABASE_PUBLIC_BUCKET;\nexport const supabase = new Proxy({}, { get() { throw new Error("Supabase is disabled in isolated staging."); } });\n`);
    appConfig += `\nconst stagingFetch = globalThis.fetch.bind(globalThis);\nglobalThis.fetch = (input, options) => {\n  const url = new URL(input instanceof Request ? input.url : String(input), location.href);\n  if (url.hostname.endsWith('.supabase.co')) return Promise.reject(new Error('Production Supabase is blocked in isolated staging.'));\n  return stagingFetch(input, options);\n};\n`;
  }
  await fs.writeFile(appFile, appConfig);
  return { environment: settings.environment, projectId: settings.projectId, output };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildHosted().then(result => console.log(`Public build prepared for ${result.environment} (${result.projectId}).`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
