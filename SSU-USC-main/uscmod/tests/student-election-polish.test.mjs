import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../dashboard/js/election.js', import.meta.url), 'utf8');
const browserSource = source.slice(source.indexOf('const app =')).split('await initialize();')[0];
function fixture() {
  const app = { innerHTML: '', scrollTo() {}, classList: { add() {}, remove() {} } };
  const button = { disabled: false };
  const message = { textContent: '' };
  let calls = 0;
  const nodes = { electionApp: app, submitCandidateApplication: button, candidateSubmitMessage: message };
  const scope = vm.createContext({
    document: { getElementById: id => nodes[id] || null },
    sessionStorage: { getItem: () => null },
    console: { error() {} },
    callSecure: async () => { calls++; throw Error('Unexpected network request'); },
    secureUpload: async () => { calls++; throw Error('Unexpected upload'); },
    requestAnimationFrame() {}
  });
  vm.runInContext(browserSource + `
    globalThis.ui = { candidateProgress, validateSupportingFiles, renderLanding, renderRegistration,
      candidateGalleryGroup, submitApplication,
      setState(value) {
        student = value.student || {fullName:'Test Student',college:'Engineering',candidacyApproved:true};
        context = value.context || {electionId:'fixture',registrationOpen:true,lifecycle:'Registration'};
        application = value.application || null;
        candidateDraft = value.draft || createCandidateDraft();
      }
    };`, scope);
  scope.ui.setState({});
  return { ui: scope.ui, app, button, message, calls: () => calls };
}

test('completion responds to fields and reserves the final segment for review', () => {
  const { ui } = fixture();
  const draft = { position: 'President', photoFile: {}, platform: 'Plans', statement: 'Service', supportingFiles: [{}] };
  assert.equal(ui.candidateProgress(1, {}), 0);
  assert.ok(ui.candidateProgress(2, { position: 'President' }) > ui.candidateProgress(2, {}));
  assert.equal(ui.candidateProgress(3, draft), 86);
  assert.equal(ui.candidateProgress(4, draft), 100);
  assert.ok(ui.candidateProgress(3, { ...draft, platform: '  ' }) < 86);
});

test('documents require at least one supported file and enforce existing size and count limits', () => {
  const { ui } = fixture();
  assert.match(ui.validateSupportingFiles([]), /at least one/);
  for (const name of ['enrollment.PDF', 'good-moral.jpg', 'certificate.jpeg', 'proof.png']) {
    assert.equal(ui.validateSupportingFiles([{ name, size: 5 * 1024 * 1024 }]), '');
  }
  assert.match(ui.validateSupportingFiles([{ name: 'proof.exe', size: 10 }]), /PDF, JPG or PNG/);
  assert.match(ui.validateSupportingFiles([{ name: 'proof.pdf', size: 5 * 1024 * 1024 + 1 }]), /larger than 5MB/);
  assert.match(ui.validateSupportingFiles(Array(9).fill({ name: 'proof.pdf', size: 10 })), /up to 8/);
});

test('submission without documents fails before a network request or upload', async () => {
  const f = fixture();
  await f.ui.submitApplication();
  assert.match(f.message.textContent, /supporting document/);
  assert.equal(f.calls(), 0);
  assert.equal(f.button.disabled, false);
});

test('closed, registration, and candidate phases share the front page and retain action gates', () => {
  const f = fixture();
  for (const context of [
    {electionId:'fixture', lifecycle:'Draft'},
    {electionId:'fixture', lifecycle:'Registration', registrationOpen:true},
    {electionId:'fixture', lifecycle:'Published', candidateVisible:true}
  ]) {
    f.ui.setState({ context }); f.ui.renderLanding();
    assert.match(f.app.innerHTML, /election-front-card/);
    assert.doesNotMatch(f.app.innerHTML, /<h2>USC Election<\/h2>/);
    if (context.registrationOpen) assert.match(f.app.innerHTML, /id="landingApplication"/);
    else assert.doesNotMatch(f.app.innerHTML, /id="landingApplication"/);
    if (context.candidateVisible) assert.match(f.app.innerHTML, /id="landingCandidates"/);
  }
  f.ui.setState({ student: { candidacyApproved:false } }); f.ui.renderLanding();
  assert.match(f.app.innerHTML, /id="landingApplication" disabled/);
});

test('position groups use independent sections and escape candidate-provided text', () => {
  const { ui } = fixture();
  const markup = ui.candidateGalleryGroup('President', [{ id:'one',fullName:'<script>Test</script>', platform:'<b>Plans</b>' }]);
  assert.match(markup, /id="candidate-position-0"/);
  assert.match(markup, /data-position="President"/);
  assert.match(markup, /&lt;script&gt;Test&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.equal(ui.candidateGalleryGroup('Treasurer', []), '');
});
