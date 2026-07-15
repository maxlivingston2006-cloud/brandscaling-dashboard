/**
 * Public client report — a polished, read-only results page served at
 * /report/:token (no login). Everything is server-rendered and HTML-escaped;
 * the token is the only credential.
 */
const { getTasks, getActivity, getLeadById, getAllInvoices } = require('./database');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmtMoney = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

async function gatherReportData(client) {
  const [tasks, activity, sourceLead, invoices] = await Promise.all([
    getTasks({ client_id: client.id }),
    getActivity(60, { client_id: client.id, lead_id: client.lead_id || -1 }),
    client.lead_id ? getLeadById(client.lead_id) : null,
    getAllInvoices({ client_id: client.id }),
  ]);
  return {
    tasksDone:  tasks.filter(t => t.done).length,
    tasksOpen:  tasks.filter(t => !t.done).length,
    activity:   activity.filter(a => a.type !== 'invoice_paid' && a.type !== 'invoice_sent').slice(0, 20),
    sourceLead,
    totalPaid:  invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0),
    monthsActive: client.start_date
      ? Math.max(1, Math.round((Date.now() - new Date(client.start_date)) / (30 * 86400000)))
      : 1,
  };
}

const TYPE_LABELS = {
  scrape: 'Research', email_sent: 'Outreach sent', email_opened: 'Engagement',
  reply_detected: 'Response received', status_change: 'Progress update',
  client_added: 'Engagement started', task_done: 'Deliverable completed',
};

function buildReportHtml(client, data, settings = {}) {
  const senderName  = settings.sender_name  || 'Our Team';
  const companyName = settings.company_name || process.env.COMPANY_NAME || 'Your Agency';

  const timeline = data.activity.length ? data.activity.map(a => `
    <div class="ev">
      <div class="ev-dot"></div>
      <div class="ev-body">
        <div class="ev-type">${esc(TYPE_LABELS[a.type] || 'Update')}</div>
        <div class="ev-msg">${esc(a.message)}</div>
        <div class="ev-time">${fmtDate(a.timestamp)}</div>
      </div>
    </div>`).join('') : '<p class="muted">Detailed activity will appear here as the engagement progresses.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(client.company)} × ${esc(companyName)} — Engagement Report</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root { --bg:#020617; --surface:#0f172a; --s2:#131c30; --border:#1e2a44; --text:#f8fafc; --muted:#8595b3; --accent:#22c55e; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', system-ui, sans-serif; line-height: 1.6; }
  body::before { content:''; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(800px 400px at 80% -10%, rgba(34,197,94,.12), transparent 60%); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 22px 80px; position: relative; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 42px; }
  .mark { width: 42px; height: 42px; display: grid; place-items: center; font-weight: 800; font-size: 20px;
    color: #04140a; background: linear-gradient(135deg, #22c55e, #16a34a); border-radius: 12px; }
  .brand b { font-size: 17px; } .brand small { display: block; font-size: 11px; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-size: 30px; letter-spacing: -.02em; line-height: 1.2; margin-bottom: 8px; }
  .sub { color: var(--muted); font-size: 15px; margin-bottom: 36px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 40px; }
  .stat { background: linear-gradient(180deg, var(--surface), #0b1220); border: 1px solid var(--border); border-radius: 16px; padding: 18px; }
  .stat .v { font-size: 26px; font-weight: 800; color: var(--accent); }
  .stat .l { font-size: 12px; color: var(--muted); font-weight: 600; margin-top: 2px; }
  h2 { font-size: 16px; margin: 34px 0 16px; }
  .panel { background: linear-gradient(180deg, var(--surface), #0b1220); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
  .ev { display: flex; gap: 14px; padding: 12px 0; position: relative; }
  .ev:not(:last-child)::after { content:''; position: absolute; left: 5px; top: 30px; bottom: -6px; width: 1px; background: var(--border); }
  .ev-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px rgba(34,197,94,.4); margin-top: 6px; flex-shrink: 0; }
  .ev-type { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
  .ev-msg { font-size: 14px; color: #c2cce0; }
  .ev-time { font-size: 12px; color: var(--muted); }
  .muted { color: var(--muted); font-size: 14px; }
  .service { font-size: 14.5px; color: #c2cce0; }
  .footer { margin-top: 48px; padding-top: 22px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
  .footer b { color: var(--text); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="mark">${esc(companyName.charAt(0).toUpperCase())}</div>
      <div><b>${esc(companyName)}</b><small>Engagement Report</small></div>
    </div>

    <h1>${esc(client.company)}</h1>
    <p class="sub">Prepared ${fmtDate(new Date().toISOString())} · Partner since ${fmtDate(client.start_date)}</p>

    <div class="stats">
      <div class="stat"><div class="v">${data.monthsActive}</div><div class="l">month${data.monthsActive === 1 ? '' : 's'} working together</div></div>
      <div class="stat"><div class="v">${data.tasksDone}</div><div class="l">deliverables completed</div></div>
      <div class="stat"><div class="v">${data.tasksOpen}</div><div class="l">in progress</div></div>
      <div class="stat"><div class="v">${fmtMoney(data.totalPaid)}</div><div class="l">invested to date</div></div>
    </div>

    ${client.service_description ? `
    <h2>Scope of work</h2>
    <div class="panel"><p class="service">${esc(client.service_description)}</p></div>` : ''}

    <h2>Engagement timeline</h2>
    <div class="panel">${timeline}</div>

    <div class="footer">
      Questions about this report? Reach out any time.<br/>
      <b>${esc(senderName)}</b> · ${esc(companyName)}
    </div>
  </div>
</body>
</html>`;
}

function build404Html() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Report not found</title>
<style>body{background:#020617;color:#f8fafc;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
.box{text-align:center;padding:20px}.box h1{font-size:22px}.box p{color:#8595b3}</style></head>
<body><div class="box"><h1>This report link is no longer active</h1>
<p>It may have been revoked or replaced. Ask your contact for a fresh link.</p></div></body></html>`;
}

module.exports = { gatherReportData, buildReportHtml, build404Html };
