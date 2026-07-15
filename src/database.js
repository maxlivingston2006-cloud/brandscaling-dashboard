const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'leads.db');

// Ensure the parent directory exists. On Railway, DATABASE_PATH should point at
// a mounted persistent volume (e.g. /data/leads.db) so leads survive redeploys.
// Without this the first write to a non-existent /data would crash on boot.
const DB_DIR = path.dirname(DB_PATH);
try {
  if (DB_DIR && DB_DIR !== '.' && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log(`[db] created data directory: ${DB_DIR}`);
  }
} catch (err) {
  console.error(`[db] WARN: could not create data directory ${DB_DIR}:`, err.message);
}

console.log(`[db] opening database at: ${DB_PATH}`);
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`[db] FATAL: cannot open database at ${DB_PATH}:`, err.message);
    process.exit(1);
  }
  console.log('[db] connected');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT    NOT NULL,
      location   TEXT    NOT NULL,
      timestamp  TEXT    NOT NULL,
      lead_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Shared key/value settings (sender name/phone, default filters, etc.) so both
  // partners see the same configuration — persisted in the DB, not per-browser.
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name    TEXT    NOT NULL,
      category         TEXT    NOT NULL,
      address          TEXT    NOT NULL,
      phone            TEXT    NOT NULL,
      website          TEXT,
      google_rating    REAL    NOT NULL,
      review_count     INTEGER NOT NULL,
      email            TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'new',
      opportunity_type TEXT,
      notes            TEXT,
      date_added       TEXT    NOT NULL,
      date_contacted   TEXT,
      follow_up_date   TEXT,
      session_id       INTEGER REFERENCES sessions(id)
    )
  `);

  // Migrations for existing databases
  for (const col of [
    'ALTER TABLE leads ADD COLUMN opportunity_type TEXT',
    'ALTER TABLE leads ADD COLUMN session_id INTEGER',
    'ALTER TABLE leads ADD COLUMN website_status TEXT',
    'ALTER TABLE leads ADD COLUMN score INTEGER',
    'ALTER TABLE leads ADD COLUMN ai_brief TEXT',
    'ALTER TABLE leads ADD COLUMN email_searched INTEGER DEFAULT 0',
    'ALTER TABLE leads ADD COLUMN owner_name TEXT',
    'ALTER TABLE leads ADD COLUMN call_outcome TEXT',
  ]) {
    db.run(col, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Migration error:', err.message);
      }
    });
  }

  // Remove duplicate rows, keep oldest per business
  db.run(`
    DELETE FROM leads WHERE id NOT IN (
      SELECT MIN(id) FROM leads GROUP BY LOWER(business_name), LOWER(address)
    )
  `);

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_unique
    ON leads (LOWER(business_name), LOWER(address))
  `);

  // ── Enterprise tables — clients, finance, tasks, activity, engagement ──
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      company             TEXT    NOT NULL,
      contact_name        TEXT,
      email               TEXT,
      phone               TEXT,
      lead_id             INTEGER REFERENCES leads(id),
      service_description TEXT,
      monthly_retainer    REAL    NOT NULL DEFAULT 0,
      status              TEXT    NOT NULL DEFAULT 'active',
      start_date          TEXT,
      notes               TEXT,
      report_token        TEXT,
      created_at          TEXT    NOT NULL
    )
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_report_token
    ON clients (report_token) WHERE report_token IS NOT NULL
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id  INTEGER NOT NULL REFERENCES clients(id),
      number     TEXT    NOT NULL UNIQUE,
      line_items TEXT    NOT NULL DEFAULT '[]',
      subtotal   REAL    NOT NULL DEFAULT 0,
      tax_rate   REAL    NOT NULL DEFAULT 0,
      total      REAL    NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'draft',
      issue_date TEXT,
      due_date   TEXT,
      paid_date  TEXT,
      notes      TEXT,
      created_at TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      amount      REAL    NOT NULL,
      date        TEXT    NOT NULL,
      description TEXT,
      client_id   INTEGER REFERENCES clients(id),
      invoice_id  INTEGER REFERENCES invoices(id),
      recurring   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      due_date   TEXT,
      done       INTEGER NOT NULL DEFAULT 0,
      lead_id    INTEGER REFERENCES leads(id),
      client_id  INTEGER REFERENCES clients(id),
      created_at TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT    NOT NULL,
      message    TEXT    NOT NULL,
      lead_id    INTEGER,
      client_id  INTEGER,
      invoice_id INTEGER,
      timestamp  TEXT    NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id    INTEGER REFERENCES leads(id),
      token      TEXT    NOT NULL UNIQUE,
      email_type TEXT    NOT NULL,
      sent_at    TEXT    NOT NULL,
      opened_at  TEXT,
      open_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id    INTEGER NOT NULL REFERENCES leads(id),
      type       TEXT    NOT NULL DEFAULT 'outreach',
      status     TEXT    NOT NULL DEFAULT 'pending',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      sent_at    TEXT,
      error      TEXT
    )
  `);

  // Additive migrations for email_queue: per-item edited copy + projected send time
  for (const col of [
    'ALTER TABLE email_queue ADD COLUMN subject TEXT',
    'ALTER TABLE email_queue ADD COLUMN body TEXT',
    'ALTER TABLE email_queue ADD COLUMN scheduled_at TEXT',
  ]) {
    db.run(col, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Migration error:', err.message);
      }
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
async function createSession(query, location) {
  return run(
    'INSERT INTO sessions (query, location, timestamp) VALUES (?, ?, ?)',
    [query, location, new Date().toISOString()]
  );
}

async function updateSessionLeadCount(id, lead_count) {
  return run('UPDATE sessions SET lead_count = ? WHERE id = ?', [lead_count, id]);
}

async function getAllSessions() {
  return all('SELECT * FROM sessions ORDER BY timestamp DESC');
}

// `queued` = 1 when an email for this lead is still waiting in the send queue,
// so the UI can flag it and block a second (duplicate) send.
const QUEUED_FLAG =
  `, EXISTS(SELECT 1 FROM email_queue q WHERE q.lead_id = leads.id AND q.status = 'pending') AS queued`;

async function getSessionLeads(session_id) {
  return all(`SELECT *${QUEUED_FLAG} FROM leads WHERE session_id = ? ORDER BY date_added DESC`, [session_id]);
}

async function getUnsessionedLeads() {
  return all(`SELECT *${QUEUED_FLAG} FROM leads WHERE session_id IS NULL ORDER BY date_added DESC`);
}

async function deleteSession(id) {
  await run('DELETE FROM leads WHERE session_id = ?', [id]);
  return run('DELETE FROM sessions WHERE id = ?', [id]);
}

// ─── Leads ────────────────────────────────────────────────────────────────────
// Includes engagement columns from the latest tracked email per lead
async function getAllLeads() {
  return all(`
    SELECT l.*, e.sent_at AS last_email_sent_at, e.opened_at AS last_email_opened_at,
           EXISTS(SELECT 1 FROM email_queue q WHERE q.lead_id = l.id AND q.status = 'pending') AS queued
    FROM leads l
    LEFT JOIN (
      SELECT lead_id, MAX(sent_at) AS sent_at,
             MAX(opened_at) AS opened_at
      FROM email_events GROUP BY lead_id
    ) e ON e.lead_id = l.id
    ORDER BY l.date_added DESC
  `);
}

async function getLeadById(id) {
  return get('SELECT * FROM leads WHERE id = ?', [id]);
}

async function insertLead(lead) {
  const {
    business_name, category, address, phone,
    website = null, google_rating, review_count,
    email, opportunity_type = null, notes = null,
    session_id = null, website_status = null,
    date_added = new Date().toISOString(),
    date_contacted = null, follow_up_date = null,
  } = lead;

  return run(
    `INSERT OR IGNORE INTO leads
      (business_name, category, address, phone, website, google_rating,
       review_count, email, opportunity_type, notes, session_id, website_status,
       date_added, date_contacted, follow_up_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [business_name, category, address, phone, website, google_rating,
     review_count, email, opportunity_type, notes, session_id, website_status,
     date_added, date_contacted, follow_up_date]
  );
}

async function updateWebsiteStatus(id, website_status, opportunity_type) {
  return run(
    'UPDATE leads SET website_status = ?, opportunity_type = ? WHERE id = ?',
    [website_status, opportunity_type, id]
  );
}

async function updateOpportunityType(id, opportunity_type) {
  return run('UPDATE leads SET opportunity_type = ? WHERE id = ?', [opportunity_type, id]);
}

async function updateLeadEmail(id, email) {
  return run('UPDATE leads SET email = ? WHERE id = ?', [email, id]);
}

async function updateLeadPhone(id, phone) {
  return run('UPDATE leads SET phone = ? WHERE id = ?', [phone, id]);
}

async function markEmailSearched(id) {
  return run('UPDATE leads SET email_searched = 1 WHERE id = ?', [id]);
}

async function updateLeadOwnerName(id, ownerName) {
  return run('UPDATE leads SET owner_name = ? WHERE id = ?', [ownerName, id]);
}

// Records how a call went — 'good' (green), 'bad' (red), or null to clear.
async function updateLeadCallOutcome(id, outcome) {
  return run('UPDATE leads SET call_outcome = ? WHERE id = ?', [outcome || null, id]);
}

async function updateLeadStatus(id, status, date_contacted = null) {
  return run(
    'UPDATE leads SET status = ?, date_contacted = ? WHERE id = ?',
    [status, date_contacted, id]
  );
}

async function updateLeadNotes(id, notes, follow_up_date = null) {
  return run(
    'UPDATE leads SET notes = ?, follow_up_date = ? WHERE id = ?',
    [notes, follow_up_date, id]
  );
}

async function deleteLead(id) {
  return run('DELETE FROM leads WHERE id = ?', [id]);
}

async function updateLeadAiBrief(id, briefJson) {
  return run('UPDATE leads SET ai_brief = ? WHERE id = ?', [briefJson, id]);
}

async function updateLeadScore(id, score) {
  return run('UPDATE leads SET score = ? WHERE id = ?', [score, id]);
}

// ─── Email events — open tracking ─────────────────────────────────────────────
async function insertEmailEvent(lead_id, token, email_type) {
  return run(
    'INSERT INTO email_events (lead_id, token, email_type, sent_at) VALUES (?, ?, ?, ?)',
    [lead_id, token, email_type, new Date().toISOString()]
  );
}

// First open sets opened_at; every open bumps the counter. Returns the event row.
async function recordEmailOpen(token) {
  const event = await get('SELECT * FROM email_events WHERE token = ?', [token]);
  if (!event) return null;
  await run(
    `UPDATE email_events
     SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1
     WHERE token = ?`,
    [new Date().toISOString(), token]
  );
  return event;
}

// Leads we've emailed and are awaiting a reply from — the reply checker's scan list
async function getContactedLeads() {
  return all(
    `SELECT id, business_name, email, status FROM leads
     WHERE status IN ('contacted', 'followed_up')
       AND email IS NOT NULL AND email != '' AND email LIKE '%@%'`
  );
}

async function getStats() {
  const [total, byStatus, avgRating] = await Promise.all([
    get('SELECT COUNT(*) AS total FROM leads'),
    all('SELECT status, COUNT(*) AS count FROM leads GROUP BY status'),
    get('SELECT ROUND(AVG(google_rating), 2) AS avg_rating FROM leads'),
  ]);

  const statusMap = {};
  for (const row of byStatus) statusMap[row.status] = row.count;

  return { total: total.total, by_status: statusMap, avg_rating: avgRating.avg_rating };
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function getAllSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

async function setSetting(key, value) {
  return run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value == null ? null : String(value)]
  );
}

// ─── Analytics ──────────────────────────────────────────────────────────────
// Powers the Analytics agent: pipeline funnel, opportunity mix, leads-over-time,
// and headline conversion/reply rates.
async function getAnalytics() {
  const [byStatus, byOpportunity, overTime, totalRow, contactedTodayRow] = await Promise.all([
    all('SELECT status, COUNT(*) AS count FROM leads GROUP BY status'),
    all('SELECT opportunity_type, COUNT(*) AS count FROM leads GROUP BY opportunity_type'),
    all(`SELECT substr(date_added, 1, 10) AS day, COUNT(*) AS count
         FROM leads WHERE date_added IS NOT NULL
         GROUP BY day ORDER BY day ASC`),
    get('SELECT COUNT(*) AS total FROM leads'),
    get(`SELECT COUNT(*) AS count FROM leads WHERE substr(date_contacted, 1, 10) = date('now')`),
  ]);

  const statusMap = {};
  for (const row of byStatus) statusMap[row.status] = row.count;

  const oppMap = {};
  for (const row of byOpportunity) oppMap[row.opportunity_type || 'UNKNOWN'] = row.count;

  const total       = totalRow.total || 0;
  const contacted   = (statusMap.contacted || 0) + (statusMap.followed_up || 0) +
                      (statusMap.replied || 0) + (statusMap.converted || 0);
  const replied     = (statusMap.replied || 0) + (statusMap.converted || 0);
  const converted   = statusMap.converted || 0;

  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  return {
    total,
    by_status:      statusMap,
    by_opportunity: oppMap,
    over_time:      overTime,
    funnel: [
      { stage: 'Total Leads', count: total },
      { stage: 'Contacted',   count: contacted },
      { stage: 'Replied',     count: replied },
      { stage: 'Converted',   count: converted },
    ],
    contacted_today: contactedTodayRow.count || 0,
    rates: {
      contact_rate:    pct(contacted, total),
      reply_rate:      pct(replied, contacted),
      conversion_rate: pct(converted, total),
    },
  };
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const CLIENT_FIELDS = [
  'company', 'contact_name', 'email', 'phone', 'lead_id', 'service_description',
  'monthly_retainer', 'status', 'start_date', 'notes',
];

async function insertClient(client) {
  const {
    company, contact_name = null, email = null, phone = null,
    lead_id = null, service_description = null, monthly_retainer = 0,
    status = 'active', start_date = null, notes = null,
  } = client;
  return run(
    `INSERT INTO clients
       (company, contact_name, email, phone, lead_id, service_description,
        monthly_retainer, status, start_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [company, contact_name, email, phone, lead_id, service_description,
     Number(monthly_retainer) || 0, status, start_date, notes, new Date().toISOString()]
  );
}

async function getAllClients() {
  return all(`
    SELECT c.*,
           COUNT(i.id) AS invoice_count,
           COALESCE(SUM(i.total), 0) AS total_invoiced,
           COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total END), 0) AS total_paid
    FROM clients c
    LEFT JOIN invoices i ON i.client_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
}

async function getClientById(id) {
  return get('SELECT * FROM clients WHERE id = ?', [id]);
}

// Whitelist-built SET clause so callers can pass a partial body safely
async function updateClient(id, fields) {
  const sets = [];
  const params = [];
  for (const key of CLIENT_FIELDS) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      params.push(key === 'monthly_retainer' ? Number(fields[key]) || 0 : fields[key]);
    }
  }
  if (!sets.length) return { changes: 0 };
  params.push(id);
  return run(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function deleteClient(id) {
  return run('DELETE FROM clients WHERE id = ?', [id]);
}

async function getClientByReportToken(token) {
  return get('SELECT * FROM clients WHERE report_token = ?', [token]);
}

async function setClientReportToken(id, token) {
  return run('UPDATE clients SET report_token = ? WHERE id = ?', [token, id]);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
const INVOICE_FIELDS = [
  'client_id', 'line_items', 'subtotal', 'tax_rate', 'total',
  'status', 'issue_date', 'due_date', 'paid_date', 'notes',
];

async function insertInvoice(inv) {
  const {
    client_id, number, line_items = '[]', subtotal = 0, tax_rate = 0, total = 0,
    status = 'draft', issue_date = null, due_date = null, paid_date = null, notes = null,
  } = inv;
  return run(
    `INSERT INTO invoices
       (client_id, number, line_items, subtotal, tax_rate, total, status,
        issue_date, due_date, paid_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, number,
     typeof line_items === 'string' ? line_items : JSON.stringify(line_items),
     subtotal, tax_rate, total, status, issue_date, due_date, paid_date, notes,
     new Date().toISOString()]
  );
}

async function getAllInvoices({ status, client_id } = {}) {
  const where = [];
  const params = [];
  if (status)    { where.push('i.status = ?');    params.push(status); }
  if (client_id) { where.push('i.client_id = ?'); params.push(client_id); }
  return all(
    `SELECT i.*, c.company AS client_company, c.email AS client_email
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY i.created_at DESC`,
    params
  );
}

async function getInvoiceById(id) {
  return get(
    `SELECT i.*, c.company AS client_company, c.email AS client_email
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ?`,
    [id]
  );
}

async function updateInvoice(id, fields) {
  const sets = [];
  const params = [];
  for (const key of INVOICE_FIELDS) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      params.push(key === 'line_items' && typeof fields[key] !== 'string'
        ? JSON.stringify(fields[key])
        : fields[key]);
    }
  }
  if (!sets.length) return { changes: 0 };
  params.push(id);
  return run(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function updateInvoiceStatus(id, status, paid_date = null) {
  return run('UPDATE invoices SET status = ?, paid_date = ? WHERE id = ?', [status, paid_date, id]);
}

async function deleteInvoice(id) {
  return run('DELETE FROM invoices WHERE id = ?', [id]);
}

async function getMaxInvoiceNumber(prefix, year) {
  const row = await get(
    `SELECT number FROM invoices WHERE number LIKE ? ORDER BY number DESC LIMIT 1`,
    [`${prefix}-${year}-%`]
  );
  return row ? row.number : null;
}

async function markOverdueInvoices(todayIso) {
  return run(
    `UPDATE invoices SET status = 'overdue'
     WHERE status = 'sent' AND due_date IS NOT NULL AND substr(due_date, 1, 10) < ?`,
    [todayIso]
  );
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function insertTransaction(tx) {
  const {
    type, category, amount, date, description = null,
    client_id = null, invoice_id = null, recurring = 0,
  } = tx;
  return run(
    `INSERT INTO transactions
       (type, category, amount, date, description, client_id, invoice_id, recurring, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [type, category, Number(amount) || 0, date, description, client_id, invoice_id,
     recurring ? 1 : 0, new Date().toISOString()]
  );
}

async function getAllTransactions({ type, from, to, client_id } = {}) {
  const where = [];
  const params = [];
  if (type)      { where.push('t.type = ?');                  params.push(type); }
  if (from)      { where.push('t.date >= ?');                 params.push(from); }
  if (to)        { where.push('t.date <= ?');                 params.push(to); }
  if (client_id) { where.push('t.client_id = ?');             params.push(client_id); }
  return all(
    `SELECT t.*, c.company AS client_company
     FROM transactions t LEFT JOIN clients c ON c.id = t.client_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.date DESC, t.id DESC`,
    params
  );
}

async function updateTransaction(id, fields) {
  const sets = [];
  const params = [];
  for (const key of ['type', 'category', 'amount', 'date', 'description', 'client_id', 'recurring']) {
    if (key in fields) { sets.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return { changes: 0 };
  params.push(id);
  return run(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function deleteTransaction(id) {
  return run('DELETE FROM transactions WHERE id = ?', [id]);
}

// ─── Finance aggregates ───────────────────────────────────────────────────────
// monthIso = 'YYYY-MM' (current month)
async function getFinanceSummary(monthIso) {
  const [mrr, income, expenses, outstanding, overdue] = await Promise.all([
    get(`SELECT COALESCE(SUM(monthly_retainer), 0) AS v FROM clients WHERE status = 'active'`),
    get(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE type = 'income'  AND substr(date, 1, 7) = ?`, [monthIso]),
    get(`SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE type = 'expense' AND substr(date, 1, 7) = ?`, [monthIso]),
    get(`SELECT COALESCE(SUM(total), 0) AS v FROM invoices WHERE status IN ('sent', 'overdue')`),
    get(`SELECT COALESCE(SUM(total), 0) AS v, COUNT(*) AS n FROM invoices WHERE status = 'overdue'`),
  ]);
  return {
    month:         monthIso,
    mrr:           mrr.v,
    revenue_mtd:   income.v,
    expenses_mtd:  expenses.v,
    net_mtd:       Math.round((income.v - expenses.v) * 100) / 100,
    outstanding:   outstanding.v,
    overdue_total: overdue.v,
    overdue_count: overdue.n,
  };
}

async function getFinanceCharts() {
  const year = new Date().getFullYear() + '';
  const [monthlyDesc, byCategory, byClient] = await Promise.all([
    all(`SELECT substr(date, 1, 7) AS month,
                COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses
         FROM transactions GROUP BY month ORDER BY month DESC LIMIT 12`),
    all(`SELECT category, COALESCE(SUM(amount), 0) AS total
         FROM transactions WHERE type = 'expense' AND substr(date, 1, 4) = ?
         GROUP BY category ORDER BY total DESC LIMIT 8`, [year]),
    all(`SELECT COALESCE(c.company, 'Unassigned') AS client, COALESCE(SUM(t.amount), 0) AS total
         FROM transactions t LEFT JOIN clients c ON c.id = t.client_id
         WHERE t.type = 'income' AND substr(t.date, 1, 4) = ?
         GROUP BY client ORDER BY total DESC LIMIT 8`, [year]),
  ]);
  return { monthly: monthlyDesc.reverse(), by_category: byCategory, by_client: byClient };
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
async function insertTask({ title, due_date = null, lead_id = null, client_id = null }) {
  return run(
    'INSERT INTO tasks (title, due_date, done, lead_id, client_id, created_at) VALUES (?, ?, 0, ?, ?, ?)',
    [title, due_date, lead_id, client_id, new Date().toISOString()]
  );
}

async function getTasks({ done, client_id } = {}) {
  const where = [];
  const params = [];
  if (done !== undefined) { where.push('t.done = ?'); params.push(done ? 1 : 0); }
  if (client_id)          { where.push('t.client_id = ?'); params.push(client_id); }
  return all(
    `SELECT t.*, l.business_name AS lead_name, c.company AS client_company
     FROM tasks t
     LEFT JOIN leads   l ON l.id = t.lead_id
     LEFT JOIN clients c ON c.id = t.client_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.done ASC, COALESCE(t.due_date, '9999-12-31') ASC, t.id DESC`,
    params
  );
}

async function updateTask(id, fields) {
  const sets = [];
  const params = [];
  if ('title' in fields)    { sets.push('title = ?');    params.push(fields.title); }
  if ('due_date' in fields) { sets.push('due_date = ?'); params.push(fields.due_date); }
  if ('done' in fields)     { sets.push('done = ?');     params.push(fields.done ? 1 : 0); }
  if (!sets.length) return { changes: 0 };
  params.push(id);
  return run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function deleteTask(id) {
  return run('DELETE FROM tasks WHERE id = ?', [id]);
}

// ─── Activity feed ────────────────────────────────────────────────────────────
// Best-effort log: must never break the action it records.
async function logActivity(type, message, refs = {}) {
  try {
    await run(
      'INSERT INTO activity (type, message, lead_id, client_id, invoice_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [type, message, refs.lead_id ?? null, refs.client_id ?? null, refs.invoice_id ?? null,
       new Date().toISOString()]
    );
  } catch (err) {
    console.error('[activity] log failed:', err.message);
  }
}

async function getActivity(limit = 30, { lead_id, client_id } = {}) {
  const where = [];
  const params = [];
  if (lead_id)   { where.push('lead_id = ?');   params.push(lead_id); }
  if (client_id) { where.push('client_id = ?'); params.push(client_id); }
  params.push(Math.min(Number(limit) || 30, 200));
  return all(
    `SELECT * FROM activity
     ${where.length ? 'WHERE ' + where.join(' OR ') : ''}
     ORDER BY id DESC LIMIT ?`,
    params
  );
}

// ---------------------------------------------------------------------------
// Email queue
// ---------------------------------------------------------------------------
async function addToQueue(leadIds, type = 'outreach') {
  for (const id of leadIds) {
    await run(
      `INSERT INTO email_queue (lead_id, type, created_at) VALUES (?, ?, datetime('now'))`,
      [id, type]
    );
  }
}

// Enqueue a single email, optionally carrying the user's edited subject/body
// and a projected send time (for showing an ETA in the UI).
async function enqueueEmail({ lead_id, type = 'outreach', subject = null, body = null, scheduled_at = null }) {
  return run(
    `INSERT INTO email_queue (lead_id, type, subject, body, scheduled_at, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [lead_id, type, subject, body, scheduled_at]
  );
}

// Record a send that went out immediately (not via the queue) so it still
// counts toward the daily cap and the sent totals.
async function recordSentEmail({ lead_id, type = 'outreach', subject = null, body = null }) {
  return run(
    `INSERT INTO email_queue (lead_id, type, subject, body, status, created_at, sent_at)
     VALUES (?, ?, ?, ?, 'sent', datetime('now'), datetime('now'))`,
    [lead_id, type, subject, body]
  );
}

async function getNextPendingQueueItem() {
  return get(`SELECT * FROM email_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 1`);
}

async function getPendingQueueCount() {
  const row = await get(`SELECT COUNT(*) AS count FROM email_queue WHERE status = 'pending'`);
  return row.count;
}

// How many emails actually went out in the last rolling 24h (cap enforcement).
async function getSentCountLast24h() {
  const row = await get(
    `SELECT COUNT(*) AS count FROM email_queue
     WHERE status = 'sent' AND sent_at >= datetime('now', '-1 day')`
  );
  return row.count;
}

async function markQueueItemSent(id) {
  return run(`UPDATE email_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?`, [id]);
}

async function markQueueItemFailed(id, error) {
  return run(`UPDATE email_queue SET status = 'failed', error = ? WHERE id = ?`, [String(error).slice(0, 500), id]);
}

async function getQueueStats() {
  const [pending, sent, failed, sent24h, nextItem] = await Promise.all([
    get(`SELECT COUNT(*) AS count FROM email_queue WHERE status = 'pending'`),
    get(`SELECT COUNT(*) AS count FROM email_queue WHERE status = 'sent'`),
    get(`SELECT COUNT(*) AS count FROM email_queue WHERE status = 'failed'`),
    get(`SELECT COUNT(*) AS count FROM email_queue WHERE status = 'sent' AND sent_at >= datetime('now', '-1 day')`),
    get(`SELECT scheduled_at FROM email_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 1`),
  ]);
  return {
    pending: pending.count,
    sent: sent.count,
    failed: failed.count,
    sent_24h: sent24h.count,
    next_scheduled_at: nextItem ? nextItem.scheduled_at : null,
  };
}

async function clearPendingQueue() {
  return run(`DELETE FROM email_queue WHERE status = 'pending'`);
}

// Full queue listing for the dashboard: everything still pending (in send
// order) plus the most recent finished items.
async function getQueueItems() {
  const pending = await all(
    `SELECT eq.id, eq.type, eq.scheduled_at, eq.created_at, l.business_name, l.email
       FROM email_queue eq JOIN leads l ON l.id = eq.lead_id
      WHERE eq.status = 'pending'
      ORDER BY COALESCE(eq.scheduled_at, eq.created_at) ASC, eq.id ASC`
  );
  const recent = await all(
    `SELECT eq.id, eq.type, eq.status, eq.sent_at, eq.error, l.business_name, l.email
       FROM email_queue eq JOIN leads l ON l.id = eq.lead_id
      WHERE eq.status IN ('sent', 'failed')
      ORDER BY COALESCE(eq.sent_at, eq.created_at) DESC, eq.id DESC
      LIMIT 15`
  );
  return { pending, recent };
}

async function deleteQueueItem(id) {
  return run(`DELETE FROM email_queue WHERE id = ? AND status = 'pending'`, [id]);
}

module.exports = {
  createSession, updateSessionLeadCount, getAllSessions, getSessionLeads, getUnsessionedLeads, deleteSession,
  getAllLeads, getLeadById, insertLead, deleteLead, updateLeadAiBrief, updateLeadScore,
  updateLeadStatus, updateLeadNotes, updateLeadEmail, updateLeadPhone, markEmailSearched, updateLeadOwnerName, updateLeadCallOutcome, updateOpportunityType, updateWebsiteStatus,
  insertEmailEvent, recordEmailOpen, getContactedLeads,
  getStats, getAnalytics,
  getAllSettings, setSetting,
  insertClient, getAllClients, getClientById, updateClient, deleteClient,
  getClientByReportToken, setClientReportToken,
  insertInvoice, getAllInvoices, getInvoiceById, updateInvoice, updateInvoiceStatus,
  deleteInvoice, getMaxInvoiceNumber, markOverdueInvoices,
  insertTransaction, getAllTransactions, updateTransaction, deleteTransaction,
  getFinanceSummary, getFinanceCharts,
  insertTask, getTasks, updateTask, deleteTask,
  logActivity, getActivity,
  addToQueue, enqueueEmail, recordSentEmail, getNextPendingQueueItem, getPendingQueueCount, getSentCountLast24h,
  markQueueItemSent, markQueueItemFailed, getQueueStats, clearPendingQueue, getQueueItems, deleteQueueItem,
};
