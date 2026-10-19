import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../usc-admin/admin-dashboard/js/overview-status-chart.js', import.meta.url), 'utf8');
function dashboard(values) {
  const nodes = new Map();
  const element = key => {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', dataset: {}, attributes: {}, handlers: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, callback) { this.handlers[name] = callback; } });
    return nodes.get(key);
  };
  const statuses = ['approved', 'pending', 'suspended'];
  const buttons = statuses.map(status => {
    const node = element(`[data-status-key="${status}"]`); node.dataset.statusKey = status; return node;
  });
  const chart = element('overviewStatusChart');
  chart.querySelector = element;
  chart.querySelectorAll = () => buttons;
  chart.contains = node => buttons.includes(node);
  const document = { getElementById: element, activeElement: null };
  let refresh;
  function update(next) { for (const [id, value] of Object.entries(next)) element(id).textContent = String(value); refresh?.(); }
  update(values);
  vm.runInNewContext(source, { document, MutationObserver: class { constructor(callback) { refresh = callback; } observe() {} } });
  return { element, chart, buttons, update, document };
}

test('status chart mirrors existing metrics and preserves unclassified accounts', () => {
  const page = dashboard({ statTotal: 10, statApproved: 5, statPending: 2, statSuspended: 1 });
  assert.equal(page.element('statusChartTotal').textContent, '10');
  assert.equal(page.element('[data-status-count="approved"]').textContent, '5');
  assert.equal(page.element('[data-status-segment="approved"]').attributes['stroke-dasharray'], '50 50');
  assert.equal(page.element('[data-status-segment="pending"]').attributes['stroke-dashoffset'], '-50');
  assert.equal(page.element('[data-status-segment="suspended"]').attributes['stroke-dashoffset'], '-70');
  assert.equal(page.element('statusChartOther').hidden, false);
  assert.equal(page.element('statusChartOtherCount').textContent, '2');
  assert.match(page.element('statusChartDescription').textContent, /Other statuses: 2/);
  assert.equal(page.element('statTotal').textContent, '10', 'presentation must not change the source metric');
});

test('live updates and empty accounts never produce invalid chart segments', () => {
  const page = dashboard({ statTotal: 1, statApproved: 1, statPending: 0, statSuspended: 0 });
  page.update({ statTotal: 0, statApproved: 0 });
  assert.equal(page.element('statusChartTotal').textContent, '0');
  for (const status of ['approved', 'pending', 'suspended']) {
    assert.equal(page.element(`[data-status-segment="${status}"]`).attributes['stroke-dasharray'], '0 100');
  }
  assert.equal(page.element('statusChartDetail').textContent, 'No account data yet.');
  assert.equal(page.element('statusChartOther').hidden, true);
  page.update({ statTotal: 20, statApproved: 15, statPending: 5 });
  assert.equal(page.element('[data-status-segment="approved"]').attributes['stroke-dasharray'], '75 25');
});

test('keyboard, pointer, and click exploration announce the current count and reset on exit', () => {
  const page = dashboard({ statTotal: 3, statApproved: 2, statPending: 1, statSuspended: 0 });
  const pending = page.buttons[1];
  for (const event of ['focus', 'pointerenter', 'click']) {
    pending.handlers[event]();
    assert.equal(page.chart.dataset.activeStatus, 'pending');
    assert.equal(page.element('statusChartDetail').textContent, 'Pending · 1 account');
  }
  page.update({ statTotal: 4, statPending: 2 });
  assert.equal(page.element('statusChartDetail').textContent, 'Pending · 2 accounts');
  assert.equal(pending.attributes['aria-label'], 'Pending: 2 accounts');
  page.document.activeElement = pending;
  page.chart.handlers.pointerleave();
  assert.equal(page.chart.dataset.activeStatus, 'pending', 'hover exit must retain keyboard exploration');
  page.chart.handlers.focusout({ relatedTarget: null });
  assert.equal(page.chart.dataset.activeStatus, '');
});
