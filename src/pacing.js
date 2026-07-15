// ---------------------------------------------------------------------------
// Sending pace — shared by the queue worker and the contact endpoint so both
// enforce the same human-like spacing and daily cap. Values come from settings
// (editable in the dashboard) with safe defaults.
// ---------------------------------------------------------------------------

const DEFAULTS = { gapMin: 120, gapMax: 300, cap: 40 }; // 2–5 min, 40/day

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readPace(settings = {}) {
  const gapMin = Math.max(15, toInt(settings.email_gap_min_sec, DEFAULTS.gapMin));
  const gapMax = Math.max(gapMin, toInt(settings.email_gap_max_sec, DEFAULTS.gapMax));
  const cap    = Math.max(1, toInt(settings.email_daily_cap, DEFAULTS.cap));
  return { gapMin, gapMax, cap };
}

// A random gap (seconds) within the configured range — the jitter that keeps
// the cadence from looking like a bot metronome.
function randomGapSec({ gapMin, gapMax }) {
  return gapMin + Math.floor(Math.random() * (gapMax - gapMin + 1));
}

// ── Sending window (local business hours) ───────────────────────────────────
// Emails only go out inside this daily window, in the configured timezone.
// Default: 8:30am–6:30pm Eastern (Florida). DST is handled automatically via
// Intl, so it tracks real Eastern time year-round.
const DEFAULT_WINDOW = { startMin: 8 * 60 + 30, endMin: 18 * 60 + 30, tz: 'America/New_York' };

function parseHM(value, fallbackMin) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallbackMin;
  const h = Math.min(23, parseInt(m[1], 10));
  const min = Math.min(59, parseInt(m[2], 10));
  return h * 60 + min;
}

function readWindow(settings = {}) {
  return {
    startMin: parseHM(settings.send_window_start, DEFAULT_WINDOW.startMin),
    endMin:   parseHM(settings.send_window_end,   DEFAULT_WINDOW.endMin),
    tz:       settings.send_window_tz || DEFAULT_WINDOW.tz,
  };
}

// Minutes since midnight in the given IANA timezone (DST-aware).
function minutesInZone(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  let h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  if (h === 24) h = 0; // some ICU builds report midnight as 24
  return h * 60 + m;
}

function withinWindow(settings = {}, date = new Date()) {
  const { startMin, endMin, tz } = readWindow(settings);
  const cur = minutesInZone(tz, date);
  return startMin <= endMin ? (cur >= startMin && cur < endMin) : (cur >= startMin || cur < endMin);
}

// Approximate next moment the window is open — used to show a send ETA when
// something is queued outside business hours.
function nextWindowOpen(settings = {}, from = new Date()) {
  if (withinWindow(settings, from)) return from;
  let t = new Date(from);
  for (let i = 0; i < 24 * 4; i++) {          // step 15 min, up to 24h
    t = new Date(t.getTime() + 15 * 60 * 1000);
    if (withinWindow(settings, t)) return t;
  }
  return t;
}

// Seconds left in today's window (>=60). Assumes we're currently inside it.
function secondsUntilWindowClose(settings = {}, date = new Date()) {
  const { endMin, tz } = readWindow(settings);
  const cur = minutesInZone(tz, date);
  return Math.max(60, (endMin - cur) * 60);
}

// The gap (seconds) before the NEXT send, so the remaining daily quota is
// spread evenly across the remaining window instead of bursting. `sentSoFar`
// is the count already sent today (before the send we just made). Never faster
// than the jittered 2–5 min floor; lightly jittered so it isn't a metronome.
function nextGapSec(settings, pace, sentSoFar, date = new Date()) {
  const floor     = randomGapSec(pace);
  const remaining = Math.max(1, pace.cap - sentSoFar - 1); // sends left after this one
  const spread    = secondsUntilWindowClose(settings, date) / remaining;
  const jittered  = spread * (0.85 + Math.random() * 0.3);
  return Math.round(Math.max(floor, jittered));
}

module.exports = {
  DEFAULTS, readPace, randomGapSec, readWindow, withinWindow, nextWindowOpen,
  secondsUntilWindowClose, nextGapSec,
};
