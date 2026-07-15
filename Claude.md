# Command Center

## What This Is
An internal enterprise dashboard for a growth / brand-scaling agency. It runs the full
agency operation — lead generation → outreach → pipeline → clients → finance →
analytics — as a set of focused "agents," each its own section of the dashboard.

## Agents (dashboard modules)
- **Overview** — KPIs, AI insights digest + "ask the dashboard" Q&A, Today panel (tasks + due follow-ups), activity feed, agent cards, recent leads.
- **Lead Scraper** — scrapes & auto-qualifies businesses from Google Places; every lead gets a deterministic 0–100 score.
- **Outreach Agent** — composes/sends cold emails + follow-ups via Gmail (HTML + open-tracking pixel); AI-personalized drafts from the lead's website; AI lead briefs; sorted by lead score; engagement dots (sent/opened).
- **Pipeline CRM** — kanban; replies are auto-detected from the Gmail inbox and move leads to "replied"; won leads convert to clients.
- **Clients** — client accounts with retainers, status, tasks, activity, invoices, and a shareable public report link per client.
- **Finance** — invoices (draft → sent via Gmail → paid/overdue; paying auto-logs income), income/expense tracking, MRR/P&L KPIs, charts, revenue goal + pipeline-weighted forecast, CSV exports.
- **Analytics** — funnel, opportunity mix, leads-over-time, conversion/reply rates (Chart.js).
- **Settings** — sender identity, Claude API key (masked, write-only), finance settings (goal/avg deal/invoice prefix), email tracking (public URL + toggle), integrations.

## Cross-cutting features
- **Command palette** — Ctrl/Cmd+K: jump to any lead/client/invoice/view, quick actions.
- **Notifications bell** — unread activity count (seen state in localStorage `bs_activity_seen`).
- **Activity log** — `activity` table written by scrape/email/status/client/invoice events; feeds Overview, bell, client detail, and public reports.

## Tech Stack
- Node.js + Express 5 (CommonJS) · SQLite (file DB)
- Google Places API (scraping) · Gmail API (send + readonly for reply detection)
- Claude API via `@anthropic-ai/sdk` (model `claude-opus-4-8`, adaptive thinking, structured outputs)
- Vanilla HTML/CSS/JS SPA (no build step) — Plus Jakarta Sans, dark OLED theme, Chart.js via CDN

## Project Structure
- `server.js` — Express server + all API routes (run this to start)
- `src/` — `database.js` (schema + all queries), `scraper.js`, `emailer.js` (plain + multipart HTML + pixel), `qualifier.js`, `scoring.js`, `ai.js` (all Claude calls), `finance.js` (invoice math/lifecycle/forecast), `reply-checker.js` (Gmail inbox polling), `report.js` (public client report), `email-finder.js`, `website-checker.js`
- `src/templates/` — email templates (one per opportunity type + follow-up)
- `dashboard/` — frontend: `index.html`, `style.css`, `app.js` (hash-routed SPA; `#clients/12` = client detail)
- `scripts/seed-demo.js` — idempotent demo seed (leads, clients, tasks, invoices, transactions)
- `.env` — secrets & local config (never committed)

## DB tables
`leads` (+score, ai_brief), `sessions`, `settings` (key/value), `clients` (+report_token),
`invoices`, `transactions`, `tasks`, `activity`, `email_events` (open tracking).
All migrations are additive (`CREATE TABLE IF NOT EXISTS` + ALTER w/ duplicate suppression) — never drop/rename.

## API surface
- Leads/pipeline: `GET /api/sessions` · `GET /api/leads` · `GET /api/stats` · `GET /api/analytics` · `POST /api/scrape` · `GET /api/leads/:id/preview|find-email` · `POST /api/leads/:id/contact|followup|convert` · `PUT/DELETE /api/leads/:id`
- Clients: `GET/POST /api/clients` · `GET/PUT/DELETE /api/clients/:id` · `POST/DELETE /api/clients/:id/report-token`
- Finance: `GET/POST /api/invoices` · `GET/PUT/DELETE /api/invoices/:id` · `POST /api/invoices/:id/send` · `GET/POST/DELETE /api/transactions(/:id)` · `GET /api/finance/summary|charts`
- AI: `GET /api/ai/status` · `POST /api/ai/outreach/:leadId` · `POST /api/ai/brief/:leadId` (`?refresh=true`) · `GET /api/ai/digest` (`?refresh=true`, daily-cached) · `POST /api/ai/ask` — all return `400 {code:'NO_API_KEY'}` without a key
- Tasks/feed: `GET/POST /api/tasks` · `PUT/DELETE /api/tasks/:id` · `GET /api/today` · `GET /api/activity`
- Exports: `GET /api/export/{leads,transactions,invoices}.csv`
- Settings: `GET/PUT /api/settings` (the Claude key is masked on GET; a masked echo on PUT is ignored)
- **PUBLIC (no auth):** `GET /api/health` · `GET /t/:token` (tracking pixel) · `GET /report/:token` (client report)

## How to Run (local)
1. `npm install`
2. Create `.env` (see below). For local previewing without Basic Auth, set `DISABLE_AUTH=true`.
3. `node server.js` → open http://localhost:3000
4. (optional) `node scripts/seed-demo.js` to populate demo data (idempotent).

## .env
```
PORT=3000
GOOGLE_PLACES_API_KEY=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=...
GMAIL_REFRESH_TOKEN=...        # set automatically after visiting /auth once
SENDER_NAME=...              # your name — signs outreach emails
SENDER_PHONE=...
COMPANY_NAME=...             # brand shown on emails, invoices & client reports
COMPANY_WEBSITE=...          # e.g. https://youragency.com
COMPANY_LOCATION=...         # e.g. Austin, TX
COMPANY_TAGLINE=...          # small label in the email header
CONTACT_EMAIL=...            # reply-to / "book a call" address in emails
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=changeme    # Basic Auth for the dashboard
# ANTHROPIC_API_KEY=...        # optional fallback; normally set in dashboard Settings
# DISABLE_AUTH=true            # LOCAL DEV ONLY — never set in production
```

## Settings stored in the DB (shared by both partners)
`sender_name`, `sender_phone`, `anthropic_api_key`, `revenue_goal_monthly`, `avg_deal_value`,
`invoice_prefix`, `app_base_url` (public Railway URL — required for tracking pixel + report links),
`tracking_enabled`, `reply_poll_minutes`, `reply_last_checked_at`, `ai_digest_cache`.

## ⚠️ Gmail scopes
`/auth` requests `gmail.send` **and** `gmail.readonly` (reply detection). After deploying
the reply-detection feature, each partner must visit `/auth` once more to re-grant.

## ⚠️ Persistence on Railway (important)
SQLite stores everything in a single file. Railway's container filesystem is
**ephemeral** — without a volume, the DB is wiped on every redeploy:
1. Railway → your service → **Volumes** → mount at `/data`.
2. Env var `DATABASE_PATH=/data/leads.db`.
3. Redeploy. The server auto-creates `/data` if missing.

Also set `DASHBOARD_USER` / `DASHBOARD_PASSWORD` (and do **not** set `DISABLE_AUTH`).
Set the `app_base_url` setting (in dashboard Settings → Email Open Tracking) to the public
Railway URL so tracking pixels and report links resolve. Healthcheck: `GET /api/health`.

## Configuration
Sender identity and brand shown on outreach emails, invoices, and client reports
are driven by env vars / dashboard Settings: `SENDER_NAME`, `SENDER_PHONE`,
`COMPANY_NAME`, `COMPANY_WEBSITE`, `COMPANY_LOCATION`, `COMPANY_TAGLINE`, `CONTACT_EMAIL`
(all fall back to neutral placeholders when unset).
