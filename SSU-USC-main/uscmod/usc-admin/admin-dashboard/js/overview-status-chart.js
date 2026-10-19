// Presentation only: mirror the existing Overview metrics without fetching data
// or changing their calculations, subscriptions, or account-management behavior.
const chart = document.getElementById('overviewStatusChart');
if (chart) {
  const labels = { approved: 'Approved', pending: 'Pending', suspended: 'Suspended' };
  const sources = { approved: 'statApproved', pending: 'statPending', suspended: 'statSuspended' };
  const detail = document.getElementById('statusChartDetail');
  const count = id => Math.max(0, Number(document.getElementById(id)?.textContent) || 0);
  const accountLabel = value => `${value} ${value === 1 ? 'account' : 'accounts'}`;
  const buttons = [...chart.querySelectorAll('[data-status-key]')];
  let active = '';

  function describe(status) {
    active = status;
    chart.dataset.activeStatus = status;
    detail.textContent = status
      ? `${labels[status]} · ${accountLabel(count(sources[status]))}`
      : count('statTotal') ? 'Explore a status to see its account count.' : 'No account data yet.';
  }

  function render() {
    const total = count('statTotal');
    document.getElementById('statusChartTotal').textContent = String(total);
    let offset = 0;
    const descriptions = [];
    for (const [status, id] of Object.entries(sources)) {
      const value = count(id);
      // Fractions affect drawing only; displayed counts always match existing metrics.
      const share = total ? Math.min(value / total * 100, 100 - offset) : 0;
      const segment = chart.querySelector(`[data-status-segment="${status}"]`);
      segment.setAttribute('stroke-dasharray', `${share} ${100 - share}`);
      segment.setAttribute('stroke-dashoffset', String(-offset));
      offset += share;
      chart.querySelector(`[data-status-count="${status}"]`).textContent = String(value);
      chart.querySelector(`[data-status-key="${status}"]`).setAttribute('aria-label', `${labels[status]}: ${accountLabel(value)}`);
      descriptions.push(`${labels[status]}: ${value}`);
    }
    const other = Math.max(0, total - Object.values(sources).reduce((sum, id) => sum + count(id), 0));
    document.getElementById('statusChartOther').hidden = !other;
    document.getElementById('statusChartOtherCount').textContent = String(other);
    if (other) descriptions.push(`Other statuses: ${other}`);
    document.getElementById('statusChartDescription').textContent = `${accountLabel(total)}. ${descriptions.join('. ')}.`;
    describe(active);
  }

  for (const button of buttons) {
    const status = button.dataset.statusKey;
    button.addEventListener('pointerenter', () => describe(status));
    button.addEventListener('focus', () => describe(status));
    button.addEventListener('click', () => describe(status));
  }
  chart.addEventListener('pointerleave', () => {
    const focused = buttons.find(button => button === document.activeElement);
    describe(focused?.dataset.statusKey || '');
  });
  chart.addEventListener('focusout', event => {
    if (!chart.contains(event.relatedTarget)) describe('');
  });
  const observer = new MutationObserver(render);
  for (const id of ['statTotal', ...Object.values(sources)]) {
    const source = document.getElementById(id);
    if (source) observer.observe(source, { childList: true, characterData: true, subtree: true });
  }
  render();
}
