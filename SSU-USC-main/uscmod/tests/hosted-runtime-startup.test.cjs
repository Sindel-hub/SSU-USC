'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('actual hosted runtime initializes when CommonJS cannot require ESM', () => {
  const script = `
    const { generateKeyPairSync } = require('node:crypto');
    const privateKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey;
    Object.assign(process.env, {
      USC_ENVIRONMENT: 'staging', USC_FIREBASE_PROJECT_ID: 'ssu-usc-email-staging',
      USC_FIREBASE_WEB_CONFIG_JSON: JSON.stringify({projectId:'ssu-usc-email-staging',apiKey:'synthetic',authDomain:'ssu-usc-email-staging.firebaseapp.com'}),
      USC_FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({type:'service_account',project_id:'ssu-usc-email-staging',client_email:'synthetic@ssu-usc-email-staging.iam.gserviceaccount.com',private_key:privateKey}),
      USC_PUBLIC_ORIGIN: 'https://example.vercel.app', VERCEL_URL: 'example.vercel.app',
      VERCEL_ENV: 'preview', VERCEL: '1', USC_ENFORCE_APP_CHECK: 'false'
    });
    for (const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FUNCTIONS_EMULATOR']) delete process.env[name];
    const runtime = require('./server/runtime.cjs').getRuntime();
    if (typeof runtime.handlers.needsAssessmentList !== 'function') throw Error('Survey handler missing');
    console.log('Synthetic startup passed');
  `;
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', script], {
    cwd: path.join(__dirname, '..'), env: {...process.env, NODE_OPTIONS: ''}, encoding: 'utf8', timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Synthetic startup passed/);
});
