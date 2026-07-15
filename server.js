require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const {
  createSession, updateSessionLeadCount, getAllSessions, getSessionLeads, getUnsessionedLeads, deleteSession,
  getAllLeads, getLeadById, deleteLead,
  updateLeadStatus, updateLeadNotes, updateLeadEmail, updateLeadPhone, markEmailSearched, updateLeadOwnerName, updateLeadCallOutcome, updateOpportunityType, getStats,
  getAnalytics, getAllSettings, setSetting,
  insertClient, getAllClients, getClientById, updateClient, deleteClient,
  getClientByReportToken, setClientReportToken,
  insertInvoice, getAllInvoices, getInvoiceById, updateInvoice,
  deleteInvoice, insertTransaction, getAllTransactions, deleteTransaction,
  getFinanceSummary, getFinanceCharts,
  insertTask, getTasks, updateTask, deleteTask,
  logActivity, getActivity,
  addToQueue, enqueueEmail, recordSentEmail, getPendingQueueCount, getSentCountLast24h, getQueueStats, clearPendingQueue,
  getQueueItems, deleteQueueItem,
} = require('./src/database');
const { scrapeLeads }                                 = require('./src/scraper');
const { sendOutreach, sendFollowUp, previewEmail, getOAuth2Client, sendHtmlEmail } = require('./src/emailer');
const {
  computeTotals, nextInvoiceNumber, markInvoicePaid, checkOverdue,
  computeForecast, renderInvoiceHtml, renderInvoiceText,
} = require('./src/finance');
const ai = require('./src/ai');
const { updateLeadAiBrief, updateLeadScore, recordEmailOpen } = require('./src/database');
const { computeScore, backfillScores } = require('./src/scoring');
const replyChecker  = require('./src/reply-checker');
const { startQueueWorker } = require('./src/queue-worker');
const { gatherReportData, buildReportHtml, build404Html } = require('./src/report');
const { recommendPackage } = require('./src/packages');
const crypto = require('crypto');
const { findEmailOnWebsite }    = require('./src/email-finder');
const { qualify }                                     = require('./src/qualifier');
const { nameFromEmail }         = require('./src/personalize');
const { readPace, randomGapSec, withinWindow, nextWindowOpen, secondsUntilWindowClose, nextGapSec } = require('./src/pacing');

const app  = express();
const PORT = process.env.PORT || 3000;

const DASHBOARD_USER     = process.env.DASHBOARD_USER     || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'changeme';
// Local-dev escape hatch. NEVER set this on Railway/production — leave it unset
// there so Basic Auth stays enforced. Used only for local previewing.
const DISABLE_AUTH       = process.env.DISABLE_AUTH === 'true';

app.use((req, res, next) => {
  // Public paths: Railway healthcheck, email logo (referenced from outreach
  // emails), email tracking pixels, client report links
  if (req.path === '/api/health' || req.path === '/logo.png' || req.path === '/logo-dark.png' || req.path.startsWith('/t/') || req.path.startsWith('/report/')) return next();
  if (DISABLE_AUTH) return next();
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (user === DASHBOARD_USER && pass === DASHBOARD_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Command Center Dashboard"');
  res.status(401).send('Unauthorized');
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard')));

// ---------------------------------------------------------------------------
// OAuth2 — visit /auth once to authorise Gmail, then /oauth2callback saves
// the refresh token directly into .env so future restarts work automatically.
// ---------------------------------------------------------------------------
app.get('/auth', (req, res) => {
  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',   // force Google to return a refresh_token
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly', // reply detection
    ],
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing auth code');

  try {
    const client        = getOAuth2Client();
    const { tokens }    = await client.getToken(code);
    const refreshToken  = tokens.refresh_token;

    if (refreshToken) {
      process.env.GMAIL_REFRESH_TOKEN = refreshToken; // active for this session
    }

    res.send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;max-width:600px">
        <h2>Gmail connected ✓</h2>
        ${refreshToken ? `
          <p><strong>Gmail is working for this session.</strong> To make it permanent, copy the token below and save it as a Railway environment variable named <code>GMAIL_REFRESH_TOKEN</code>:</p>
          <textarea rows="4" style="width:100%;font-family:monospace;font-size:12px;padding:8px" onclick="this.select()">${refreshToken}</textarea>
          <p style="color:#888;font-size:13px">Railway → your service → Variables → set <code>GMAIL_REFRESH_TOKEN</code> to the value above → redeploy.</p>
        ` : '<p>Token already stored — no update needed.</p>'}
        <p><a href="/">Back to dashboard</a></p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`OAuth2 error: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sessions  — all sessions with their leads nested
// ---------------------------------------------------------------------------
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions  = await getAllSessions();
    const withLeads = await Promise.all(sessions.map(async s => ({
      ...s,
      leads: await getSessionLeads(s.id),
    })));

    // Leads scraped before sessions existed — group under a legacy bucket
    const legacy = await getUnsessionedLeads();
    if (legacy.length > 0) {
      withLeads.push({
        id:         null,
        query:      'Previous Leads',
        location:   '—',
        timestamp:  legacy[0].date_added,
        lead_count: legacy.length,
        leads:      legacy,
      });
    }

    res.json(withLeads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/sessions/:id  — remove session and all its leads
// ---------------------------------------------------------------------------
app.delete('/api/sessions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid session id' });
  try {
    await deleteSession(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/leads   — all leads; optional ?status= filter
// ---------------------------------------------------------------------------
app.get('/api/leads', async (req, res) => {
  try {
    let leads = await getAllLeads();
    if (req.query.status) {
      leads = leads.filter(l => l.status === req.query.status);
    }
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats   — counts grouped by status + avg rating
// ---------------------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics  — funnel, opportunity mix, leads-over-time, rates
// ---------------------------------------------------------------------------
app.get('/api/analytics', async (req, res) => {
  try {
    res.json(await getAnalytics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings  — shared key/value config (sender info, defaults)
// PUT /api/settings  — { key: value, ... } upsert one or more settings
// ---------------------------------------------------------------------------
// The Claude API key is write-only from the dashboard: GET returns a mask,
// PUT ignores the mask so re-saving the form never clobbers the real key.
function maskSettings(settings) {
  const out = { ...settings };
  if (out.anthropic_api_key) {
    out.anthropic_api_key = '••••' + String(out.anthropic_api_key).slice(-4);
  }
  return out;
}

app.get('/api/settings', async (req, res) => {
  try {
    res.json(maskSettings(await getAllSettings()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be an object of key/value pairs' });
  }
  try {
    for (const [key, value] of Object.entries(body)) {
      if (key === 'anthropic_api_key' && typeof value === 'string' && value.startsWith('••••')) {
        continue; // masked echo from the form — keep the stored key
      }
      await setSetting(key, value);
    }
    syncSettingsToEnv(await getAllSettings());
    res.json(maskSettings(await getAllSettings()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mirror sender settings into process.env so the emailer (which reads env at
// send time) uses values configured from the dashboard Settings agent.
function syncSettingsToEnv(settings = {}) {
  if (settings.sender_name)  process.env.SENDER_NAME  = settings.sender_name;
  if (settings.sender_phone) process.env.SENDER_PHONE = settings.sender_phone;
}

// ---------------------------------------------------------------------------
// GET /api/health  — lightweight liveness probe for Railway
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// GET /t/:token  — PUBLIC email-open tracking pixel
// Always returns the PNG (even for unknown tokens) so nothing leaks; the DB
// write is fire-and-forget so the image never blocks.
// ---------------------------------------------------------------------------
const TRACKING_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

app.get('/t/:token', (req, res) => {
  res.set({
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  });
  res.send(TRACKING_PIXEL);

  const token = req.params.token;
  if (!/^[a-f0-9]{32}$/.test(token)) return;
  recordEmailOpen(token).then(async (event) => {
    if (event && !event.opened_at) {
      // First open only — avoid spamming the activity feed
      const lead = await getLeadById(event.lead_id);
      if (lead) {
        await logActivity('email_opened', `${lead.business_name} opened your ${event.email_type} email 👀`, {
          lead_id: lead.id,
        });
      }
    }
  }).catch(err => console.error('[tracking] open record failed:', err.message));
});

// ---------------------------------------------------------------------------
// POST /api/scrape  — { query, location, maxResults?, category? }
// Scraping is synchronous here; expect 30-90 s for a full 60-result run.
// ---------------------------------------------------------------------------
app.post('/api/scrape', async (req, res) => {
  const { query, location, maxResults, category, allowedTypes } = req.body || {};
  if (!query || !location) {
    return res.status(400).json({ error: '"query" and "location" are required' });
  }
  try {
    const session  = await createSession(query, location);
    const sessionId = session.lastID;
    const results  = await scrapeLeads(query, location, { maxResults, category, allowedTypes, sessionId });
    await updateSessionLeadCount(sessionId, results.length);
    await backfillScores(); // score the fresh batch
    await logActivity('scrape', `Scraped ${results.length} leads for “${query}” in ${location}`);
    const by_opportunity = results.reduce((acc, r) => {
      acc[r.opportunity_type] = (acc[r.opportunity_type] || 0) + 1;
      return acc;
    }, {});
    res.json({ saved: results.length, by_opportunity, sessionId, leads: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/leads/:id/preview?type=outreach|followup  — rendered email draft
// ---------------------------------------------------------------------------
app.get('/api/leads/:id/preview', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const { subject, body } = previewEmail(lead, req.query.type || 'outreach');
    const plan = recommendPackage(lead);
    res.json({
      subject, body, to: lead.email || '',
      recommended_plan: { key: plan.key, name: plan.name, price: plan.price, reason: plan.reason },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/leads/:id/find-email  — scrape business website for email address
// ---------------------------------------------------------------------------
app.get('/api/leads/:id/find-email', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.website) return res.json({ emails: [], phones: [], message: 'No website to search' });

    const { emails, phones } = await findEmailOnWebsite(lead.website);

    // Auto-save best email candidate if lead has no email yet
    if (emails.length > 0 && !lead.email) {
      await updateLeadEmail(lead.id, emails[0]);
      const fresh = await getLeadById(lead.id);
      await updateLeadScore(lead.id, computeScore(fresh));
    }

    // Auto-save best phone candidate if Google Places didn't return one
    if (phones.length > 0 && !lead.phone) {
      await updateLeadPhone(lead.id, phones[0]);
    }

    // Resolve owner first name for greeting personalization (best-effort):
    // free email heuristic first, Claude About-page lookup as fallback.
    let ownerName = null;
    if (!lead.owner_name) {
      const bestEmail = lead.email || emails[0] || null;
      ownerName = nameFromEmail(bestEmail);
      if (!ownerName) {
        try {
          const settings = await getAllSettings();
          ownerName = await ai.extractOwnerName({ settings, website: lead.website, businessName: lead.business_name });
        } catch (err) {
          console.error('[owner-name] AI lookup failed:', err.message);
        }
      }
      if (ownerName) await updateLeadOwnerName(lead.id, ownerName);
    }

    await markEmailSearched(lead.id);

    res.json({ emails, phones, owner_name: ownerName || lead.owner_name || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/leads/:id/contact   — send initial outreach email
// ---------------------------------------------------------------------------

// Auto-throttle: send immediately only if the last send is spaced far enough
// apart AND nothing is already queued AND we're under the daily cap. Otherwise
// queue the email (carrying any edited subject/body) so the worker sends it,
// spaced out, later. This is what stops rapid sends from getting flagged.
async function sendOrQueue(lead, type, { subject, body }) {
  const settings = await getAllSettings();
  const pace = readPace(settings);
  const [sent24h, pending] = await Promise.all([getSentCountLast24h(), getPendingQueueCount()]);
  const now    = Date.now();
  const nextAt = settings.queue_next_send_at ? Date.parse(settings.queue_next_send_at) : 0;
  const capReached = sent24h >= pace.cap;
  const inWindow   = withinWindow(settings);
  const canSendNow = inWindow && now >= nextAt && pending === 0 && !capReached;
  const label = type === 'followup' ? 'Follow-up' : 'Outreach';

  if (canSendNow) {
    const result = type === 'followup'
      ? await sendFollowUp(lead, { subject, body })
      : await sendOutreach(lead, { subject, body });
    await recordSentEmail({ lead_id: lead.id, type, subject: result.subject, body: null });
    await setSetting('queue_next_send_at', new Date(now + nextGapSec(settings, pace, sent24h) * 1000).toISOString());
    await logActivity('email_sent', `${label} email sent to ${lead.business_name}`, { lead_id: lead.id });
    return { sent: true, ...result };
  }

  // Queue behind whatever is pending, not before the next slot, and not before
  // the sending window next opens. ETA uses the same spread pacing the worker
  // will apply (remaining quota spread across the window, floored at min gap).
  const openAtMs = nextWindowOpen(settings, new Date(Math.max(now, nextAt))).getTime();
  const remainingQuota = Math.max(1, pace.cap - sent24h);
  const spreadGapSec = secondsUntilWindowClose(settings, new Date(openAtMs)) / remainingQuota;
  const avgGapMs = Math.max((pace.gapMin + pace.gapMax) / 2, spreadGapSec) * 1000;
  let scheduledMs = Math.max(now, nextAt, openAtMs) + pending * avgGapMs;
  if (capReached) scheduledMs = Math.max(scheduledMs, now + 24 * 3600 * 1000);
  const scheduled_at = new Date(scheduledMs).toISOString();

  await enqueueEmail({ lead_id: lead.id, type, subject, body, scheduled_at });
  await logActivity('email_queued', `${label} queued for ${lead.business_name}`, { lead_id: lead.id });
  return {
    queued: true,
    position: pending + 1,
    capped: capReached,
    in_window: inWindow,
    scheduled_at,
    eta_seconds: Math.round((scheduledMs - now) / 1000),
  };
}

app.post('/api/leads/:id/contact', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    // Allow modal to pass a confirmed email address
    if (req.body?.email) {
      await updateLeadEmail(lead.id, req.body.email);
      lead.email = req.body.email;
    }
    if (!lead.email) return res.status(400).json({ error: 'Lead has no email address' });
    const { subject, body } = req.body || {};
    res.json(await sendOrQueue(lead, 'outreach', { subject, body }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/leads/:id/followup  — send follow-up email
// ---------------------------------------------------------------------------
app.post('/api/leads/:id/followup', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (req.body?.email) {
      await updateLeadEmail(lead.id, req.body.email);
      lead.email = req.body.email;
    }
    if (!lead.email) return res.status(400).json({ error: 'Lead has no email address' });
    const { subject, body } = req.body || {};
    res.json(await sendOrQueue(lead, 'followup', { subject, body }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/leads/:id  — update status and/or notes
// Body: { status?, date_contacted?, notes?, follow_up_date? }
// ---------------------------------------------------------------------------
app.put('/api/leads/:id', async (req, res) => {
  const id   = Number(req.params.id);
  const body = req.body || {};
  const { status, date_contacted, notes, follow_up_date, email, owner_name, call_outcome } = body;

  if (!status && !('notes' in body) && !('email' in body) && !('owner_name' in body) && !('call_outcome' in body)) {
    return res.status(400).json({ error: 'Provide at least one of: status, notes, email, owner_name, call_outcome' });
  }

  try {
    const lead = await getLeadById(id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (status)        await updateLeadStatus(id, status, date_contacted ?? lead.date_contacted);
    if ('notes' in body) await updateLeadNotes(id, notes, follow_up_date ?? lead.follow_up_date);
    if ('email' in body) await updateLeadEmail(id, email);
    if ('owner_name' in body)   await updateLeadOwnerName(id, owner_name);
    if ('call_outcome' in body) await updateLeadCallOutcome(id, call_outcome);

    if (status && status !== lead.status) {
      await logActivity('status_change', `${lead.business_name} moved to ${status.replace('_', ' ')}`, { lead_id: id });
    }

    // Email/status edits change the score inputs — keep it fresh
    const updated = await getLeadById(id);
    await updateLeadScore(id, computeScore(updated));

    res.json(await getLeadById(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/leads/:id  — remove a lead from the pipeline
// ---------------------------------------------------------------------------
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await deleteLead(req.params.id);
    await logActivity('lead_deleted', `Deleted lead ${lead.business_name}`);
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /report/:token  — PUBLIC branded client report (no login)
// ---------------------------------------------------------------------------
app.get('/report/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).send(build404Html());

    const client = await getClientByReportToken(token);
    if (!client) return res.status(404).send(build404Html());

    const [data, settings] = await Promise.all([gatherReportData(client), getAllSettings()]);
    res.set('Cache-Control', 'no-store');
    res.send(buildReportHtml(client, data, settings));
  } catch (err) {
    res.status(500).send(build404Html());
  }
});

// ---------------------------------------------------------------------------
// Report tokens — generate (or rotate) and revoke the public link
// ---------------------------------------------------------------------------
app.post('/api/clients/:id/report-token', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const token = crypto.randomBytes(16).toString('hex');
    await setClientReportToken(client.id, token);

    const settings = await getAllSettings();
    const base = (settings.app_base_url || '').replace(/\/+$/, '');
    res.json({ report_token: token, url: `${base || ''}/report/${token}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id/report-token', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await setClientReportToken(client.id, null);
    res.json({ revoked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CSV exports — leads, transactions, invoices (authenticated)
// ---------------------------------------------------------------------------
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, header, rows) {
  const lines = [header.join(','), ...rows.map(r => r.map(csvEscape).join(','))];
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.send('﻿' + lines.join('\r\n')); // BOM so Excel opens UTF-8 cleanly
}

app.get('/api/export/leads.csv', async (req, res) => {
  try {
    const leads = await getAllLeads();
    sendCsv(res, 'command-center-leads.csv',
      ['Business', 'Category', 'Address', 'Phone', 'Website', 'Rating', 'Reviews', 'Email', 'Status', 'Opportunity', 'Score', 'Added', 'Contacted', 'Notes'],
      leads.map(l => [l.business_name, l.category, l.address, l.phone, l.website, l.google_rating,
        l.review_count, l.email, l.status, l.opportunity_type, l.score,
        (l.date_added || '').slice(0, 10), (l.date_contacted || '').slice(0, 10), l.notes]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/transactions.csv', async (req, res) => {
  try {
    const txs = await getAllTransactions();
    sendCsv(res, 'command-center-transactions.csv',
      ['Date', 'Type', 'Category', 'Amount', 'Description', 'Client', 'Recurring'],
      txs.map(t => [(t.date || '').slice(0, 10), t.type, t.category, t.amount,
        t.description, t.client_company, t.recurring ? 'yes' : '']));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/invoices.csv', async (req, res) => {
  try {
    const invoices = await getAllInvoices();
    sendCsv(res, 'command-center-invoices.csv',
      ['Number', 'Client', 'Subtotal', 'Tax Rate %', 'Total', 'Status', 'Issued', 'Due', 'Paid'],
      invoices.map(i => [i.number, i.client_company, i.subtotal, i.tax_rate, i.total, i.status,
        (i.issue_date || '').slice(0, 10), (i.due_date || '').slice(0, 10), (i.paid_date || '').slice(0, 10)]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// AI engine — Claude-powered personalization, briefs, digest, Q&A
// All routes 400 with code NO_API_KEY when no key is configured.
// ---------------------------------------------------------------------------
function aiError(res, err) {
  if (err.code === 'NO_API_KEY') return res.status(400).json({ error: err.message, code: 'NO_API_KEY' });
  return res.status(500).json({ error: err.message });
}

// Aggregated snapshot fed to digest + ask — numbers only, no PII beyond names
async function buildAiContext() {
  const month = new Date().toISOString().slice(0, 7);
  const [analytics, finance, clients, today] = await Promise.all([
    getAnalytics(), getFinanceSummary(month), getAllClients(), getTasks({ done: false }),
  ]);
  return {
    date: new Date().toISOString().slice(0, 10),
    pipeline: {
      total_leads: analytics.total,
      by_status: analytics.by_status,
      by_opportunity: analytics.by_opportunity,
      rates: analytics.rates,
    },
    finance,
    clients: clients.map(c => ({
      company: c.company, status: c.status,
      monthly_retainer: c.monthly_retainer,
      total_invoiced: c.total_invoiced, total_paid: c.total_paid,
    })),
    open_tasks: today.map(t => ({ title: t.title, due: t.due_date })),
  };
}

app.get('/api/ai/status', async (req, res) => {
  try {
    res.json({ configured: ai.isConfigured(await getAllSettings()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI-personalized outreach draft (does NOT send — fills the email modal)
app.post('/api/ai/outreach/:leadId', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const settings = await getAllSettings();
    const websiteText = await ai.fetchWebsiteText(lead.website);
    const type = req.body?.type === 'followup' ? 'followup' : 'outreach';
    const draft = await ai.generateOutreach(lead, websiteText, settings, type);
    res.json({ ...draft, to: lead.email || '' });
  } catch (err) {
    aiError(res, err);
  }
});

// AI lead brief — cached on the lead row; ?refresh=true regenerates
app.post('/api/ai/brief/:leadId', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (lead.ai_brief && req.query.refresh !== 'true') {
      try { return res.json({ ...JSON.parse(lead.ai_brief), cached: true }); } catch { /* fall through */ }
    }

    const settings = await getAllSettings();
    const websiteText = await ai.fetchWebsiteText(lead.website);
    const brief = await ai.generateBrief(lead, websiteText, settings);
    brief.generated_at = new Date().toISOString();
    await updateLeadAiBrief(lead.id, JSON.stringify(brief));
    res.json(brief);
  } catch (err) {
    aiError(res, err);
  }
});

// Daily-cached AI insights digest for the Overview
app.get('/api/ai/digest', async (req, res) => {
  try {
    const settings = await getAllSettings();
    const today = new Date().toISOString().slice(0, 10);

    if (req.query.refresh !== 'true' && settings.ai_digest_cache) {
      try {
        const cached = JSON.parse(settings.ai_digest_cache);
        if (cached.date === today && Array.isArray(cached.bullets)) {
          return res.json({ ...cached, cached: true });
        }
      } catch { /* regenerate */ }
    }

    const context = await buildAiContext();
    const { bullets } = await ai.generateDigest(context, settings);
    const payload = { date: today, bullets, generated_at: new Date().toISOString() };
    await setSetting('ai_digest_cache', JSON.stringify(payload));
    res.json(payload);
  } catch (err) {
    aiError(res, err);
  }
});

// Natural-language Q&A over the workspace snapshot
app.post('/api/ai/ask', async (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: '"question" is required' });
  try {
    const settings = await getAllSettings();
    const context = await buildAiContext();
    const answer = await ai.askDashboard(question.trim(), context, settings);
    res.json({ answer });
  } catch (err) {
    aiError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Invoices — create as draft, send via Gmail (HTML), mark paid → income tx
// ---------------------------------------------------------------------------
app.get('/api/invoices', async (req, res) => {
  try {
    res.json(await getAllInvoices({ status: req.query.status, client_id: req.query.client_id }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', async (req, res) => {
  const { client_id, line_items, due_date, issue_date, tax_rate, notes } = req.body || {};
  if (!client_id || !Array.isArray(line_items) || !line_items.length || !due_date) {
    return res.status(400).json({ error: '"client_id", "line_items" and "due_date" are required' });
  }
  try {
    const client = await getClientById(client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const settings = await getAllSettings();
    const prefix   = settings.invoice_prefix || 'BS';
    const number   = await nextInvoiceNumber(prefix, new Date().getFullYear());
    const rate     = Number(tax_rate ?? settings.invoice_default_tax_rate) || 0;
    const totals   = computeTotals(line_items, rate);

    const created = await insertInvoice({
      client_id, number, line_items,
      subtotal: totals.subtotal, tax_rate: rate, total: totals.total,
      status: 'draft',
      issue_date: issue_date || new Date().toISOString().slice(0, 10),
      due_date, notes: notes || null,
    });
    res.json(await getInvoiceById(created.lastID));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Draft edits ({ line_items, due_date, ... }) or a status change ({ status }).
// status:'paid' routes through markInvoicePaid → creates the income transaction.
app.put('/api/invoices/:id', async (req, res) => {
  const body = req.body || {};
  if (!Object.keys(body).length) {
    return res.status(400).json({ error: 'Provide at least one field to update' });
  }
  try {
    const inv = await getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    if (body.status === 'paid') {
      return res.json(await markInvoicePaid(inv.id));
    }
    if (body.status) {
      await updateInvoice(inv.id, { status: body.status });
      return res.json(await getInvoiceById(inv.id));
    }

    if (inv.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft invoices can be edited' });
    }
    const fields = { ...body };
    if (Array.isArray(body.line_items)) {
      const rate = Number(body.tax_rate ?? inv.tax_rate) || 0;
      const totals = computeTotals(body.line_items, rate);
      fields.subtotal = totals.subtotal;
      fields.total    = totals.total;
      fields.tax_rate = rate;
    }
    await updateInvoice(inv.id, fields);
    res.json(await getInvoiceById(inv.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send the invoice email (HTML via Gmail), flip draft → sent
app.post('/api/invoices/:id/send', async (req, res) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const client = await getClientById(inv.client_id);
    const to = (req.body && req.body.to) || client.email;
    if (!to) return res.status(400).json({ error: 'Client has no email address — add one first' });

    const settings = await getAllSettings();
    const companyName = settings.company_name || process.env.COMPANY_NAME || 'Your Agency';
    await sendHtmlEmail({
      to,
      subject: `Invoice ${inv.number} from ${companyName} — due ${(inv.due_date || '').slice(0, 10)}`,
      html: renderInvoiceHtml(inv, client, settings),
      text: renderInvoiceText(inv, client),
    });

    await updateInvoice(inv.id, { status: 'sent', issue_date: inv.issue_date || new Date().toISOString().slice(0, 10) });
    await logActivity('invoice_sent', `Invoice ${inv.number} sent to ${client.company}`, {
      client_id: client.id, invoice_id: inv.id,
    });
    res.json(await getInvoiceById(inv.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    await deleteInvoice(req.params.id);
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Transactions — manual income & expenses (invoice payments auto-insert)
// ---------------------------------------------------------------------------
app.get('/api/transactions', async (req, res) => {
  try {
    const { type, from, to, client_id } = req.query;
    res.json(await getAllTransactions({ type, from, to, client_id }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  const { type, category, amount, date, description, client_id, recurring } = req.body || {};
  if (!type || !category || amount === undefined || !date) {
    return res.status(400).json({ error: '"type", "category", "amount" and "date" are required' });
  }
  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: '"type" must be income or expense' });
  }
  try {
    const created = await insertTransaction({ type, category, amount, date, description, client_id, recurring });
    const txs = await getAllTransactions();
    res.json(txs.find(t => t.id === created.lastID) || { id: created.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await deleteTransaction(req.params.id);
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/summary  — KPIs + goal progress + forecast
// GET /api/finance/charts   — datasets for the finance charts
// ---------------------------------------------------------------------------
app.get('/api/finance/summary', async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const [summary, settings, leads, clients] = await Promise.all([
      getFinanceSummary(month), getAllSettings(), getAllLeads(), getAllClients(),
    ]);
    const goal = Number(settings.revenue_goal_monthly) || 0;
    const fc   = computeForecast(leads, clients, settings);
    res.json({
      ...summary,
      goal,
      goal_progress_pct: goal ? Math.min(100, Math.round((summary.revenue_mtd / goal) * 100)) : null,
      ...fc,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/finance/charts', async (req, res) => {
  try {
    res.json(await getFinanceCharts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/leads/:id/convert  — promote a lead to a client (prefilled)
// Body: { monthly_retainer?, service_description?, start_date? }
// ---------------------------------------------------------------------------
app.post('/api/leads/:id/convert', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { monthly_retainer, service_description, start_date } = req.body || {};
    const created = await insertClient({
      company:             lead.business_name,
      contact_name:        null,
      email:               lead.email || null,
      phone:               lead.phone || null,
      lead_id:             lead.id,
      service_description: service_description || null,
      monthly_retainer:    monthly_retainer || 0,
      start_date:          start_date || new Date().toISOString().slice(0, 10),
      notes:               lead.notes || null,
    });

    if (lead.status !== 'converted') {
      await updateLeadStatus(lead.id, 'converted', lead.date_contacted);
    }
    await logActivity('client_added', `${lead.business_name} converted to client`, {
      lead_id: lead.id, client_id: created.lastID,
    });

    res.json(await getClientById(created.lastID));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Clients — CRUD + detail bundle
// ---------------------------------------------------------------------------
app.get('/api/clients', async (req, res) => {
  try {
    res.json(await getAllClients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  const body = req.body || {};
  if (!body.company) return res.status(400).json({ error: '"company" is required' });
  try {
    const created = await insertClient(body);
    await logActivity('client_added', `New client added: ${body.company}`, { client_id: created.lastID });
    res.json(await getClientById(created.lastID));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const [tasks, activity, sourceLead, invoices, transactions] = await Promise.all([
      getTasks({ client_id: client.id }),
      getActivity(30, { client_id: client.id, lead_id: client.lead_id || -1 }),
      client.lead_id ? getLeadById(client.lead_id) : null,
      getAllInvoices({ client_id: client.id }),
      getAllTransactions({ client_id: client.id }),
    ]);

    res.json({ client, tasks, activity, sourceLead, invoices, transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const body = req.body || {};
  if (!Object.keys(body).length) {
    return res.status(400).json({ error: 'Provide at least one field to update' });
  }
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await updateClient(req.params.id, body);
    if (body.status && body.status !== client.status) {
      await logActivity('status_change', `Client ${client.company} marked ${body.status}`, { client_id: client.id });
    }
    res.json(await getClientById(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const client = await getClientById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    await deleteClient(req.params.id);
    await logActivity('client_removed', `Removed client ${client.company}`);
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Tasks — quick to-dos, optionally linked to a lead or client
// ---------------------------------------------------------------------------
app.get('/api/tasks', async (req, res) => {
  try {
    const filter = {};
    if (req.query.done !== undefined) filter.done = req.query.done === '1' || req.query.done === 'true';
    res.json(await getTasks(filter));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { title, due_date, lead_id, client_id } = req.body || {};
  if (!title) return res.status(400).json({ error: '"title" is required' });
  try {
    const created = await insertTask({ title, due_date, lead_id, client_id });
    const tasks = await getTasks();
    res.json(tasks.find(t => t.id === created.lastID) || { id: created.lastID, title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  const body = req.body || {};
  if (!('done' in body) && !('title' in body) && !('due_date' in body)) {
    return res.status(400).json({ error: 'Provide at least one of: done, title, due_date' });
  }
  try {
    await updateTask(req.params.id, body);
    res.json({ updated: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await deleteTask(req.params.id);
    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/today  — open tasks due/overdue + leads whose follow-up is due
// ---------------------------------------------------------------------------
app.get('/api/today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [tasks, leads] = await Promise.all([getTasks({ done: false }), getAllLeads()]);

    const followups = leads.filter(l =>
      l.follow_up_date &&
      l.follow_up_date.slice(0, 10) <= today &&
      !['replied', 'converted'].includes(l.status)
    );

    res.json({
      date: today,
      tasks: tasks.filter(t => t.due_date && t.due_date.slice(0, 10) <= today),
      open_tasks: tasks,
      followups,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/activity  — recent workspace activity feed (?limit=30)
// ---------------------------------------------------------------------------
app.get('/api/activity', async (req, res) => {
  try {
    res.json(await getActivity(req.query.limit || 30));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Startup: backfill any leads that are missing opportunity_type
// (happens when leads were scraped before the qualifier was added)
// ---------------------------------------------------------------------------
async function backfillOpportunityTypes() {
  const leads = await getAllLeads();
  const missing = leads.filter(l => !l.opportunity_type);
  if (missing.length === 0) return;

  console.log(`[backfill] fixing opportunity_type for ${missing.length} leads…`);
  for (const lead of missing) {
    const type = qualify(lead.website, lead.google_rating, lead.review_count);
    await updateOpportunityType(lead.id, type);
  }

  const counts = missing.reduce((acc, l) => {
    const type = qualify(l.website, l.google_rating, l.review_count);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  console.log('[backfill] done:', Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', '));
}

// ---------------------------------------------------------------------------
// Email queue API
// ---------------------------------------------------------------------------
app.get('/api/email-queue', async (req, res) => {
  try { res.json(await getQueueStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Full listing: pending items (in send order) + recent finished, with stats.
app.get('/api/email-queue/items', async (req, res) => {
  try {
    const [stats, items] = await Promise.all([getQueueStats(), getQueueItems()]);
    res.json({ stats, ...items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancel a single pending item.
app.delete('/api/email-queue/:id', async (req, res) => {
  try {
    await deleteQueueItem(req.params.id);
    res.json(await getQueueStats());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/email-queue', async (req, res) => {
  const { leadIds } = req.body || {};
  if (!Array.isArray(leadIds) || !leadIds.length)
    return res.status(400).json({ error: 'leadIds array required' });
  try {
    await addToQueue(leadIds);
    res.json(await getQueueStats());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/email-queue', async (req, res) => {
  try {
    await clearPendingQueue();
    res.json(await getQueueStats());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function start() {
  syncSettingsToEnv(await getAllSettings());
  await backfillOpportunityTypes();
  await checkOverdue().catch(err => console.error('[finance] overdue check failed:', err.message));
  setInterval(() => checkOverdue().catch(() => {}), 24 * 60 * 60 * 1000);
  await backfillScores().catch(err => console.error('[scoring] backfill failed:', err.message));
  const settings = await getAllSettings();
  replyChecker.start(settings.reply_poll_minutes || 10);
  // Background sender: drains the queue with jittered spacing + a daily cap
  // (configurable in Settings). Rapid manual sends auto-queue via sendOrQueue,
  // so nothing goes out faster than the pace allows.
  startQueueWorker();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nServer running at http://localhost:${PORT}`);
    console.log(`Dashboard  →  http://localhost:${PORT}`);
    console.log(`Gmail auth →  http://localhost:${PORT}/auth  (run once to connect Gmail)\n`);
  });
}

start();
