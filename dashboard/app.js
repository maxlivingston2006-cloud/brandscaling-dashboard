/* ════════════════════════════════════════════════════════════════════════
   Command Center — front-end controller
   Hash router · 5 agent views · kanban DnD · Chart.js analytics
   ════════════════════════════════════════════════════════════════════════ */

const STATUSES = ['new', 'contacted', 'followed_up', 'replied', 'converted'];
const STATUS_LABELS = { new: 'New', contacted: 'Contacted', followed_up: 'Followed Up', replied: 'Replied', converted: 'Converted' };
const OPP_LABELS = { NO_WEBSITE: 'No Website', WEAK_ADVERTISING: 'Weak Ads', HIGH_POTENTIAL: 'High Potential', SCALING_CANDIDATE: 'Scaling' };

// Status badge for a lead. Shows "Queued" while an email is waiting in the send
// queue so you can tell at a glance what's already lined up and not send twice.
function statusBadge(lead) {
  if (lead.queued) {
    return `<span class="badge badge-queued" title="An email is queued to send — no need to send again">⏱ Queued</span>`;
  }
  return `<span class="badge badge-${lead.status}">${STATUS_LABELS[lead.status] || lead.status}</span>`;
}

const VIEWS = {
  overview:  { title: 'Overview',       sub: 'Your command center at a glance' },
  scraper:   { title: 'Lead Scraper',   sub: 'Find and qualify new leads from Google Places' },
  outreach:  { title: 'Outreach Agent', sub: 'Compose, send and track your emails' },
  pipeline:  { title: 'Pipeline CRM',   sub: 'Drag leads through your sales stages' },
  clients:   { title: 'Clients',        sub: 'Active retainers and client accounts' },
  finance:   { title: 'Finance',        sub: 'Invoices, cash flow and revenue goals' },
  analytics: { title: 'Analytics',      sub: 'Performance across your pipeline' },
  settings:  { title: 'Settings',       sub: 'Workspace configuration' },
};

const ICONS = {
  scraper:  '<svg viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Z"/></svg>',
  outreach: '<svg viewBox="0 0 24 24"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m3 7 9 6 9-6"/></svg>',
  pipeline: '<svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z"/></svg>',
  clients:  '<svg viewBox="0 0 24 24"><path d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  analytics:'<svg viewBox="0 0 24 24"><path d="M5 3v16h16"/><path d="m7 14 3-4 3 3 4-6"/></svg>',
};

/* ─── State ──────────────────────────────────────────────────────────── */
const state = {
  leads:     [],
  sessions:  [],
  analytics: null,
  settings:  {},
  clients:   [],
  today:     null,
  activity:  [],
  invoices:  [],
  transactions: [],
  finance:   null,
  finCharts: null,
  aiConfigured: false,
  digest:    null,
  search:    '',
  outreachFilter: '',
  txFilter:  '',
  view:      'overview',
  clientId:  null,
  loaded:    false,
  expandedLeads: new Set(), // scraper rows expanded to show owner/notes/actions
};
let modalLeadId = null;
let modalAction = null;
let confirmFn   = null;
const charts = {};

/* ─── DOM refs ───────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const content      = $('content');
const toast        = $('toast');
const connStatus   = $('conn-status');
const sidebar      = $('sidebar');
const globalSearch = $('global-search');

/* Boot runs at the BOTTOM of this file — after every const/ref is initialized,
   so wireStaticEvents() doesn't touch modal refs while they're still in the TDZ. */

/* ─── Data ───────────────────────────────────────────────────────────── */
async function loadAll() {
  try {
    const [leads, sessions, analytics, settings, clients, today, activity, invoices, transactions, finance, finCharts] = await Promise.all([
      api('GET', '/api/leads'),
      api('GET', '/api/sessions'),
      api('GET', '/api/analytics'),
      api('GET', '/api/settings'),
      api('GET', '/api/clients'),
      api('GET', '/api/today'),
      api('GET', '/api/activity'),
      api('GET', '/api/invoices'),
      api('GET', '/api/transactions'),
      api('GET', '/api/finance/summary'),
      api('GET', '/api/finance/charts'),
    ]);
    const aiStatus = await api('GET', '/api/ai/status').catch(() => ({ configured: false }));
    state.aiConfigured = !!aiStatus.configured;
    state.leads = leads;
    state.sessions = sessions;
    state.analytics = analytics;
    state.settings = settings;
    state.clients = clients;
    state.today = today;
    state.activity = activity;
    state.invoices = invoices;
    state.transactions = transactions;
    state.finance = finance;
    state.finCharts = finCharts;
    state.loaded = true;
    setConn(true);
    renderCurrentView();
    renderAgentDots();
    renderBell();
    hydrateSettingsForm();
  } catch (err) {
    setConn(false);
    showToast('Failed to load data: ' + err.message, 'error');
  }
}

async function refresh() {
  try {
    const [leads, sessions, analytics, clients, today, activity, invoices, transactions, finance, finCharts] = await Promise.all([
      api('GET', '/api/leads'),
      api('GET', '/api/sessions'),
      api('GET', '/api/analytics'),
      api('GET', '/api/clients'),
      api('GET', '/api/today'),
      api('GET', '/api/activity'),
      api('GET', '/api/invoices'),
      api('GET', '/api/transactions'),
      api('GET', '/api/finance/summary'),
      api('GET', '/api/finance/charts'),
    ]);
    state.leads = leads;
    state.sessions = sessions;
    state.analytics = analytics;
    state.clients = clients;
    state.today = today;
    state.activity = activity;
    state.invoices = invoices;
    state.transactions = transactions;
    state.finance = finance;
    state.finCharts = finCharts;
    setConn(true);
    renderCurrentView();
    renderBell();
  } catch (err) {
    showToast('Refresh failed: ' + err.message, 'error');
  }
}

// Light refresh for the Overview side panels (tasks / activity only)
async function refreshToday() {
  try {
    const [today, activity] = await Promise.all([
      api('GET', '/api/today'),
      api('GET', '/api/activity'),
    ]);
    state.today = today;
    state.activity = activity;
    renderBell();
    if (state.view === 'overview') { renderToday(); renderActivityFeed(); }
  } catch (err) {
    console.error('refreshToday failed:', err.message);
  }
}

/* ─── Router ─────────────────────────────────────────────────────────── */
function route() {
  const hash = (location.hash || '#overview').slice(1);
  const [viewPart, param] = hash.split('/');
  const view = VIEWS[viewPart] ? viewPart : 'overview';
  state.view = view;
  state.clientId = (view === 'clients' && param) ? param : null;
  localStorage.setItem('bs_view', view);

  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));

  $('page-title').textContent    = VIEWS[view].title;
  $('page-subtitle').textContent = VIEWS[view].sub;

  sidebar.classList.remove('open');
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.loaded) return;
  switch (state.view) {
    case 'overview':  renderOverview();  break;
    case 'scraper':   renderSessions();  break;
    case 'outreach':  renderOutreach();  break;
    case 'pipeline':  renderKanban();    break;
    case 'clients':   renderClients();   break;
    case 'finance':   renderFinance();   break;
    case 'analytics': renderAnalytics(); break;
    case 'settings':  hydrateSettingsForm(); updatePersistenceState(); break;
  }
}

/* ─── Overview ───────────────────────────────────────────────────────── */
function renderOverview() {
  const a = state.analytics || { by_status: {}, total: 0, rates: {} };
  const s = a.by_status || {};
  const kpis = [
    { label: 'Total Leads', value: a.total || 0,         accent: 'var(--accent)', foot: `avg rating ${state.analytics?.avg_rating ?? '—'}` },
    { label: 'New',         value: s.new || 0,           accent: 'var(--st-new)', foot: 'awaiting outreach', view: 'outreach' },
    { label: 'Contacted',   value: s.contacted || 0,     accent: 'var(--st-contacted)', foot: 'in conversation', view: 'pipeline' },
    { label: 'Replied',     value: s.replied || 0,       accent: 'var(--st-replied)', foot: `${a.rates?.reply_rate ?? 0}% reply rate`, view: 'pipeline' },
    { label: 'Converted',   value: s.converted || 0,     accent: 'var(--st-converted)', foot: `${a.rates?.conversion_rate ?? 0}% conversion`, view: 'pipeline' },
  ];
  $('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.view ? 'clickable' : ''}" style="--kpi-accent:${k.accent}" ${k.view ? `data-goto="${k.view}"` : ''}>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-foot"><span class="kpi-chip">${k.foot}</span></div>
    </div>`).join('');

  const active = (s.new || 0) + (s.contacted || 0) + (s.followed_up || 0) + (s.replied || 0);
  const agents = [
    { view: 'scraper',  name: 'Lead Scraper',   desc: 'Discovers and auto-qualifies businesses from Google Places.', metric: `<b>${a.total || 0}</b> leads sourced` },
    { view: 'outreach', name: 'Outreach Agent',  desc: 'Sends personalized cold emails and follow-ups via Gmail.',     metric: `<b>${s.contacted || 0}</b> contacted` },
    { view: 'pipeline', name: 'Pipeline CRM',    desc: 'Tracks every lead across your sales stages on a kanban board.', metric: `<b>${active}</b> active deals` },
    { view: 'analytics',name: 'Analytics',       desc: 'Conversion funnel, reply rates and pipeline trends.',           metric: `<b>${a.rates?.conversion_rate ?? 0}%</b> conversion` },
  ];
  $('agents-grid').innerHTML = agents.map(ag => `
    <div class="agent-card" data-goto="${ag.view}">
      <div class="agent-card-top">
        <div class="agent-icon">${ICONS[ag.view]}</div>
        <span class="agent-status">Active</span>
      </div>
      <div class="agent-name">${ag.name}</div>
      <div class="agent-desc">${ag.desc}</div>
      <div class="agent-metric">${ag.metric}</div>
    </div>`).join('');

  const recent = state.leads.slice(0, 6);
  $('recent-leads').innerHTML = recent.length ? recent.map(l => `
    <div class="recent-row">
      <div class="recent-avatar">${esc((l.business_name || '?').charAt(0).toUpperCase())}</div>
      <div class="recent-main">
        <div class="recent-name">${esc(l.business_name)}</div>
        <div class="recent-sub">${esc(l.category || '—')} · ${esc(l.address || '')}</div>
      </div>
      <span class="badge badge-${l.status}">${STATUS_LABELS[l.status] || l.status}</span>
    </div>`).join('') : '<div class="empty-state">No leads yet. Run the Lead Scraper to get started.</div>';

  renderToday();
  renderActivityFeed();
  renderDigest();
}

/* ─── AI Insights (digest + ask) ─────────────────────────────────────── */
let digestLoading = false;

function renderDigest() {
  const el = $('digest-content');
  if (!el) return;

  if (!state.aiConfigured) {
    el.innerHTML = '<div class="empty-state">✦ Add your Claude API key in <a class="panel-link" href="#settings">Settings</a> to unlock AI insights, personalized outreach and lead briefs.</div>';
    $('digest-refresh').classList.add('hidden');
    $('ask-form').classList.add('hidden');
    return;
  }
  $('digest-refresh').classList.remove('hidden');
  $('ask-form').classList.remove('hidden');

  if (state.digest && state.digest.bullets) {
    el.innerHTML = `
      <ul class="digest-bullets">${state.digest.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <div class="digest-meta">Generated ${timeAgo(state.digest.generated_at)}</div>`;
    return;
  }

  if (!digestLoading) loadDigest(false);
  el.innerHTML = '<div class="digest-loading"><span class="spinning">⟳</span> Analyzing your pipeline and finances…</div>';
}

async function loadDigest(refresh) {
  digestLoading = true;
  try {
    state.digest = await api('GET', '/api/ai/digest' + (refresh ? '?refresh=true' : ''));
  } catch (err) {
    state.digest = null;
    const el = $('digest-content');
    if (el) el.innerHTML = `<div class="empty-state">Couldn’t generate insights: ${esc(err.message)}</div>`;
    digestLoading = false;
    return;
  }
  digestLoading = false;
  if (state.view === 'overview') renderDigest();
}

async function onAskSubmit(e) {
  e.preventDefault();
  const q = $('ask-input').value.trim();
  if (!q) return;
  const btn = $('ask-btn');
  const out = $('ask-answer');
  btn.disabled = true; btn.innerHTML = '<span class="spinning">⟳</span>';
  out.classList.remove('hidden');
  out.innerHTML = '<span class="spinning">⟳</span> Thinking…';
  try {
    const { answer } = await api('POST', '/api/ai/ask', { question: q });
    out.innerHTML = `<span class="ask-q">${esc(q)}</span>${esc(answer)}`;
  } catch (err) {
    out.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Ask';
  }
}

/* ─── AI lead brief modal ────────────────────────────────────────────── */
let briefLeadId = null;

function briefHtml(brief) {
  return `
    <p class="brief-summary">${esc(brief.summary)}</p>
    <div class="brief-cols">
      <div>
        <div class="brief-label brief-label--good">Strengths</div>
        <ul class="brief-list">${(brief.strengths || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
      <div>
        <div class="brief-label brief-label--bad">Gaps we can fix</div>
        <ul class="brief-list">${(brief.weaknesses || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="brief-pitch">
      <div class="brief-label">Lead with this</div>
      ${esc(brief.pitch_angle)}
    </div>
    ${brief.generated_at ? `<div class="digest-meta">Generated ${timeAgo(brief.generated_at)}${brief.cached ? ' · cached' : ''}</div>` : ''}`;
}

async function openBriefModal(id, refresh = false) {
  briefLeadId = id;
  const lead = findLead(id);
  $('brief-modal-title').textContent = `✦ ${lead ? lead.business_name : 'Lead brief'}`;
  $('brief-modal-body').innerHTML = '<div class="digest-loading"><span class="spinning">⟳</span> Researching this lead…</div>';
  $('brief-modal').classList.remove('hidden');
  try {
    const brief = await api('POST', `/api/ai/brief/${id}${refresh ? '?refresh=true' : ''}`);
    if (briefLeadId !== id) return; // user closed / switched
    $('brief-modal-body').innerHTML = briefHtml(brief);
  } catch (err) {
    $('brief-modal-body').innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

function closeBriefModal() {
  $('brief-modal').classList.add('hidden');
  briefLeadId = null;
}

/* ─── Lead Scraper view (sessions) ───────────────────────────────────── */
async function checkQueueStatus() {
  try {
    const stats = await api('GET', '/api/email-queue');
    if (stats.pending > 0) {
      setScrapeStatusHtml('loading',
        `⟳ Queue running: ${stats.pending} pending · ${stats.sent_24h ?? 0}/${state.settings.email_daily_cap || 40} sent today · ${stats.failed} failed — <button class="send-queue-btn" style="background:#555" onclick="cancelEmailQueue(this)">Cancel remaining</button>`
      );
      startQueueStatusPolling();
    } else if (stats.sent > 0 || stats.failed > 0) {
      setScrapeStatus('success', stats.failed > 0
        ? `✓ Queue done — ${stats.sent} sent, ${stats.failed} failed`
        : `✓ Queue done — all ${stats.sent} emails sent`);
    }
  } catch {}
}

function renderSessions() {
  const container = $('sessions-container');
  const visible = state.sessions
    .map(s => ({ ...s, leads: filterLeads(s.leads || []) }))
    .filter(s => (s.leads.length > 0) || !state.search);

  $('scrape-history-hint').textContent =
    `${state.sessions.length} session${state.sessions.length !== 1 ? 's' : ''}`;

  if (!visible.length) {
    container.innerHTML = '<div class="empty-sessions">No leads match your search. Run a scrape to add new leads.</div>';
    return;
  }
  container.innerHTML = visible.map((s, i) => buildSessionAccordion(s, i === 0)).join('');
}

function buildSessionAccordion(session, startOpen) {
  const date    = new Date(session.timestamp);
  const dateStr = isNaN(date) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = isNaN(date) ? '' : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const count   = session.leads.length;
  const body = count > 0 ? `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Business</th><th>Category</th><th class="col-center">Rating</th>
          <th class="col-center">Reviews</th><th class="col-center">Website</th>
          <th class="col-center">Opportunity</th><th class="col-center">Status</th>
          <th class="col-expand" aria-label="Expand"></th>
        </tr></thead>
        <tbody>${session.leads.map(buildScraperRow).join('')}</tbody>
      </table>
    </div>` : '<div class="empty-session-body">No leads match your search.</div>';

  return `
    <div class="session-accordion ${startOpen ? 'open' : ''}" data-session-id="${session.id ?? 'legacy'}">
      <button class="session-header" type="button">
        <div class="session-meta">
          <span class="session-query">${esc(session.query)}</span>
          <span class="session-dot">·</span><span class="session-location">${esc(session.location)}</span>
          <span class="session-dot">·</span><span class="session-date">${dateStr}${timeStr ? ' at ' + timeStr : ''}</span>
        </div>
        <div class="session-right">
          <span class="session-badge">${count} lead${count !== 1 ? 's' : ''}</span>
          <span class="session-chevron">▾</span>
        </div>
      </button>
      <div class="session-body"><div class="session-body-inner">${body}</div></div>
    </div>`;
}

function emailCellHtml(lead) {
  if (lead.email) {
    return `<input type="email" class="email-input" data-id="${lead.id}" value="${esc(lead.email)}" placeholder="Add email…" />`;
  }
  if (lead.email_searched) {
    return `<input type="email" class="email-input" data-id="${lead.id}" value="" placeholder="Add email…" /><span class="email-not-found" title="No email found on website or Facebook">✗ not found</span>`;
  }
  return `<input type="email" class="email-input" data-id="${lead.id}" value="" placeholder="Add email…" />`;
}

function buildScraperRow(lead) {
  const opp = lead.opportunity_type || null;
  const website = lead.website
    ? `<a class="website-yes" href="${esc(lead.website)}" target="_blank" rel="noopener">Yes ↗</a>`
    : `<span class="website-no">✕ None</span>`;
  const expanded = state.expandedLeads.has(String(lead.id));
  const outcome  = lead.call_outcome === 'good' || lead.call_outcome === 'bad' ? lead.call_outcome : '';
  const outcomeClass = outcome ? ` outcome-${outcome}` : '';

  const barRow = `
    <tr class="scraper-row${expanded ? ' expanded' : ''}${outcomeClass}" data-lead-row="${lead.id}">
      <td class="td-name">
        <div class="td-biz-name">
          ${scoreBadge(lead.score)}
          ${lead.website
            ? `<a href="${esc(lead.website)}" target="_blank" rel="noopener">${esc(lead.business_name)}</a>`
            : esc(lead.business_name)}
          ${engagementDot(lead)}
        </div>
        <div class="td-address" title="${esc(lead.address)}">${esc(lead.address)}</div>
        ${lead.phone ? `<div class="td-phone">☎ ${esc(lead.phone)}</div>` : ''}
      </td>
      <td>${esc(lead.category)}</td>
      <td class="col-center"><span class="rating-stars">${ratingStars(lead.google_rating)}</span><span class="rating-val">${lead.google_rating ?? '—'}</span></td>
      <td class="col-center">${lead.review_count ?? 0}</td>
      <td class="col-center">${website}</td>
      <td class="col-center">${oppBadge(opp)}</td>
      <td class="col-center">${statusBadge(lead)}</td>
      <td class="col-expand"><span class="row-chevron">▾</span></td>
    </tr>`;

  const detailRow = `
    <tr class="scraper-detail${expanded ? ' open' : ''}${outcomeClass}" data-detail-for="${lead.id}">
      <td colspan="8">
        <div class="lead-detail">
          <div class="lead-detail-fields">
            <label class="lead-field">
              <span class="lead-field-label">Owner name</span>
              <input type="text" class="owner-input" data-id="${lead.id}" value="${esc(lead.owner_name || '')}" placeholder="Add owner name…" />
            </label>
            <label class="lead-field">
              <span class="lead-field-label">Email</span>
              <span class="email-cell" data-email-id="${lead.id}">${emailCellHtml(lead)}</span>
            </label>
            <label class="lead-field lead-field--wide">
              <span class="lead-field-label">Notes</span>
              <textarea class="detail-notes" data-id="${lead.id}" placeholder="Add notes…" rows="3">${esc(lead.notes || '')}</textarea>
            </label>
          </div>
          <div class="lead-detail-actions">
            <div class="call-outcome" role="group" aria-label="How did the call go?">
              <span class="call-outcome-label">Call outcome</span>
              <button class="outcome-btn outcome-btn-good${outcome === 'good' ? ' active' : ''}" data-action="outcome-good" data-id="${lead.id}" title="Good call" aria-pressed="${outcome === 'good'}">✓</button>
              <button class="outcome-btn outcome-btn-bad${outcome === 'bad' ? ' active' : ''}" data-action="outcome-bad" data-id="${lead.id}" title="Bad call" aria-pressed="${outcome === 'bad'}">✕</button>
            </div>
            <div class="row-actions">
              <button class="btn btn-ghost" data-action="contact"   data-id="${lead.id}" ${lead.queued ? 'disabled title="Already queued to send"' : ''}>${lead.queued ? '⏱ Queued' : '✉ Send'}</button>
              <button class="btn btn-ghost" data-action="followup"  data-id="${lead.id}">↩ Follow-up</button>
              <button class="btn btn-ghost" data-action="converted" data-id="${lead.id}">★ Won</button>
            </div>
          </div>
        </div>
      </td>
    </tr>`;

  return barRow + detailRow;
}

/* ─── Outreach view ──────────────────────────────────────────────────── */
function renderOutreach() {
  renderSendQueue();
  document.querySelectorAll('#outreach-filters .pill')
    .forEach(p => p.classList.toggle('active', p.dataset.filter === state.outreachFilter));

  let leads = filterLeads(state.leads);
  if (state.outreachFilter) leads = leads.filter(l => l.status === state.outreachFilter);
  leads = [...leads].sort((a, b) => (b.score || 0) - (a.score || 0)); // hottest leads first

  const body  = $('outreach-body');
  const empty = $('outreach-empty');
  if (!leads.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = state.leads.length ? 'No leads match this filter.' : 'No leads yet — run the Lead Scraper first.';
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = leads.map(buildOutreachRow).join('');
}

/* ─── Send Queue panel ───────────────────────────────────────────────── */
let _sendQueueTimer = null;

// SQLite datetimes come back as "YYYY-MM-DD HH:MM:SS" (UTC, no zone); our
// scheduled_at is a full ISO string. Format either to a friendly local time.
function fmtQueueTime(raw) {
  if (!raw) return '';
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

async function renderSendQueue() {
  const body = $('send-queue-body');
  const summary = $('send-queue-summary');
  if (!body) return;

  let data;
  try { data = await api('GET', '/api/email-queue/items'); }
  catch (err) { body.innerHTML = `<div class="empty-state">Couldn't load queue: ${esc(err.message)}</div>`; return; }

  const { stats, pending, recent } = data;
  const cap = state.settings.email_daily_cap || 40;
  if (summary) summary.textContent = `${stats.pending} pending · ${stats.sent_24h ?? 0}/${cap} sent today · ${stats.failed} failed`;

  let html = '';
  if (pending.length) {
    html += `<div class="table-scroll"><table class="leads-table">
      <thead><tr><th>Business</th><th>Email</th><th class="col-center">Type</th><th>Sends</th><th class="col-actions"></th></tr></thead><tbody>`;
    html += pending.map((it, i) => `
      <tr>
        <td class="td-name">${esc(it.business_name)}</td>
        <td>${esc(it.email || '')}</td>
        <td class="col-center"><span class="badge">${it.type === 'followup' ? 'Follow-up' : 'Outreach'}</span></td>
        <td>${i === 0 ? '<strong>next</strong>' : esc(fmtQueueTime(it.scheduled_at))}</td>
        <td class="actions-cell"><button class="btn btn-ghost" data-action="cancel-queue" data-id="${it.id}" title="Cancel this email">✕</button></td>
      </tr>`).join('');
    html += `</tbody></table></div>`;
  } else {
    html += `<div class="empty-state">Queue is empty — nothing waiting to send.</div>`;
  }

  if (recent.length) {
    html += `<div class="queue-recent"><div class="queue-recent-head">Recent</div>` + recent.map(r => {
      const ok = r.status === 'sent';
      const detail = (!ok && r.error) ? ` — ${esc(r.error)}` : '';
      return `<div class="queue-recent-row ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✕'} ${esc(r.business_name)}
        <span class="muted">${esc(r.email || '')} · ${esc(fmtQueueTime(r.sent_at))}${detail}</span></div>`;
    }).join('') + `</div>`;
  }
  body.innerHTML = html;

  // Keep it live while there's a backlog and we're still on this view.
  clearTimeout(_sendQueueTimer);
  if (pending.length && state.view === 'outreach') {
    _sendQueueTimer = setTimeout(renderSendQueue, 20000);
  }
}

function buildOutreachRow(lead) {
  return `
    <tr data-id="${lead.id}">
      <td class="td-name">
        ${scoreBadge(lead.score)}
        ${lead.website
          ? `<a href="${esc(lead.website)}" target="_blank" rel="noopener">${esc(lead.business_name)}</a>`
          : esc(lead.business_name)}
        ${engagementDot(lead)}
        <div class="td-address">${esc(lead.category || '')} · ${ratingStars(lead.google_rating)} ${lead.google_rating ?? ''}</div>
      </td>
      <td><input type="email" class="email-input" data-id="${lead.id}" value="${esc(lead.email || '')}" placeholder="Add email…" /></td>
      <td class="col-center">${oppBadge(lead.opportunity_type)}</td>
      <td class="col-center">${statusBadge(lead)}</td>
      <td class="actions-cell">
        <button class="btn btn-primary" data-action="contact"  data-id="${lead.id}" ${lead.queued ? 'disabled title="Already queued to send"' : ''}>${lead.queued ? '⏱ Queued' : '✉ Send'}</button>
        ${state.aiConfigured ? `<button class="btn btn-ai" data-action="ai-brief" data-id="${lead.id}" title="AI lead brief">✦ Brief</button>` : ''}
        <button class="btn btn-ghost"   data-action="followup" data-id="${lead.id}">↩ Follow-up</button>
        <button class="btn btn-ghost"   data-action="replied"  data-id="${lead.id}">✓ Replied</button>
        <button class="btn btn-ghost"   data-action="converted" data-id="${lead.id}">★ Won</button>
        ${['replied', 'converted'].includes(lead.status)
          ? `<button class="btn btn-ghost" data-action="convert-client" data-id="${lead.id}" title="Promote to client">🤝 Client</button>`
          : ''}
        <button class="btn btn-ghost"   data-action="delete"   data-id="${lead.id}" title="Delete lead">🗑</button>
      </td>
    </tr>`;
}

/* ─── Pipeline (kanban) ──────────────────────────────────────────────── */
function renderKanban() {
  const leads = filterLeads(state.leads);
  const kanban = $('kanban');
  kanban.innerHTML = STATUSES.map(status => {
    const colLeads = leads.filter(l => l.status === status);
    const cards = colLeads.length
      ? colLeads.map(buildKanCard).join('')
      : '<div class="kan-empty">Drop leads here</div>';
    return `
      <div class="kan-col col-${status}" data-status="${status}">
        <div class="kan-col-head">
          <span class="kan-col-dot"></span>
          <span class="kan-col-title">${STATUS_LABELS[status]}</span>
          <span class="kan-col-count">${colLeads.length}</span>
        </div>
        <div class="kan-list">${cards}</div>
      </div>`;
  }).join('');
  wireKanbanDnD();
}

function buildKanCard(lead) {
  const isClient = state.clients.some(c => String(c.lead_id) === String(lead.id));
  const convertBtn = ['replied', 'converted'].includes(lead.status) && !isClient
    ? `<button class="btn btn-ghost btn-sm kan-convert" data-action="convert-client" data-id="${lead.id}">🤝 Make client</button>`
    : (isClient ? '<span class="kan-client-flag">🤝 Client</span>' : '');
  return `
    <div class="kan-card" draggable="true" data-id="${lead.id}">
      <div class="kan-card-name">${esc(lead.business_name)}</div>
      <div class="kan-card-cat">${esc(lead.category || '—')}</div>
      <div class="kan-card-foot">
        ${oppBadge(lead.opportunity_type)}
        <span class="kan-card-rating">★ ${lead.google_rating ?? '—'}</span>
      </div>
      ${convertBtn}
    </div>`;
}

let dragId = null;
function wireKanbanDnD() {
  document.querySelectorAll('.kan-card').forEach(card => {
    card.addEventListener('dragstart', () => { dragId = card.dataset.id; card.classList.add('dragging'); });
    card.addEventListener('dragend',   () => { dragId = null; card.classList.remove('dragging'); });
  });
  document.querySelectorAll('.kan-col').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = dragId;
      const newStatus = col.dataset.status;
      const lead = findLead(id);
      if (!lead || !id || lead.status === newStatus) return;
      const prev = lead.status;
      lead.status = newStatus;        // optimistic
      renderKanban();
      try {
        await api('PUT', `/api/leads/${id}`, { status: newStatus });
        showToast(`Moved to ${STATUS_LABELS[newStatus]}`, 'success');
        state.analytics = await api('GET', '/api/analytics');
      } catch (err) {
        lead.status = prev;
        renderKanban();
        showToast('Move failed: ' + err.message, 'error');
      }
    });
  });
}

/* ─── Clients ────────────────────────────────────────────────────────── */
const CLIENT_STATUS_LABELS = { active: 'Active', paused: 'Paused', churned: 'Churned' };

function renderClients() {
  const listWrap = $('clients-list-wrap');
  const detail   = $('client-detail');

  if (state.clientId) {
    listWrap.classList.add('hidden');
    detail.classList.remove('hidden');
    renderClientDetail(state.clientId);
    return;
  }
  listWrap.classList.remove('hidden');
  detail.classList.add('hidden');

  const clients = filterClients(state.clients);
  const body  = $('clients-body');
  const empty = $('clients-empty');
  if (!clients.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = state.clients.length
      ? 'No clients match your search.'
      : 'No clients yet — convert a won lead from the pipeline, or add one manually.';
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = clients.map(c => `
    <tr class="client-row" data-goto-client="${c.id}">
      <td class="td-name">${esc(c.company)}
        <div class="td-address">${esc(c.service_description || '—')}</div>
      </td>
      <td>${esc(c.contact_name || '—')}<div class="td-address">${esc(c.email || '')}</div></td>
      <td class="col-center">${money(c.monthly_retainer)}<span class="per-mo">/mo</span></td>
      <td class="col-center"><span class="badge badge-cl-${c.status}">${CLIENT_STATUS_LABELS[c.status] || c.status}</span></td>
      <td class="col-center">${money(c.total_invoiced)}</td>
      <td class="actions-cell">
        <button class="btn btn-ghost" data-action="edit-client" data-id="${c.id}">✎ Edit</button>
        <button class="btn btn-ghost" data-action="delete-client" data-id="${c.id}" title="Remove client">🗑</button>
      </td>
    </tr>`).join('');
}

async function renderClientDetail(id) {
  const el = $('client-detail');
  el.innerHTML = '<div class="skeleton-block"></div>';
  let data;
  try {
    data = await api('GET', `/api/clients/${id}`);
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="empty-state">Client not found. <a class="panel-link" href="#clients">← Back to clients</a></div></div>`;
    return;
  }
  // Ignore stale responses after the user navigated away
  if (state.view !== 'clients' || String(state.clientId) !== String(id)) return;

  const c   = data.client;
  const agg = state.clients.find(x => String(x.id) === String(c.id)) || {};
  const since = c.start_date
    ? new Date(c.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  const tasksHtml = (data.tasks || []).length ? data.tasks.map(t => `
    <div class="today-item ${t.done ? 'done' : ''}">
      <label class="task-check"><input type="checkbox" data-task-id="${t.id}" ${t.done ? 'checked' : ''} /></label>
      <div class="today-main">
        <div class="today-title">${esc(t.title)}</div>
        ${t.due_date ? `<div class="today-sub">${dueLabel(t.due_date)}</div>` : ''}
      </div>
      <button class="icon-btn btn-xs" data-action="task-delete" data-id="${t.id}" title="Delete task">✕</button>
    </div>`).join('') : '<div class="empty-state">No tasks for this client.</div>';

  const activityHtml = (data.activity || []).length ? data.activity.map(a => `
    <div class="feed-row">
      <span class="feed-ico">${ACTIVITY_ICONS[a.type] || '•'}</span>
      <div class="feed-main">
        <div class="feed-msg">${esc(a.message)}</div>
        <div class="feed-time">${timeAgo(a.timestamp)}</div>
      </div>
    </div>`).join('') : '<div class="empty-state">No activity recorded yet.</div>';

  const lead = data.sourceLead;

  el.innerHTML = `
    <div class="panel client-head-panel">
      <a class="back-link" href="#clients">← All clients</a>
      <div class="client-head-row">
        <div class="recent-avatar client-avatar">${esc((c.company || '?').charAt(0).toUpperCase())}</div>
        <div class="client-head-main">
          <h2 class="client-name">${esc(c.company)}</h2>
          <div class="client-sub">
            ${esc(c.contact_name || '')}${c.email ? ' · ' + esc(c.email) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}
          </div>
        </div>
        <span class="badge badge-cl-${c.status}">${CLIENT_STATUS_LABELS[c.status] || c.status}</span>
        <button class="btn btn-primary" data-action="new-invoice" data-client-id="${c.id}">🧾 New Invoice</button>
        <button class="btn btn-ghost" data-action="edit-client" data-id="${c.id}">✎ Edit</button>
      </div>
      <div class="client-stats">
        <div class="client-stat"><span class="client-stat-label">Monthly retainer</span><span class="client-stat-value">${money(c.monthly_retainer)}</span></div>
        <div class="client-stat"><span class="client-stat-label">Total invoiced</span><span class="client-stat-value">${money(agg.total_invoiced)}</span></div>
        <div class="client-stat"><span class="client-stat-label">Collected</span><span class="client-stat-value">${money(agg.total_paid)}</span></div>
        <div class="client-stat"><span class="client-stat-label">Client since</span><span class="client-stat-value">${since}</span></div>
      </div>
      ${c.service_description ? `<div class="client-service">${esc(c.service_description)}</div>` : ''}
      ${lead ? `<div class="client-source">Source lead: <b>${esc(lead.business_name)}</b> · ${esc(lead.category || '')} · ★ ${lead.google_rating ?? '—'}</div>` : ''}
      <div class="report-link-block">
        <div class="report-link-head">
          <span class="report-link-title">📊 Shareable client report</span>
          <span class="report-link-desc">A polished, read-only results page you can send to ${esc(c.company)} — no login needed.</span>
        </div>
        ${c.report_token ? `
          <div class="report-link-row">
            <input class="report-link-url" readonly value="${esc(reportUrl(c.report_token))}" />
            <button class="btn btn-ghost btn-sm" data-action="copy-report-link" data-token="${esc(c.report_token)}">Copy</button>
            <a class="btn btn-ghost btn-sm" href="${esc(reportUrl(c.report_token))}" target="_blank" rel="noopener">Open ↗</a>
            <button class="btn btn-ghost btn-sm" data-action="regen-report-token" data-id="${c.id}" title="Old link stops working">↻ Rotate</button>
            <button class="btn btn-ghost btn-sm" data-action="revoke-report-token" data-id="${c.id}">Revoke</button>
          </div>` : `
          <button class="btn btn-primary btn-sm" data-action="regen-report-token" data-id="${c.id}">Generate report link</button>`}
      </div>
    </div>

    ${(data.invoices || []).length ? `
    <div class="panel" style="margin-bottom:22px">
      <div class="panel-head"><h2 class="panel-title">Invoices</h2></div>
      <div class="table-scroll">
        <table class="leads-table">
          <thead><tr><th>Number</th><th class="col-center">Total</th><th class="col-center">Status</th><th class="col-center">Due</th></tr></thead>
          <tbody>${data.invoices.map(inv => `
            <tr>
              <td class="td-name">${esc(inv.number)}</td>
              <td class="col-center"><b>${money2(inv.total)}</b></td>
              <td class="col-center"><span class="badge badge-iv-${inv.status}">${INVOICE_STATUS_LABELS[inv.status] || inv.status}</span></td>
              <td class="col-center">${inv.due_date ? dueLabelShort(inv.due_date) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="overview-grid overview-grid--secondary">
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Tasks</h2></div>
        <div class="today-list">${tasksHtml}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2 class="panel-title">Activity</h2></div>
        <div class="feed-list">${activityHtml}</div>
      </div>
    </div>

    ${c.notes ? `<div class="panel"><div class="panel-head"><h2 class="panel-title">Notes</h2></div><p class="client-notes">${esc(c.notes)}</p></div>` : ''}
  `;
}

function filterClients(clients) {
  if (!state.search) return clients;
  return clients.filter(c =>
    (c.company || '').toLowerCase().includes(state.search) ||
    (c.contact_name || '').toLowerCase().includes(state.search) ||
    (c.email || '').toLowerCase().includes(state.search));
}

/* ─── Client modal ───────────────────────────────────────────────────── */
let clientModalId = null;     // set when editing an existing client
let clientModalLeadId = null; // set when converting a lead

function openClientModal(client = null, fromLead = null) {
  clientModalId = client ? client.id : null;
  clientModalLeadId = fromLead ? fromLead.id : null;
  $('client-modal-title').textContent = client
    ? 'Edit Client'
    : (fromLead ? `Convert “${fromLead.business_name}” to Client` : 'New Client');
  $('cm-company').value  = client?.company ?? fromLead?.business_name ?? '';
  $('cm-contact').value  = client?.contact_name ?? '';
  $('cm-email').value    = client?.email ?? fromLead?.email ?? '';
  $('cm-phone').value    = client?.phone ?? fromLead?.phone ?? '';
  $('cm-retainer').value = client?.monthly_retainer ?? '';
  $('cm-status').value   = client?.status ?? 'active';
  $('cm-start').value    = (client?.start_date || new Date().toISOString()).slice(0, 10);
  $('cm-service').value  = client?.service_description ?? '';
  $('cm-notes').value    = client?.notes ?? fromLead?.notes ?? '';
  $('client-modal').classList.remove('hidden');
  $('cm-company').focus();
}

function closeClientModal() {
  $('client-modal').classList.add('hidden');
  clientModalId = null;
  clientModalLeadId = null;
}

async function onClientSave() {
  const payload = {
    company:             $('cm-company').value.trim(),
    contact_name:        $('cm-contact').value.trim() || null,
    email:               $('cm-email').value.trim() || null,
    phone:               $('cm-phone').value.trim() || null,
    monthly_retainer:    Number($('cm-retainer').value) || 0,
    status:              $('cm-status').value,
    start_date:          $('cm-start').value || null,
    service_description: $('cm-service').value.trim() || null,
    notes:               $('cm-notes').value.trim() || null,
  };
  if (!payload.company) return showToast('Company name is required', 'error');

  const btn = $('client-modal-save');
  btn.disabled = true; btn.textContent = '⟳ Saving…';
  try {
    if (clientModalId) {
      await api('PUT', `/api/clients/${clientModalId}`, payload);
      showToast('Client updated', 'success');
    } else if (clientModalLeadId) {
      const created = await api('POST', `/api/leads/${clientModalLeadId}/convert`, {});
      await api('PUT', `/api/clients/${created.id}`, payload);
      showToast('Lead converted to client 🎉', 'success');
    } else {
      await api('POST', '/api/clients', payload);
      showToast('Client added', 'success');
    }
    closeClientModal();
    await refresh();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Client';
  }
}

/* ─── Today panel ────────────────────────────────────────────────────── */
function renderToday() {
  const list = $('today-list');
  if (!list) return;
  const t = state.today || { tasks: [], open_tasks: [], followups: [] };
  const todayIso = t.date || new Date().toISOString().slice(0, 10);
  const items = [];

  for (const f of t.followups || []) {
    items.push(`
      <div class="today-item followup ${f.follow_up_date && f.follow_up_date.slice(0, 10) < todayIso ? 'overdue' : ''}">
        <span class="today-ico">↩</span>
        <div class="today-main">
          <div class="today-title">Follow up with <b>${esc(f.business_name)}</b></div>
          <div class="today-sub">${dueLabel(f.follow_up_date, todayIso)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="followup" data-id="${f.id}">Send</button>
      </div>`);
  }

  for (const task of t.open_tasks || []) {
    const overdue = task.due_date && task.due_date.slice(0, 10) < todayIso;
    items.push(`
      <div class="today-item ${overdue ? 'overdue' : ''}">
        <label class="task-check"><input type="checkbox" data-task-id="${task.id}" /></label>
        <div class="today-main">
          <div class="today-title">${esc(task.title)}${task.client_company ? ` <span class="task-link">· ${esc(task.client_company)}</span>` : ''}${task.lead_name ? ` <span class="task-link">· ${esc(task.lead_name)}</span>` : ''}</div>
          ${task.due_date ? `<div class="today-sub">${dueLabel(task.due_date, todayIso)}</div>` : ''}
        </div>
        <button class="icon-btn btn-xs" data-action="task-delete" data-id="${task.id}" title="Delete task">✕</button>
      </div>`);
  }

  const dueCount = (t.followups || []).length +
    (t.open_tasks || []).filter(x => x.due_date && x.due_date.slice(0, 10) <= todayIso).length;
  const hint = $('today-hint');
  if (hint) hint.textContent = dueCount ? `${dueCount} due` : 'All clear';

  list.innerHTML = items.length
    ? items.join('')
    : '<div class="empty-state">Nothing due — add a task above or set follow-up dates on leads.</div>';
}

/* ─── Activity feed ──────────────────────────────────────────────────── */
const ACTIVITY_ICONS = {
  scrape: '🔍', email_sent: '✉️', email_opened: '👁', reply_detected: '💬',
  status_change: '⇄', client_added: '🤝', client_removed: '✕',
  invoice_sent: '🧾', invoice_paid: '💰', lead_deleted: '🗑',
};

function renderActivityFeed() {
  const el = $('activity-feed');
  if (!el) return;
  const items = (state.activity || []).slice(0, 12);
  el.innerHTML = items.length ? items.map(a => `
    <div class="feed-row">
      <span class="feed-ico">${ACTIVITY_ICONS[a.type] || '•'}</span>
      <div class="feed-main">
        <div class="feed-msg">${esc(a.message)}</div>
        <div class="feed-time">${timeAgo(a.timestamp)}</div>
      </div>
    </div>`).join('') : '<div class="empty-state">No activity yet — it shows up here as you work.</div>';
}

/* ─── Finance ────────────────────────────────────────────────────────── */
const INVOICE_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue' };

function money2(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderFinance() {
  const f = state.finance || {};

  $('fin-kpis').innerHTML = [
    { label: 'MRR',          value: money(f.mrr),           accent: 'var(--accent)',  foot: `${state.clients.filter(c => c.status === 'active').length} active retainers` },
    { label: 'Revenue MTD',  value: money(f.revenue_mtd),   accent: 'var(--accent)',  foot: 'income this month' },
    { label: 'Expenses MTD', value: money(f.expenses_mtd),  accent: 'var(--rose)',    foot: 'spend this month' },
    { label: 'Net MTD',      value: money(f.net_mtd),       accent: f.net_mtd >= 0 ? 'var(--accent)' : 'var(--rose)', foot: 'profit this month' },
    { label: 'Outstanding',  value: money(f.outstanding),   accent: 'var(--amber)',   foot: 'sent, awaiting payment' },
    { label: 'Overdue',      value: money(f.overdue_total), accent: 'var(--rose)',    foot: `${f.overdue_count || 0} invoice${f.overdue_count === 1 ? '' : 's'} past due` },
  ].map(k => `
    <div class="kpi-card" style="--kpi-accent:${k.accent}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-foot"><span class="kpi-chip">${k.foot}</span></div>
    </div>`).join('');

  // Goal + forecast panel
  const goal = f.goal || 0;
  const pct = goal ? Math.min(100, Math.round((f.revenue_mtd / goal) * 100)) : 0;
  $('goal-panel').innerHTML = `
    <div class="goal-row">
      <div class="goal-main">
        <div class="goal-title">Monthly revenue goal</div>
        ${goal ? `
          <div class="progress"><div class="progress-bar ${pct >= 100 ? 'hit' : ''}" style="width:${pct}%"></div></div>
          <div class="goal-sub">${money(f.revenue_mtd)} of ${money(goal)} · <b>${pct}%</b>${pct >= 100 ? ' 🎉 Goal hit!' : ''}</div>
        ` : `<div class="goal-sub">No goal set — add one in <a class="panel-link" href="#settings">Settings → Finance</a>.</div>`}
      </div>
      <div class="goal-chips">
        <div class="goal-chip"><span class="goal-chip-label">Forecast next 30d</span><span class="goal-chip-value">${money(f.forecast)}</span></div>
        <div class="goal-chip"><span class="goal-chip-label">Pipeline-weighted</span><span class="goal-chip-value">+${money(f.pipeline_weighted)}</span></div>
      </div>
    </div>`;

  renderFinanceCharts();
  renderInvoicesTable();
  renderTxTable();
}

function renderFinanceCharts() {
  if (typeof Chart === 'undefined' || !state.finCharts) return;
  const fc = state.finCharts;

  const monthly = fc.monthly || [];
  drawChart('finMonthly', 'chart-fin-monthly', {
    type: 'bar',
    data: {
      labels: monthly.map(m => m.month),
      datasets: [
        { label: 'Income',   data: monthly.map(m => m.income),   backgroundColor: 'rgba(34,197,94,0.75)',  borderRadius: 6, borderSkipped: false },
        { label: 'Expenses', data: monthly.map(m => m.expenses), backgroundColor: 'rgba(244,63,94,0.65)',  borderRadius: 6, borderSkipped: false },
      ],
    },
    options: baseChartOpts(),
  });

  const cats = fc.by_category || [];
  const catColors = ['#f43f5e', '#f59e0b', '#a855f7', '#38bdf8', '#22c55e', '#6366f1', '#fb7185', '#fbbf24'];
  drawChart('finCategories', 'chart-fin-categories', {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.category),
      datasets: [{ data: cats.map(c => c.total), backgroundColor: cats.map((_, i) => catColors[i % catColors.length]), borderColor: '#0b1220', borderWidth: 3 }],
    },
    options: { ...baseChartOpts(), cutout: '62%', scales: {}, plugins: { legend: { display: true, position: 'bottom', labels: { color: '#8595b3', padding: 14, font: { size: 12 } } } } },
  });

  const byClient = fc.by_client || [];
  drawChart('finByClient', 'chart-fin-byclient', {
    type: 'bar',
    data: {
      labels: byClient.map(c => c.client),
      datasets: [{ label: 'Revenue', data: byClient.map(c => c.total), backgroundColor: 'rgba(34,197,94,0.75)', borderRadius: 6, borderSkipped: false }],
    },
    options: { ...baseChartOpts(), indexAxis: 'y', plugins: { legend: { display: false } } },
  });
}

function renderInvoicesTable() {
  const body  = $('invoices-body');
  const empty = $('invoices-empty');
  const invoices = state.invoices || [];
  if (!invoices.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'No invoices yet — create one for a client.';
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = invoices.map(inv => `
    <tr data-id="${inv.id}">
      <td class="td-name">${esc(inv.number)}</td>
      <td>${esc(inv.client_company)}</td>
      <td class="col-center"><b>${money2(inv.total)}</b></td>
      <td class="col-center"><span class="badge badge-iv-${inv.status}">${INVOICE_STATUS_LABELS[inv.status] || inv.status}</span></td>
      <td class="col-center">${inv.due_date ? dueLabelShort(inv.due_date) : '—'}</td>
      <td class="actions-cell">
        ${inv.status === 'draft' ? `
          <button class="btn btn-ghost" data-action="edit-invoice" data-id="${inv.id}">✎ Edit</button>
          <button class="btn btn-primary" data-action="send-invoice" data-id="${inv.id}">✉ Send</button>` : ''}
        ${inv.status === 'sent' || inv.status === 'overdue' ? `
          <button class="btn btn-primary" data-action="mark-paid" data-id="${inv.id}">✓ Mark Paid</button>
          <button class="btn btn-ghost" data-action="send-invoice" data-id="${inv.id}" title="Resend">✉ Resend</button>` : ''}
        <button class="btn btn-ghost" data-action="delete-invoice" data-id="${inv.id}" title="Delete invoice">🗑</button>
      </td>
    </tr>`).join('');
}

function dueLabelShort(date) {
  const today = new Date().toISOString().slice(0, 10);
  const d = (date || '').slice(0, 10);
  const pretty = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d < today ? `<span class="due-overdue">${pretty}</span>` : pretty;
}

function renderTxTable() {
  document.querySelectorAll('#tx-filters .pill')
    .forEach(p => p.classList.toggle('active', p.dataset.txFilter === state.txFilter));

  const body  = $('tx-body');
  const empty = $('tx-empty');
  let txs = state.transactions || [];
  if (state.txFilter) txs = txs.filter(t => t.type === state.txFilter);

  if (!txs.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'No transactions yet — log income and expenses above, or mark an invoice paid.';
    return;
  }
  empty.classList.add('hidden');
  body.innerHTML = txs.slice(0, 60).map(t => `
    <tr data-id="${t.id}">
      <td>${(t.date || '').slice(0, 10)}</td>
      <td>${esc(t.category)}${t.recurring ? ' <span class="tx-recurring" title="Recurring monthly">↻</span>' : ''}</td>
      <td class="tx-desc">${esc(t.description || '—')}</td>
      <td class="col-center">${esc(t.client_company || '—')}</td>
      <td class="col-center"><span class="tx-amount ${t.type}">${t.type === 'expense' ? '−' : '+'}${money2(t.amount)}</span></td>
      <td class="actions-cell">
        ${t.invoice_id ? '<span class="tx-auto" title="Created automatically from a paid invoice">auto</span>'
          : `<button class="icon-btn btn-xs" data-action="delete-transaction" data-id="${t.id}" title="Delete">✕</button>`}
      </td>
    </tr>`).join('');
}

/* ─── Service packages (agency pricing model) ────────────────────────── */
const PACKAGES = [
  { group: 'Retainers', label: 'Presence — $1,200/mo (+$500 setup)', items: [
    { description: 'Presence retainer — ads (1 channel), site maintenance, missed-call text-back, monthly report', quantity: 1, unit_price: 1200 },
    { description: 'One-time onboarding & setup', quantity: 1, unit_price: 500 },
  ]},
  { group: 'Retainers', label: 'Growth — $2,500/mo (+$1,000 setup)', items: [
    { description: 'Growth retainer — Google + Meta ads, landing pages & CRO, AI receptionist, review automation, live AI dashboard', quantity: 1, unit_price: 2500 },
    { description: 'One-time onboarding & setup', quantity: 1, unit_price: 1000 },
  ]},
  { group: 'Retainers', label: 'Scale — $4,500/mo (+$1,500 setup)', items: [
    { description: 'Scale retainer — multi-channel ads, unlimited funnels, custom AI workflows, live dashboard + monthly strategy call', quantity: 1, unit_price: 4500 },
    { description: 'One-time onboarding & setup', quantity: 1, unit_price: 1500 },
  ]},
  { group: 'Retainers', label: 'Founding Growth — $1,800/mo (12-mo lock)', items: [
    { description: 'Growth retainer — founding-client rate, locked 12 months (testimonial + case-study rights)', quantity: 1, unit_price: 1800 },
  ]},
  { group: 'Builds', label: 'Website Launch — $3,500', items: [
    { description: 'Website Launch — 5–7 page site, mobile-first, SEO foundations, booking/contact integration', quantity: 1, unit_price: 3500 },
  ]},
  { group: 'Builds', label: 'Website + AI — $5,000', items: [
    { description: 'Website + AI — full site build plus AI chat & lead-capture agent trained on the business', quantity: 1, unit_price: 5000 },
  ]},
  { group: 'Add-ons', label: 'AI Receptionist — $1,500 setup + $300/mo', items: [
    { description: 'AI receptionist — setup & training', quantity: 1, unit_price: 1500 },
    { description: 'AI receptionist — monthly operation (first month)', quantity: 1, unit_price: 300 },
  ]},
  { group: 'Add-ons', label: 'Review Automation — $750 setup + $150/mo', items: [
    { description: 'Review-generation automation — setup', quantity: 1, unit_price: 750 },
    { description: 'Review-generation automation — monthly (first month)', quantity: 1, unit_price: 150 },
  ]},
  { group: 'Add-ons', label: 'Landing Page / Funnel — $600', items: [
    { description: 'Additional landing page / funnel build', quantity: 1, unit_price: 600 },
  ]},
  { group: 'Add-ons', label: 'Email Nurture Sequence — $900', items: [
    { description: 'Email nurture sequence — strategy, copy & automation build', quantity: 1, unit_price: 900 },
  ]},
];

/* ─── Invoice modal ──────────────────────────────────────────────────── */
let invoiceModalId = null;

function ivLineRow(item = {}) {
  return `
    <div class="line-item-row">
      <input type="text" class="iv-desc" placeholder="Description" value="${esc(item.description || '')}" />
      <input type="number" class="iv-qty" min="0" step="1" placeholder="Qty" value="${item.quantity ?? 1}" />
      <input type="number" class="iv-price" min="0" step="0.01" placeholder="Price" value="${item.unit_price ?? ''}" />
      <button type="button" class="icon-btn btn-xs iv-remove-line" title="Remove line">✕</button>
    </div>`;
}

function openInvoiceModal(invoice = null, presetClientId = null) {
  invoiceModalId = invoice ? invoice.id : null;
  $('invoice-modal-title').textContent = invoice ? `Edit ${invoice.number}` : 'New Invoice';

  const sel = $('iv-client');
  sel.innerHTML = state.clients.map(c =>
    `<option value="${c.id}">${esc(c.company)}</option>`).join('');
  if (invoice)            sel.value = invoice.client_id;
  else if (presetClientId) sel.value = presetClientId;
  sel.disabled = !!invoice;

  // Package presets, grouped (Retainers / Builds / Add-ons)
  const pkgSel = $('iv-package');
  const groups = [...new Set(PACKAGES.map(p => p.group))];
  pkgSel.innerHTML = '<option value="">Custom — start blank</option>' + groups.map(g =>
    `<optgroup label="${g}">${PACKAGES.map((p, i) => p.group === g
      ? `<option value="${i}">${esc(p.label)}</option>` : '').join('')}</optgroup>`).join('');
  pkgSel.value = '';

  $('iv-tax').value   = invoice?.tax_rate ?? (state.settings.invoice_default_tax_rate || '');
  $('iv-issue').value = (invoice?.issue_date || new Date().toISOString()).slice(0, 10);
  const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  $('iv-due').value   = (invoice?.due_date || defaultDue).slice(0, 10);
  $('iv-notes').value = invoice?.notes ?? '';

  let items = [];
  if (invoice) { try { items = JSON.parse(invoice.line_items || '[]'); } catch { items = []; } }
  if (!items.length) {
    const client = state.clients.find(c => String(c.id) === String(sel.value));
    items = [{ description: client?.service_description || 'Monthly retainer', quantity: 1, unit_price: client?.monthly_retainer || '' }];
  }
  $('iv-lines').innerHTML = items.map(ivLineRow).join('');
  ivRecalcTotals();
  $('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  $('invoice-modal').classList.add('hidden');
  invoiceModalId = null;
}

function ivCollectLines() {
  return [...document.querySelectorAll('#iv-lines .line-item-row')].map(row => ({
    description: row.querySelector('.iv-desc').value.trim(),
    quantity:    Number(row.querySelector('.iv-qty').value) || 1,
    unit_price:  Number(row.querySelector('.iv-price').value) || 0,
  })).filter(it => it.description || it.unit_price);
}

function ivRecalcTotals() {
  const items = ivCollectLines();
  const taxRate = Number($('iv-tax').value) || 0;
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const total = subtotal * (1 + taxRate / 100);
  $('iv-totals').innerHTML = `
    <span>Subtotal <b>${money2(subtotal)}</b></span>
    ${taxRate ? `<span>Tax (${taxRate}%) <b>${money2(total - subtotal)}</b></span>` : ''}
    <span class="iv-total">Total <b>${money2(total)}</b></span>`;
}

async function onInvoiceSave() {
  const line_items = ivCollectLines();
  if (!line_items.length) return showToast('Add at least one line item', 'error');
  if (!$('iv-due').value)  return showToast('Set a due date', 'error');

  const payload = {
    client_id:  Number($('iv-client').value),
    line_items,
    tax_rate:   Number($('iv-tax').value) || 0,
    issue_date: $('iv-issue').value || null,
    due_date:   $('iv-due').value,
    notes:      $('iv-notes').value.trim() || null,
  };
  const btn = $('invoice-modal-save');
  btn.disabled = true; btn.textContent = '⟳ Saving…';
  try {
    if (invoiceModalId) {
      await api('PUT', `/api/invoices/${invoiceModalId}`, payload);
      showToast('Invoice updated', 'success');
    } else {
      const created = await api('POST', '/api/invoices', payload);
      showToast(`Invoice ${created.number} created`, 'success');
    }
    closeInvoiceModal();
    await refresh();
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Draft';
  }
}

/* ─── Analytics ──────────────────────────────────────────────────────── */
function renderAnalytics() {
  const a = state.analytics;
  if (!a) return;
  const rates = a.rates || {};
  $('rate-grid').innerHTML = [
    { label: 'Contacted Today', value: a.contacted_today || 0,             foot: 'resets at midnight',    accent: '#FF4D00' },
    { label: 'Contact Rate',    value: (rates.contact_rate ?? 0) + '%',    foot: 'of leads contacted' },
    { label: 'Reply Rate',      value: (rates.reply_rate ?? 0) + '%',      foot: 'of contacted replied' },
    { label: 'Conversion Rate', value: (rates.conversion_rate ?? 0) + '%', foot: 'of leads converted' },
    { label: 'Total Leads',     value: a.total || 0,                       foot: 'in pipeline' },
  ].map(k => `
    <div class="kpi-card" style="--kpi-accent:${k.accent || 'var(--accent)'}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-foot">${k.foot}</div>
    </div>`).join('');

  if (typeof Chart === 'undefined') return;

  // Leads over time
  const ot = a.over_time || [];
  drawChart('overtime', 'chart-overtime', {
    type: 'line',
    data: {
      labels: ot.map(d => d.day),
      datasets: [{
        label: 'Leads', data: ot.map(d => d.count),
        borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)',
        fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: '#22c55e',
      }],
    },
    options: baseChartOpts(),
  });

  // Funnel
  const funnel = a.funnel || [];
  drawChart('funnel', 'chart-funnel', {
    type: 'bar',
    data: {
      labels: funnel.map(f => f.stage),
      datasets: [{
        label: 'Leads', data: funnel.map(f => f.count),
        backgroundColor: ['#38bdf8', '#f59e0b', '#a855f7', '#22c55e'],
        borderRadius: 8, borderSkipped: false,
      }],
    },
    options: { ...baseChartOpts(), indexAxis: 'y', plugins: { legend: { display: false } } },
  });

  // Opportunity mix
  const opp = a.by_opportunity || {};
  const oppKeys = Object.keys(opp);
  const oppColor = { NO_WEBSITE: '#f43f5e', WEAK_ADVERTISING: '#f59e0b', HIGH_POTENTIAL: '#22c55e', SCALING_CANDIDATE: '#a855f7', UNKNOWN: '#64748b' };
  drawChart('opportunity', 'chart-opportunity', {
    type: 'doughnut',
    data: {
      labels: oppKeys.map(k => OPP_LABELS[k] || k),
      datasets: [{ data: oppKeys.map(k => opp[k]), backgroundColor: oppKeys.map(k => oppColor[k] || '#64748b'), borderColor: '#0b1220', borderWidth: 3 }],
    },
    options: { ...baseChartOpts(), cutout: '62%', scales: {}, plugins: { legend: { display: true, position: 'bottom', labels: { color: '#8595b3', padding: 14, font: { size: 12 } } } } },
  });

  // Status breakdown
  const bs = a.by_status || {};
  drawChart('status', 'chart-status', {
    type: 'bar',
    data: {
      labels: STATUSES.map(s => STATUS_LABELS[s]),
      datasets: [{ label: 'Leads', data: STATUSES.map(s => bs[s] || 0), backgroundColor: ['#38bdf8', '#f59e0b', '#a855f7', '#22c55e', '#fbbf24'], borderRadius: 8, borderSkipped: false }],
    },
    options: { ...baseChartOpts(), plugins: { legend: { display: false } } },
  });
}

function drawChart(key, canvasId, config) {
  if (charts[key]) charts[key].destroy();
  const el = $(canvasId);
  if (!el) return;
  charts[key] = new Chart(el.getContext('2d'), config);
}

function baseChartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8595b3' } } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8595b3', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8595b3', font: { size: 11 }, precision: 0 }, beginAtZero: true },
    },
  };
}

function initChartDefaults() {
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#8595b3';
    Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  }
}

/* ─── Settings ───────────────────────────────────────────────────────── */
function hydrateSettingsForm() {
  if ($('set-sender-name'))    $('set-sender-name').value    = state.settings.sender_name  || '';
  if ($('set-sender-phone'))   $('set-sender-phone').value   = state.settings.sender_phone || '';
  if ($('set-revenue-goal'))   $('set-revenue-goal').value   = state.settings.revenue_goal_monthly || '';
  if ($('set-avg-deal'))       $('set-avg-deal').value       = state.settings.avg_deal_value || '';
  if ($('set-invoice-prefix')) $('set-invoice-prefix').value = state.settings.invoice_prefix || '';
  if ($('set-anthropic-key'))  $('set-anthropic-key').value  = state.settings.anthropic_api_key || '';
  if ($('set-app-base-url'))   $('set-app-base-url').value   = state.settings.app_base_url || '';
  if ($('set-tracking-enabled')) $('set-tracking-enabled').checked = (state.settings.tracking_enabled ?? 'true') !== 'false';
  if ($('set-gap-min'))        $('set-gap-min').value        = state.settings.email_gap_min_sec || '';
  if ($('set-gap-max'))        $('set-gap-max').value        = state.settings.email_gap_max_sec || '';
  if ($('set-daily-cap'))      $('set-daily-cap').value      = state.settings.email_daily_cap  || '';
  if ($('set-window-start'))   $('set-window-start').value   = state.settings.send_window_start || '08:30';
  if ($('set-window-end'))     $('set-window-end').value     = state.settings.send_window_end   || '18:30';
  updateAiStatusLine();
}

function updateAiStatusLine() {
  const el = $('ai-status-line');
  if (!el) return;
  if (state.aiConfigured) {
    el.textContent = `AI active · key ending ${(state.settings.anthropic_api_key || '').slice(-4)} · powering outreach, briefs, insights & Q&A`;
    el.classList.remove('inactive');
  } else {
    el.textContent = 'No API key configured — AI features are hidden until you add one.';
    el.classList.add('inactive');
  }
}

function updatePersistenceState() {
  const el = $('persistence-state');
  if (el) el.textContent = `Storage active · ${state.leads.length} leads & settings saved automatically.`;
}

/* ─── Email modal (preserved flow) ───────────────────────────────────── */
const emailModal      = $('email-modal');
const modalToInput    = $('modal-to');
const modalSubject    = $('modal-subject');
const modalBodyEl     = $('modal-body');
const modalFindBtn    = $('modal-find-btn');
const modalSendBtn    = $('modal-send');
const modalSuggestions= $('modal-suggestions');

async function openEmailModal(id, action) {
  modalLeadId = id; modalAction = action;
  const lead = findLead(id);
  const hasWebsite = !!(lead && lead.website);
  $('modal-title').textContent = action === 'followup' ? 'Send Follow-up' : 'Send Outreach';
  modalToInput.value = (lead && lead.email) || '';
  modalSubject.value = 'Loading…';
  modalBodyEl.value = '';
  modalSendBtn.disabled = false; modalSendBtn.textContent = 'Send Now';
  modalFindBtn.style.display = hasWebsite ? '' : 'none';
  $('modal-ai-btn').classList.toggle('hidden', !state.aiConfigured);
  $('modal-plan-chip').classList.add('hidden');
  modalSuggestions.classList.add('hidden');
  emailModal.classList.remove('hidden');
  modalToInput.focus();
  try {
    const type = action === 'followup' ? 'followup' : 'outreach';
    const preview = await api('GET', `/api/leads/${id}/preview?type=${type}`);
    if (modalLeadId !== id) return; // modal was closed/switched while loading
    modalSubject.value = preview.subject;
    modalBodyEl.value  = preview.body;
    if (!modalToInput.value && preview.to) modalToInput.value = preview.to;
    if (preview.recommended_plan) {
      $('modal-plan-chip').innerHTML =
        `🎯 Best-fit plan: <b>${esc(preview.recommended_plan.name)}</b> — ${esc(preview.recommended_plan.price)}` +
        `<span class="plan-chip-reason">${esc(preview.recommended_plan.reason || '')}</span>`;
      $('modal-plan-chip').classList.remove('hidden');
    }
    // With an AI key configured, automatically write the personalized pitch
    // for this plan — the template above stays as the instant fallback.
    if (state.aiConfigured) onAiPersonalize();
  } catch (err) {
    modalSubject.value = 'Failed to load preview';
    showToast('Preview error: ' + err.message, 'error');
  }
}
function closeEmailModal() { emailModal.classList.add('hidden'); modalLeadId = null; modalAction = null; }

// Replace the template draft with an AI-personalized one (reads their website)
async function onAiPersonalize() {
  if (!modalLeadId) return;
  const btn = $('modal-ai-btn');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinning">⟳</span> Personalizing…';
  try {
    const type = modalAction === 'followup' ? 'followup' : 'outreach';
    const draft = await api('POST', `/api/ai/outreach/${modalLeadId}`, { type });
    modalSubject.value = draft.subject;
    modalBodyEl.value  = draft.body;
    if (!modalToInput.value && draft.to) modalToInput.value = draft.to;
    showToast('Draft personalized ✦ — review before sending', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

/* ─── Confirm modal ──────────────────────────────────────────────────── */
function openConfirm(title, text, onOk) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  confirmFn = onOk;
  $('confirm-modal').classList.remove('hidden');
}
function closeConfirm() { $('confirm-modal').classList.add('hidden'); confirmFn = null; }

/* ─── Actions ────────────────────────────────────────────────────────── */
async function handleAction(btn) {
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'contact' || action === 'followup') return openEmailModal(id, action);

  if (action === 'new-client')  return openClientModal();
  if (action === 'edit-client') {
    const c = state.clients.find(x => String(x.id) === String(id));
    return openClientModal(c || null);
  }
  if (action === 'convert-client') {
    const lead = findLead(id);
    if (!lead) return showToast('Lead not found', 'error');
    return openClientModal(null, lead);
  }
  if (action === 'delete-client') {
    const c = state.clients.find(x => String(x.id) === String(id));
    return openConfirm('Remove client?', `Remove “${c ? c.company : 'this client'}” permanently? Their invoices and history stay in the books.`, async () => {
      try {
        await api('DELETE', `/api/clients/${id}`);
        showToast('Client removed', 'success');
        if (state.clientId) location.hash = '#clients';
        await refresh();
      } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
      closeConfirm();
    });
  }
  if (action === 'task-delete') {
    try {
      await api('DELETE', `/api/tasks/${id}`);
      await refreshToday();
      if (state.view === 'clients' && state.clientId) renderClientDetail(state.clientId);
    } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
    return;
  }

  if (action === 'export-csv') {
    window.location = `/api/export/${btn.dataset.kind}.csv`;
    return;
  }
  if (action === 'copy-report-link') {
    try {
      await navigator.clipboard.writeText(reportUrl(btn.dataset.token));
      showToast('Report link copied 📋', 'success');
    } catch { showToast('Copy failed — select the link manually', 'error'); }
    return;
  }
  if (action === 'regen-report-token') {
    btn.disabled = true;
    try {
      await api('POST', `/api/clients/${id}/report-token`);
      showToast('Report link ready — copy and share it', 'success');
      await refresh();
      if (state.clientId) renderClientDetail(state.clientId);
    } catch (err) { showToast('Failed: ' + err.message, 'error'); btn.disabled = false; }
    return;
  }
  if (action === 'revoke-report-token') {
    return openConfirm('Revoke report link?', 'The shared link will stop working immediately. You can generate a new one any time.', async () => {
      try {
        await api('DELETE', `/api/clients/${id}/report-token`);
        showToast('Report link revoked', 'success');
        await refresh();
        if (state.clientId) renderClientDetail(state.clientId);
      } catch (err) { showToast('Failed: ' + err.message, 'error'); }
      closeConfirm();
    });
  }

  if (action === 'ai-brief')          return openBriefModal(id);
  if (action === 'ai-digest-refresh') {
    state.digest = null;
    renderDigest();
    return loadDigest(true);
  }

  if (action === 'new-invoice')  return openInvoiceModal(null, btn.dataset.clientId || null);
  if (action === 'edit-invoice') {
    const inv = state.invoices.find(x => String(x.id) === String(id));
    return openInvoiceModal(inv || null);
  }
  if (action === 'send-invoice') {
    const inv = state.invoices.find(x => String(x.id) === String(id));
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinning">⟳</span>';
    try {
      await api('POST', `/api/invoices/${id}/send`);
      showToast(`Invoice ${inv ? inv.number : ''} sent ✉`, 'success');
      await refresh();
    } catch (err) {
      showToast('Send failed: ' + err.message, 'error');
      btn.disabled = false; btn.innerHTML = orig;
    }
    return;
  }
  if (action === 'mark-paid') {
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinning">⟳</span>';
    try {
      await api('PUT', `/api/invoices/${id}`, { status: 'paid' });
      showToast('Invoice marked paid 💰', 'success');
      await refresh();
    } catch (err) {
      showToast('Update failed: ' + err.message, 'error');
      btn.disabled = false; btn.innerHTML = orig;
    }
    return;
  }
  if (action === 'delete-invoice') {
    const inv = state.invoices.find(x => String(x.id) === String(id));
    return openConfirm('Delete invoice?', `Delete ${inv ? inv.number : 'this invoice'}? Paid transactions stay in the books.`, async () => {
      try { await api('DELETE', `/api/invoices/${id}`); showToast('Invoice deleted', 'success'); await refresh(); }
      catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
      closeConfirm();
    });
  }
  if (action === 'delete-transaction') {
    try {
      await api('DELETE', `/api/transactions/${id}`);
      await refresh();
    } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
    return;
  }

  if (action === 'outcome-good') return setCallOutcome(id, 'good', btn);
  if (action === 'outcome-bad')  return setCallOutcome(id, 'bad', btn);

  if (action === 'delete') {
    const lead = findLead(id);
    return openConfirm('Delete lead?', `Remove “${lead ? lead.business_name : 'this lead'}” permanently? This cannot be undone.`, async () => {
      try { await api('DELETE', `/api/leads/${id}`); showToast('Lead deleted', 'success'); await refresh(); }
      catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
      closeConfirm();
    });
  }

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinning">⟳</span>';
  try {
    if (action === 'replied' || action === 'converted') {
      await api('PUT', `/api/leads/${id}`, { status: action });
      showToast(action === 'converted' ? 'Marked as won!' : 'Marked as replied', 'success');
    }
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false; btn.innerHTML = original;
  }
}

async function handleEmailSave(input) {
  const id = input.dataset.id;
  const email = input.value.trim();
  const lead = findLead(id);
  if (lead && (lead.email || '') === email) return;
  try { await api('PUT', `/api/leads/${id}`, { email }); if (lead) lead.email = email; if (email) showToast('Email saved', 'success'); }
  catch (err) { showToast('Failed to save email: ' + err.message, 'error'); }
}

async function handleNotesSave(ta) {
  const id = ta.dataset.id;
  const notes = ta.value;
  const lead = findLead(id);
  if (lead && (lead.notes || '') === notes) return;
  try { await api('PUT', `/api/leads/${id}`, { notes }); syncLeadField(id, 'notes', notes); }
  catch (err) { showToast('Failed to save notes: ' + err.message, 'error'); }
}

async function handleOwnerSave(input) {
  const id = input.dataset.id;
  const owner_name = input.value.trim();
  const lead = findLead(id);
  if (lead && (lead.owner_name || '') === owner_name) return;
  try { await api('PUT', `/api/leads/${id}`, { owner_name }); syncLeadField(id, 'owner_name', owner_name); }
  catch (err) { showToast('Failed to save owner: ' + err.message, 'error'); }
}

// state.leads and state.sessions[].leads are separate object graphs (two API
// calls) — keep an edited field in sync across both so re-renders stay correct.
function syncLeadField(id, field, value) {
  id = String(id);
  const l = findLead(id);
  if (l) l[field] = value;
  for (const s of state.sessions) {
    const sl = (s.leads || []).find(x => String(x.id) === id);
    if (sl) sl[field] = value;
  }
}

// Expand/collapse a scraper lead row without a full re-render, so the panel
// stays open across other actions. Expanded ids live in state so renders persist.
function toggleLeadRow(id) {
  id = String(id);
  const set = state.expandedLeads;
  const open = !set.has(id);
  if (open) set.add(id); else set.delete(id);
  const bar = document.querySelector(`[data-lead-row="${CSS.escape(id)}"]`);
  const detail = document.querySelector(`[data-detail-for="${CSS.escape(id)}"]`);
  if (bar) bar.classList.toggle('expanded', open);
  if (detail) detail.classList.toggle('open', open);
}

// Green ✓ / red ✕ call outcome. Clicking the active one again clears it.
async function setCallOutcome(id, outcome, btn) {
  id = String(id);
  const lead = findLead(id) || findScraperLead(id);
  const next = lead && lead.call_outcome === outcome ? null : outcome;
  try {
    await api('PUT', `/api/leads/${id}`, { call_outcome: next });
    syncLeadField(id, 'call_outcome', next);
    applyOutcomeStyling(id, next);
    showToast(next === 'good' ? 'Marked as a good call' : next === 'bad' ? 'Marked as a bad call' : 'Call outcome cleared', 'success');
  } catch (err) { showToast('Failed to save outcome: ' + err.message, 'error'); }
}

// Recolor the bar + detail rows and the toggle buttons in place.
function applyOutcomeStyling(id, outcome) {
  id = String(id);
  const rows = document.querySelectorAll(`[data-lead-row="${CSS.escape(id)}"], [data-detail-for="${CSS.escape(id)}"]`);
  rows.forEach(r => {
    r.classList.toggle('outcome-good', outcome === 'good');
    r.classList.toggle('outcome-bad', outcome === 'bad');
  });
  const good = document.querySelector(`.outcome-btn-good[data-id="${CSS.escape(id)}"]`);
  const bad  = document.querySelector(`.outcome-btn-bad[data-id="${CSS.escape(id)}"]`);
  if (good) { good.classList.toggle('active', outcome === 'good'); good.setAttribute('aria-pressed', outcome === 'good'); }
  if (bad)  { bad.classList.toggle('active', outcome === 'bad');   bad.setAttribute('aria-pressed', outcome === 'bad'); }
}

function findScraperLead(id) {
  id = String(id);
  for (const s of state.sessions) {
    const l = (s.leads || []).find(x => String(x.id) === id);
    if (l) return l;
  }
  return null;
}

/* ─── Static event wiring ────────────────────────────────────────────── */
function wireStaticEvents() {
  window.addEventListener('hashchange', route);

  // Restore last view if no hash
  if (!location.hash) {
    const last = localStorage.getItem('bs_view');
    if (last && VIEWS[last]) location.hash = '#' + last;
  }

  $('menu-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
  $('quick-scrape-btn').addEventListener('click', () => {
    location.hash = '#scraper';
    setTimeout(() => $('scrape-query') && $('scrape-query').focus(), 60);
  });

  // Global search
  globalSearch.addEventListener('input', () => {
    state.search = globalSearch.value.trim().toLowerCase();
    if (['outreach', 'pipeline', 'scraper', 'overview', 'clients'].includes(state.view)) renderCurrentView();
  });

  // Delegated clicks across content + nav (cards navigate via data-goto)
  document.body.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { location.hash = '#' + goto.dataset.goto; return; }

    const header = e.target.closest('.session-header');
    if (header) { header.closest('.session-accordion').classList.toggle('open'); return; }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn && !actionBtn.disabled) { handleAction(actionBtn); return; }

    // Click a scraper lead bar to expand/collapse its detail panel.
    const leadRow = e.target.closest('[data-lead-row]');
    if (leadRow && !e.target.closest('a, button, input, textarea, [data-action]')) {
      toggleLeadRow(leadRow.dataset.leadRow);
      return;
    }

    const clientRow = e.target.closest('[data-goto-client]');
    if (clientRow && !e.target.closest('input, textarea, a')) {
      location.hash = '#clients/' + clientRow.dataset.gotoClient;
      return;
    }

    const pill = e.target.closest('#outreach-filters .pill');
    if (pill) { state.outreachFilter = pill.dataset.filter; renderOutreach(); return; }
  });

  // Task checkboxes (Today panel + client detail) — delegated change
  document.body.addEventListener('change', async (e) => {
    if (e.target.matches('input[data-task-id]')) {
      const id = e.target.dataset.taskId;
      try {
        await api('PUT', `/api/tasks/${id}`, { done: e.target.checked });
        if (e.target.checked) showToast('Task completed ✓', 'success');
        await refreshToday();
        if (state.view === 'clients' && state.clientId) renderClientDetail(state.clientId);
      } catch (err) { showToast('Task update failed: ' + err.message, 'error'); }
    }
  });

  // Quick-add task form (Overview → Today panel)
  $('task-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('task-add-input').value.trim();
    if (!title) return;
    const due = $('task-add-date').value || null;
    try {
      await api('POST', '/api/tasks', { title, due_date: due });
      $('task-add-input').value = '';
      $('task-add-date').value = '';
      await refreshToday();
    } catch (err) { showToast('Failed to add task: ' + err.message, 'error'); }
  });

  // Delegated blur saves (capture — blur doesn't bubble)
  document.body.addEventListener('blur', (e) => {
    if (e.target.classList && e.target.classList.contains('email-input')) handleEmailSave(e.target);
    else if (e.target.classList && e.target.classList.contains('owner-input')) handleOwnerSave(e.target);
    else if (e.target.tagName === 'TEXTAREA' && e.target.dataset.id) handleNotesSave(e.target);
  }, true);

  // Scrape form
  $('scrape-form').addEventListener('submit', onScrapeSubmit);

  // Settings form
  $('settings-form').addEventListener('submit', onSettingsSubmit);

  // Email modal
  $('modal-close').addEventListener('click', closeEmailModal);
  $('modal-cancel').addEventListener('click', closeEmailModal);
  emailModal.addEventListener('click', (e) => { if (e.target === emailModal) closeEmailModal(); });
  modalFindBtn.addEventListener('click', onFindEmail);
  modalSendBtn.addEventListener('click', onSendEmail);

  // Confirm modal
  $('confirm-cancel').addEventListener('click', closeConfirm);
  $('confirm-ok').addEventListener('click', () => { if (confirmFn) confirmFn(); });
  $('confirm-modal').addEventListener('click', (e) => { if (e.target.id === 'confirm-modal') closeConfirm(); });

  // Client modal
  $('client-modal-close').addEventListener('click', closeClientModal);
  $('client-modal-cancel').addEventListener('click', closeClientModal);
  $('client-modal').addEventListener('click', (e) => { if (e.target.id === 'client-modal') closeClientModal(); });
  $('client-modal-save').addEventListener('click', onClientSave);

  // AI: ask form, personalize button, brief modal, settings form
  $('ask-form').addEventListener('submit', onAskSubmit);
  $('modal-ai-btn').addEventListener('click', onAiPersonalize);
  $('brief-modal-close').addEventListener('click', closeBriefModal);
  $('brief-modal-ok').addEventListener('click', closeBriefModal);
  $('brief-modal').addEventListener('click', (e) => { if (e.target.id === 'brief-modal') closeBriefModal(); });
  $('brief-modal-refresh').addEventListener('click', () => { if (briefLeadId) openBriefModal(briefLeadId, true); });
  $('ai-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('set-anthropic-key').value.trim();
    if (!key) return showToast('Paste your Claude API key first', 'error');
    try {
      state.settings = await api('PUT', '/api/settings', { anthropic_api_key: key });
      const status = await api('GET', '/api/ai/status');
      state.aiConfigured = !!status.configured;
      hydrateSettingsForm();
      updateAiStatusLine();
      const flag = $('ai-settings-saved');
      flag.classList.remove('hidden');
      setTimeout(() => flag.classList.add('hidden'), 2200);
      showToast('Claude API key saved — AI features unlocked ✦', 'success');
    } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
  });

  // Command palette
  $('cmdk').addEventListener('click', (e) => {
    if (e.target.id === 'cmdk') return closeCmdk();
    const item = e.target.closest('.cmdk-item');
    if (item) cmdkRun(Number(item.dataset.idx));
  });
  $('cmdk-input').addEventListener('input', () => { cmdkSelected = 0; renderCmdkResults($('cmdk-input').value.trim()); });
  $('cmdk-input').addEventListener('keydown', (e) => {
    const count = document.querySelectorAll('.cmdk-item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSelected = Math.min(cmdkSelected + 1, count - 1); renderCmdkResults($('cmdk-input').value.trim()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSelected = Math.max(cmdkSelected - 1, 0); renderCmdkResults($('cmdk-input').value.trim()); }
    else if (e.key === 'Enter') { e.preventDefault(); cmdkRun(cmdkSelected); }
  });

  // Notifications bell
  $('bell').addEventListener('click', (e) => { e.stopPropagation(); toggleNotifDropdown(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bell-wrap')) toggleNotifDropdown(true);
  });

  // Tracking settings form
  $('tracking-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.settings = await api('PUT', '/api/settings', {
        app_base_url:     $('set-app-base-url').value.trim(),
        tracking_enabled: $('set-tracking-enabled').checked ? 'true' : 'false',
      });
      const flag = $('tracking-settings-saved');
      flag.classList.remove('hidden');
      setTimeout(() => flag.classList.add('hidden'), 2200);
      showToast('Tracking settings saved', 'success');
    } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
  });

  // Sending pace form
  $('pace-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gapMin = parseInt($('set-gap-min').value, 10);
    const gapMax = parseInt($('set-gap-max').value, 10);
    const cap    = parseInt($('set-daily-cap').value, 10);
    if (Number.isFinite(gapMin) && Number.isFinite(gapMax) && gapMax < gapMin) {
      return showToast('Max gap must be greater than or equal to min gap', 'error');
    }
    try {
      state.settings = await api('PUT', '/api/settings', {
        email_gap_min_sec: String(gapMin || 120),
        email_gap_max_sec: String(gapMax || 300),
        email_daily_cap:   String(cap || 40),
        send_window_start: $('set-window-start').value || '08:30',
        send_window_end:   $('set-window-end').value   || '18:30',
      });
      const flag = $('pace-settings-saved');
      flag.classList.remove('hidden');
      setTimeout(() => flag.classList.add('hidden'), 2200);
      showToast('Sending pace saved', 'success');
    } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
  });

  // Send queue panel
  $('send-queue-refresh')?.addEventListener('click', renderSendQueue);
  $('send-queue-clear')?.addEventListener('click', async () => {
    if (!confirm('Cancel all pending emails in the queue?')) return;
    try { await api('DELETE', '/api/email-queue'); showToast('Queue cleared', 'success'); renderSendQueue(); refresh(); }
    catch (err) { showToast('Failed: ' + err.message, 'error'); }
  });
  $('send-queue-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="cancel-queue"]');
    if (!btn) return;
    try { await api('DELETE', '/api/email-queue/' + btn.dataset.id); renderSendQueue(); refresh(); }
    catch (err) { showToast('Failed: ' + err.message, 'error'); }
  });

  // Invoice modal
  $('invoice-modal-close').addEventListener('click', closeInvoiceModal);
  $('invoice-modal-cancel').addEventListener('click', closeInvoiceModal);
  $('invoice-modal').addEventListener('click', (e) => { if (e.target.id === 'invoice-modal') closeInvoiceModal(); });
  $('invoice-modal-save').addEventListener('click', onInvoiceSave);
  $('iv-add-line').addEventListener('click', () => {
    $('iv-lines').insertAdjacentHTML('beforeend', ivLineRow());
    ivRecalcTotals();
  });
  $('iv-package').addEventListener('change', () => {
    const pkg = PACKAGES[Number($('iv-package').value)];
    if (!pkg) return;
    $('iv-lines').innerHTML = pkg.items.map(ivLineRow).join('');
    ivRecalcTotals();
  });
  $('invoice-modal').addEventListener('click', (e) => {
    const rm = e.target.closest('.iv-remove-line');
    if (rm) { rm.closest('.line-item-row').remove(); ivRecalcTotals(); }
  });
  $('invoice-modal').addEventListener('input', (e) => {
    if (e.target.matches('.iv-qty, .iv-price, .iv-desc, #iv-tax')) ivRecalcTotals();
  });
  $('iv-client').addEventListener('change', () => {
    // New invoice with one untouched default line → re-prefill from the selected client
    if (invoiceModalId) return;
    const rows = document.querySelectorAll('#iv-lines .line-item-row');
    if (rows.length !== 1) return;
    const client = state.clients.find(c => String(c.id) === String($('iv-client').value));
    if (!client) return;
    rows[0].querySelector('.iv-desc').value  = client.service_description || 'Monthly retainer';
    rows[0].querySelector('.iv-price').value = client.monthly_retainer || '';
    ivRecalcTotals();
  });

  // Transactions: filter pills + quick-add form
  document.body.addEventListener('click', (e) => {
    const pill = e.target.closest('#tx-filters .pill');
    if (pill) { state.txFilter = pill.dataset.txFilter; renderTxTable(); }
  });
  $('tx-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      type:        $('tx-type').value,
      category:    $('tx-category').value.trim(),
      amount:      Number($('tx-amount').value),
      date:        $('tx-date').value,
      description: $('tx-desc').value.trim() || null,
    };
    if (!payload.category || !payload.amount || !payload.date) {
      return showToast('Category, amount and date are required', 'error');
    }
    try {
      await api('POST', '/api/transactions', payload);
      $('tx-category').value = ''; $('tx-amount').value = ''; $('tx-desc').value = '';
      showToast('Transaction logged', 'success');
      await refresh();
    } catch (err) { showToast('Failed to log: ' + err.message, 'error'); }
  });

  // Finance settings form
  $('finance-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state.settings = await api('PUT', '/api/settings', {
        revenue_goal_monthly: $('set-revenue-goal').value.trim(),
        avg_deal_value:       $('set-avg-deal').value.trim(),
        invoice_prefix:       ($('set-invoice-prefix').value.trim() || 'BS').toUpperCase(),
      });
      const flag = $('finance-settings-saved');
      flag.classList.remove('hidden');
      setTimeout(() => flag.classList.add('hidden'), 2200);
      showToast('Finance settings saved', 'success');
      state.finance = await api('GET', '/api/finance/summary');
    } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
  });

  // Esc closes modals · Ctrl/Cmd+K opens the command palette
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeEmailModal(); closeConfirm(); closeClientModal(); closeInvoiceModal(); closeBriefModal(); closeCmdk(); toggleNotifDropdown(true); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmdk(); }
  });
}

function setEmailCellSearching(id) {
  document.querySelectorAll(`[data-email-id="${id}"]`).forEach(cell => {
    cell.innerHTML = `<span class="email-searching">⟳ searching…</span>`;
  });
}

function setEmailCellResult(id, email) {
  document.querySelectorAll(`[data-email-id="${id}"]`).forEach(cell => {
    if (email) {
      cell.innerHTML = `<input type="email" class="email-input" data-id="${id}" value="${esc(email)}" placeholder="Add email…" />`;
    } else {
      cell.innerHTML = `<input type="email" class="email-input" data-id="${id}" value="" placeholder="Add email…" /><span class="email-not-found" title="No email found on website or Facebook">✗ not found</span>`;
    }
  });
}

function setEmailCellSent(id, email) {
  document.querySelectorAll(`[data-email-id="${id}"]`).forEach(cell => {
    cell.innerHTML = `<span class="email-sent" title="${esc(email)}">✓ email sent</span>`;
  });
}

async function autoFindEmails(leads) {
  const toSearch = leads.filter(l => l.website && !l.email && !l.email_searched);
  if (!toSearch.length) { setScrapeStatus('success', '✓ Scrape complete — no emails to search.'); return; }

  toSearch.forEach(l => setEmailCellSearching(l.id));

  const CONCURRENCY = 5;
  let idx = 0;
  let done = 0;
  const foundLeads = [];

  async function next() {
    if (idx >= toSearch.length) return;
    const lead = toSearch[idx++];
    try {
      const { emails } = await api('GET', `/api/leads/${lead.id}/find-email`);
      const email = emails && emails.length ? emails[0] : null;
      if (email) foundLeads.push({ id: lead.id, email });
      setEmailCellResult(lead.id, email);
    } catch {
      setEmailCellResult(lead.id, null);
    }
    done++;
    setScrapeStatus('loading', `⟳ Finding emails… ${done}/${toSearch.length} checked, ${foundLeads.length} found`);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toSearch.length) }, next));

  if (!foundLeads.length) {
    setScrapeStatus('success', `✓ Email search complete — no emails found`);
    await refresh(); // surface any phone numbers scraped from the websites
    return;
  }

  const n = foundLeads.length;
  // Auto-send removed — bulk sending got the sender flagged as spam. Emails and
  // phone numbers are saved to each lead; send manually via the "✉ Send" button.
  setScrapeStatus('success',
    `✓ ${n} email${n !== 1 ? 's' : ''} found and saved — send outreach manually from each lead`
  );
  await refresh();
}

let _queuePollTimer = null;

function startQueueStatusPolling() {
  stopQueueStatusPolling();
  _queuePollTimer = setInterval(async () => {
    try {
      const stats = await api('GET', '/api/email-queue');
      if (stats.pending === 0) {
        stopQueueStatusPolling();
        const total = stats.sent + stats.failed;
        setScrapeStatus('success', stats.failed > 0
          ? `✓ Queue done — ${stats.sent} sent, ${stats.failed} failed`
          : `✓ Queue done — all ${stats.sent} emails sent`);
      } else {
        setScrapeStatusHtml('loading',
          `⟳ Queue: ${stats.pending} pending · ${stats.sent_24h ?? 0}/${state.settings.email_daily_cap || 40} sent today · ${stats.failed} failed — <button class="send-queue-btn" style="background:#555" onclick="cancelEmailQueue(this)">Cancel remaining</button>`
        );
      }
    } catch {}
  }, 30_000);
}

function stopQueueStatusPolling() {
  if (_queuePollTimer) { clearInterval(_queuePollTimer); _queuePollTimer = null; }
}

async function sendOutreachQueue(btn) {
  const queue = window._outreachQueue || [];
  if (!queue.length) return;
  window._outreachQueue = [];
  if (btn) btn.disabled = true;

  try {
    const stats = await api('POST', '/api/email-queue', { leadIds: queue.map(q => q.id) });
    setScrapeStatusHtml('success',
      `✓ ${stats.pending} emails queued — the server sends them spaced out (random gap, daily cap) to avoid spam flags. You can close this tab. <button class="send-queue-btn" style="background:#555" onclick="cancelEmailQueue(this)">Cancel queue</button>`
    );
    startQueueStatusPolling();
    refresh();   // reflect the new "Queued" status on the lead rows right away
  } catch (err) {
    setScrapeStatus('error', `✗ Failed to queue: ${err.message}`);
    if (btn) btn.disabled = false;
  }
}

async function cancelEmailQueue(btn) {
  if (btn) btn.disabled = true;
  stopQueueStatusPolling();
  try {
    await api('DELETE', '/api/email-queue');
    setScrapeStatus('success', '✓ Pending emails cancelled');
    refresh();   // clear the "Queued" status now that nothing is pending
  } catch (err) {
    setScrapeStatus('error', `✗ ${err.message}`);
  }
}

async function onScrapeSubmit(e) {
  e.preventDefault();
  const query = $('scrape-query').value.trim();
  const location_ = $('scrape-location').value.trim();
  const maxResults = Number($('scrape-max').value) || 20;
  const allowedTypes = [...document.querySelectorAll('input[name="opp_filter"]:checked')].map(cb => cb.value);
  if (!allowedTypes.length) return setScrapeStatus('error', '✗ Select at least one opportunity type to save.');

  const btn = $('scrape-btn');
  const ico = btn.querySelector('.spin-target');
  setScrapeStatus('loading', `⟳ Scraping “${query}” in ${location_}… this can take 30–90s.`);
  btn.disabled = true; if (ico) ico.classList.add('spinning');
  try {
    const result = await api('POST', '/api/scrape', { query, location: location_, maxResults, allowedTypes });
    const opp = result.by_opportunity || {};
    const parts = [
      opp.NO_WEBSITE && `${opp.NO_WEBSITE} no website`,
      opp.WEAK_ADVERTISING && `${opp.WEAK_ADVERTISING} weak ads`,
      opp.HIGH_POTENTIAL && `${opp.HIGH_POTENTIAL} high potential`,
      opp.SCALING_CANDIDATE && `${opp.SCALING_CANDIDATE} scaling`,
    ].filter(Boolean);
    setScrapeStatus('success', `✓ Saved ${result.saved} new leads — ${parts.join(', ') || 'none classified'} — searching for emails…`);
    await refresh();
    // Use leads from state (have DB ids) rather than scrape result (which lacks ids)
    const newSession = state.sessions.find(s => s.id === result.sessionId);
    if (newSession && newSession.leads && newSession.leads.length) autoFindEmails(newSession.leads);
  } catch (err) {
    setScrapeStatus('error', `✗ Scrape failed: ${err.message}`);
  } finally {
    btn.disabled = false; if (ico) ico.classList.remove('spinning');
  }
}

async function onSettingsSubmit(e) {
  e.preventDefault();
  const payload = {
    sender_name:  $('set-sender-name').value.trim(),
    sender_phone: $('set-sender-phone').value.trim(),
  };
  try {
    state.settings = await api('PUT', '/api/settings', payload);
    const flag = $('settings-saved');
    flag.classList.remove('hidden');
    setTimeout(() => flag.classList.add('hidden'), 2200);
    showToast('Settings saved', 'success');
  } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
}

async function onFindEmail() {
  modalFindBtn.disabled = true; modalFindBtn.textContent = '⟳ Searching…';
  modalSuggestions.classList.add('hidden'); modalSuggestions.innerHTML = '';
  try {
    const { emails, message } = await api('GET', `/api/leads/${modalLeadId}/find-email`);
    if (!emails || !emails.length) { showToast(message || 'No email found on their website', 'error'); return; }
    if (emails.length === 1) { modalToInput.value = emails[0]; showToast(`Email found: ${emails[0]}`, 'success'); return; }
    modalSuggestions.innerHTML = emails.map(em => `<button class="suggestion-btn" data-email="${esc(em)}">${esc(em)}</button>`).join('');
    modalSuggestions.classList.remove('hidden');
    modalSuggestions.querySelectorAll('.suggestion-btn').forEach(b =>
      b.addEventListener('click', () => { modalToInput.value = b.dataset.email; modalSuggestions.classList.add('hidden'); }));
  } catch (err) { showToast('Email search failed: ' + err.message, 'error'); }
  finally { modalFindBtn.disabled = false; modalFindBtn.textContent = 'Find Email'; }
}

async function onSendEmail() {
  const email = modalToInput.value.trim();
  if (!email) return showToast('Enter an email address first', 'error');
  modalSendBtn.disabled = true; modalSendBtn.textContent = '⟳ Sending…';
  try {
    const endpoint = modalAction === 'followup'
      ? `/api/leads/${modalLeadId}/followup`
      : `/api/leads/${modalLeadId}/contact`;
    const result = await api('POST', endpoint, { email, subject: modalSubject.value.trim(), body: modalBodyEl.value.trim() });
    if (result && result.queued) {
      const eta = result.eta_seconds || 0;
      const when = eta <= 90 * 60
        ? `in about ${Math.max(1, Math.round(eta / 60))} min`
        : (result.scheduled_at
            ? `around ${new Date(result.scheduled_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
            : 'shortly');
      let msg;
      if (result.capped)          msg = `Daily send cap reached — queued, sends ${when}`;
      else if (!result.in_window) msg = `Outside sending hours — queued, sends ${when}`;
      else                        msg = `Queued — sends ${when} (spaced out to avoid spam flags)`;
      showToast(msg, 'success');
    } else {
      showToast(modalAction === 'followup' ? 'Follow-up sent!' : 'Outreach email sent!', 'success');
    }
    closeEmailModal();
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    modalSendBtn.disabled = false; modalSendBtn.textContent = 'Send Now';
  }
}

/* ─── Command palette (Ctrl+K) ───────────────────────────────────────── */
let cmdkIndex = [];
let cmdkSelected = 0;

function reportUrl(token) {
  const base = (state.settings.app_base_url || location.origin).replace(/\/+$/, '');
  return `${base}/report/${token}`;
}

function buildCmdkIndex() {
  const items = [];
  for (const [key, v] of Object.entries(VIEWS)) {
    items.push({ kind: 'Go to', label: v.title, hint: v.sub, run: () => { location.hash = '#' + key; } });
  }
  items.push(
    { kind: 'Action', label: 'New scrape', hint: 'Find fresh leads', run: () => { location.hash = '#scraper'; setTimeout(() => $('scrape-query')?.focus(), 80); } },
    { kind: 'Action', label: 'New client', hint: 'Add a client account', run: () => { location.hash = '#clients'; setTimeout(() => openClientModal(), 80); } },
    { kind: 'Action', label: 'New invoice', hint: 'Bill a client', run: () => { location.hash = '#finance'; setTimeout(() => openInvoiceModal(), 80); } },
    { kind: 'Action', label: 'Export leads CSV', hint: 'Download all leads', run: () => { window.location = '/api/export/leads.csv'; } },
  );
  for (const l of state.leads) {
    items.push({ kind: 'Lead', label: l.business_name, hint: `${l.category || ''} · ${STATUS_LABELS[l.status] || l.status}`, run: () => { state.outreachFilter = ''; location.hash = '#outreach'; } });
  }
  for (const c of state.clients) {
    items.push({ kind: 'Client', label: c.company, hint: `${money(c.monthly_retainer)}/mo · ${c.status}`, run: () => { location.hash = '#clients/' + c.id; } });
  }
  for (const inv of state.invoices) {
    items.push({ kind: 'Invoice', label: `${inv.number} — ${inv.client_company}`, hint: `${money2(inv.total)} · ${inv.status}`, run: () => { location.hash = '#finance'; } });
  }
  return items;
}

function openCmdk() {
  cmdkIndex = buildCmdkIndex();
  cmdkSelected = 0;
  $('cmdk-input').value = '';
  renderCmdkResults('');
  $('cmdk').classList.remove('hidden');
  $('cmdk-input').focus();
}

function closeCmdk() { $('cmdk').classList.add('hidden'); }

function cmdkMatches(query) {
  if (!query) return cmdkIndex.slice(0, 9);
  const q = query.toLowerCase();
  return cmdkIndex
    .filter(it => it.label.toLowerCase().includes(q) || it.kind.toLowerCase().includes(q) || (it.hint || '').toLowerCase().includes(q))
    .slice(0, 9);
}

function renderCmdkResults(query) {
  const matches = cmdkMatches(query);
  cmdkSelected = Math.min(cmdkSelected, Math.max(0, matches.length - 1));
  $('cmdk-results').innerHTML = matches.length ? matches.map((it, i) => `
    <li class="cmdk-item ${i === cmdkSelected ? 'selected' : ''}" data-idx="${i}">
      <span class="cmdk-kind">${it.kind}</span>
      <span class="cmdk-label">${esc(it.label)}</span>
      <span class="cmdk-hint-text">${esc(it.hint || '')}</span>
    </li>`).join('') : '<li class="cmdk-empty">No matches</li>';
}

function cmdkRun(idx) {
  const matches = cmdkMatches($('cmdk-input').value.trim());
  const item = matches[idx];
  if (!item) return;
  closeCmdk();
  item.run();
}

/* ─── Notifications bell ─────────────────────────────────────────────── */
function lastSeenActivityId() { return Number(localStorage.getItem('bs_activity_seen') || 0); }

function renderBell() {
  const badge = $('bell-badge');
  if (!badge) return;
  const unread = (state.activity || []).filter(a => a.id > lastSeenActivityId()).length;
  badge.textContent = unread > 9 ? '9+' : unread;
  badge.classList.toggle('hidden', unread === 0);
}

function toggleNotifDropdown(forceClose = false) {
  const dd = $('notif-dropdown');
  if (forceClose || !dd.classList.contains('hidden')) {
    dd.classList.add('hidden');
    return;
  }
  const seen = lastSeenActivityId();
  const items = (state.activity || []).slice(0, 10);
  dd.innerHTML = items.length ? items.map(a => `
    <div class="notif-item ${a.id > seen ? 'unread' : ''}">
      <span class="feed-ico">${ACTIVITY_ICONS[a.type] || '•'}</span>
      <div class="feed-main">
        <div class="feed-msg">${esc(a.message)}</div>
        <div class="feed-time">${timeAgo(a.timestamp)}</div>
      </div>
    </div>`).join('') : '<div class="notif-empty">No notifications yet</div>';
  dd.classList.remove('hidden');
  // Opening marks everything seen
  if (items.length) localStorage.setItem('bs_activity_seen', String(items[0].id));
  renderBell();
}

/* ─── Helpers ────────────────────────────────────────────────────────── */
function filterLeads(leads) {
  if (!state.search) return leads;
  return leads.filter(l =>
    (l.business_name || '').toLowerCase().includes(state.search) ||
    (l.category || '').toLowerCase().includes(state.search));
}
function findLead(id) { return state.leads.find(l => String(l.id) === String(id)) || null; }

function renderAgentDots() {
  // Agents are always "active"; reserved for future per-agent health states.
  document.querySelectorAll('.agent-dot').forEach(d => { d.style.background = 'var(--accent)'; });
}

function setScrapeStatus(type, msg) {
  const el = $('scrape-status');
  el.textContent = msg; el.className = `scrape-status ${type}`; el.classList.remove('hidden');
}
function setScrapeStatusHtml(type, html) {
  const el = $('scrape-status');
  el.innerHTML = html; el.className = `scrape-status ${type}`; el.classList.remove('hidden');
}

function setConn(online) {
  connStatus.className = 'conn ' + (online ? 'online' : 'offline');
  connStatus.querySelector('.conn-text').textContent = online ? 'Workspace synced' : 'Connection lost';
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function timeAgo(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dueLabel(date, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!date) return '';
  const d = date.slice(0, 10);
  const pretty = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (d < todayIso) return 'Overdue · ' + pretty;
  if (d === todayIso) return 'Due today';
  return 'Due ' + pretty;
}

function ratingStars(rating) {
  const full = Math.round(rating || 0);
  return '★'.repeat(Math.min(full, 5)) + '☆'.repeat(Math.max(0, 5 - full));
}
function oppBadge(opp) {
  if (!opp) return '<span class="badge badge-opp badge-opp-unknown">Unknown</span>';
  return `<span class="badge badge-opp badge-opp-${opp}">${OPP_LABELS[opp] || opp}</span>`;
}

function scoreBadge(score) {
  if (score == null) return '';
  const tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
  return `<span class="score-badge score-${tier}" title="Lead score ${score}/100 — rating, reviews, website, email & opportunity fit">${score}</span>`;
}

function engagementDot(lead) {
  if (!lead.last_email_sent_at) return '';
  if (lead.last_email_opened_at) {
    return `<span class="eng-dot opened" title="Email opened ${timeAgo(lead.last_email_opened_at)}">👁</span>`;
  }
  return `<span class="eng-dot sent" title="Email sent ${timeAgo(lead.last_email_sent_at)} — not opened yet"></span>`;
}
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

/* ─── Boot (after all declarations are initialized) ──────────────────── */
initChartDefaults();
wireStaticEvents();
route();        // read hash → set initial view
loadAll();      // fetch data → render
