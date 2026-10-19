import { classifyEngagement, STATUS_DEFINITIONS } from '../../../shared/engagement-report-model.mjs';

export function statusBreakdown(records, now = Date.now()) {
  const counts = Object.fromEntries(STATUS_DEFINITIONS.map(status => [status.name, 0]));
  records.forEach(record => { counts[classifyEngagement(record, now)] += 1; });
  return Object.entries(counts);
}

export function pieGradient(rows) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return '#e8f0f4';
  let cursor = 0;
  return `conic-gradient(${rows.filter(row => row.value > 0).map(row => {
    const start = cursor; cursor += row.value / total * 100;
    return `${row.color} ${start}% ${cursor}%`;
  }).join(',')})`;
}
const palette = ['#3478b7','#269471','#8879b9','#cb7182','#8c9eaf'];
export function renderOverviewChart(key, entries, { ready = false, error = false, extra = '' } = {}) {
  const root = document.querySelector(`[data-summary="${key}"]`);
  if (!root) return;
  const rows = entries.map(([label, value], i) => ({ label, value: Math.max(0, Number(value) || 0), color: palette[i % palette.length] }));
  const pie = root.querySelector('.overview-pie');
  const status = root.querySelector('.overview-chart-state');
  const legend = root.querySelector('.overview-chart-legend');
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  pie.style.background = ready && !error ? pieGradient(rows) : '#e8f0f4';
  pie.classList.toggle('empty', !ready || error || !total);
  status.textContent = error ? 'Data unavailable' : !ready ? 'Loading…' : total ? '' : key === 'student' ? 'No sign-ins yet' : 'No records yet';
  legend.replaceChildren();
  if (ready && !error) rows.forEach(row => {
    if (!row.value) return;
    const item = document.createElement('span'), dot = document.createElement('i'), label = document.createElement('span'), count = document.createElement('strong');
    dot.style.background = row.color; dot.setAttribute('aria-hidden', 'true'); label.textContent = row.label; count.textContent = row.value.toLocaleString();
    item.append(dot,label,count); legend.append(item);
  });
  root.querySelector('.overview-chart-extra').textContent = ready && !error ? extra : '';
}
