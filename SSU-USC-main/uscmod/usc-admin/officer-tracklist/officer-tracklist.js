import { hostedManagementCall } from '../../shared/hosted-management-client.js';

const host = document.querySelector('[data-officer-activity]');
if (host && await globalThis.USC_AUTH_READY === true) initialize(host);

function initialize(host) {
  host.innerHTML = `
    <div class="track-overview-cards">
      <article class="mini-overview-card total"><span class="overview-icon" aria-hidden="true"><i class="fa-regular fa-rectangle-list"></i></span><div class="overview-copy"><small>Total recorded activities</small><strong data-total>—</strong></div></article>
      <article class="mini-overview-card active"><span class="overview-icon" aria-hidden="true"><i class="fa-regular fa-clock"></i></span><div class="overview-copy"><small>Activities this month</small><strong data-month>—</strong></div></article>
    </div>
    <div class="track-dashboard-grid">
      <section class="track-card">
        <header class="track-card-head"><div class="track-card-heading"><span class="track-card-icon blue" aria-hidden="true"><i class="fa-solid fa-layer-group"></i></span><h2>Activities by module</h2></div></header>
        <dl class="track-card-content activity-modules"></dl>
      </section>
      <section class="track-card">
        <header class="track-card-head"><div class="track-card-heading"><span class="track-card-icon blue" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></span><h2>Recent activities</h2></div></header>
        <div class="track-card-content">
          <form class="activity-filters">
            <label>Search<input name="search" type="search" maxlength="160"></label>
            <label hidden>Officer<select name="officer"><option value="">All officers</option></select></label>
            <label>Module<select name="module"><option value="">All modules</option></select></label>
            <label>Academic year or term<select name="year"><option value="">All terms</option></select></label>
            <label>From<input type="date" name="from"></label>
            <label>To<input type="date" name="to"></label>
            <button class="track-card-link" type="submit">Apply filters</button>
          </form>
          <p class="activity-status" role="status"></p>
          <ol class="activity-list"></ol>
          <button class="track-card-link" type="button" data-more hidden>Load more</button>
        </div>
      </section>
    </div>`;

  const $ = selector => host.querySelector(selector);
  const form = $('form'), list = $('.activity-list'), status = $('.activity-status'), more = $('[data-more]');
  const query = new URLSearchParams(location.search);
  const record = query.get('record');
  const recordScope = record ? { recordId: record, recordModule: query.get('module') } : {};
  const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
  let activeFilters = {}, cursor = null, requestNumber = 0;

  function setOptions(name, options) {
    const select = form.elements.namedItem(name), selected = select.value;
    select.replaceChildren(select.options[0], ...options.map(([value, label]) => new Option(label, value)));
    select.value = options.some(([value]) => value === selected) ? selected : '';
  }

  function renderSummary({ summary, officers, years }) {
    $('[data-total]').textContent = summary.total;
    $('[data-month]').textContent = summary.month;
    const modules = new Map();
    for (const [module, count] of Object.entries(summary.modules)) {
      const label = moduleLabel(module);
      modules.set(label, (modules.get(label) || 0) + count);
    }
    $('.activity-modules').replaceChildren(...Array.from(modules, ([name, count]) => {
      const row = element('div');
      row.append(element('dt', name), element('dd', count));
      return row;
    }));
    setOptions('officer', officers.map(({ value, label }) => [value, label]));
    form.elements.officer.parentElement.hidden = !officers.length;
    setOptions('module', [...modules.keys()].map(label => [label, label]));
    setOptions('year', years.map(year => [year, year]));
  }

  async function load(append = false) {
    const number = ++requestNumber;
    if (!append) list.replaceChildren();
    more.hidden = true;
    status.textContent = 'Loading activities…';
    try {
      const result = await hostedManagementCall('officerActivityList', {
        ...recordScope, ...activeFilters, ...(append ? { after: cursor } : {})
      });
      if (number !== requestNumber) return;
      renderSummary(result);
      for (const row of result.items) {
        const item = element('li');
        item.append(
          element('strong', `${actionLabel(row.action)} · ${row.recordTitle || row.recordId}`),
          element('span', [moduleLabel(row.module), row.officerName || row.officerUid, row.position, row.administration || 'Term unrecorded'].filter(Boolean).join(' · ')),
          element('small', [date.format(row.createdAtMs), row.status].filter(Boolean).join(' · '))
        );
        list.append(item);
      }
      cursor = result.next;
      more.hidden = !cursor;
      status.textContent = list.children.length ? '' : 'No activities found.';
    } catch (error) {
      if (number !== requestNumber) return;
      more.hidden = !append;
      status.textContent = error.message;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    activeFilters = Object.fromEntries(new FormData(form));
    void load();
  });
  more.addEventListener('click', () => void load(true));
  void load();
}

function actionLabel(action) {
  return { archive: 'Archived', delete: 'Removed', 'permanent-delete': 'Permanently removed', restore: 'Restored' }[action] || action;
}

function moduleLabel(module) {
  return { Events: 'Events & Programs', Programs: 'Events & Programs', Complaints: 'Complaint Management', 'Bulletin Board': 'Bulletin Board Center' }[module] || module;
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
