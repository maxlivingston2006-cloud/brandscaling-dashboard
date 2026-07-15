'use strict';
const {
  getAllSettings, setSetting, getNextPendingQueueItem, getLeadById,
  getSentCountLast24h, markQueueItemSent, markQueueItemFailed, logActivity,
} = require('./database');
const { sendOutreach, sendFollowUp } = require('./emailer');
const { readPace, randomGapSec, withinWindow, nextGapSec } = require('./pacing');

// Poll often; the actual send cadence is governed by `queue_next_send_at` +
// jittered gaps, not the poll interval. So checking every 10s is cheap and
// lets a freshly-queued email go out promptly once its slot is due.
const POLL_MS = 10_000;
let _timer = null;
let _busy  = false;

async function tick() {
  if (_busy) return;
  _busy = true;
  let item = null;
  try {
    const settings = await getAllSettings();
    const pace = readPace(settings);

    // Business-hours gate — hold everything outside the daily sending window.
    if (!withinWindow(settings)) return;

    // Daily cap (rolling 24h). Hold the queue until sends age out of the window.
    const sent24h = await getSentCountLast24h();
    if (sent24h >= pace.cap) return;

    // Spacing gate — don't send before the next scheduled slot.
    const nextAt = settings.queue_next_send_at ? Date.parse(settings.queue_next_send_at) : 0;
    if (Date.now() < nextAt) return;

    item = await getNextPendingQueueItem();
    if (!item) return;

    const lead = await getLeadById(item.lead_id);
    if (!lead || !lead.email) {
      await markQueueItemFailed(item.id, 'Lead not found or has no email');
      return;
    }

    const overrides = (item.subject && item.body) ? { subject: item.subject, body: item.body } : {};
    if (item.type === 'followup') await sendFollowUp(lead, overrides);
    else                          await sendOutreach(lead, overrides);

    await markQueueItemSent(item.id);
    await logActivity('email_sent', `Queued ${item.type} sent to ${lead.business_name}`, { lead_id: lead.id });

    // Reserve the next slot — spread the remaining daily quota across the rest
    // of today's window (floored at the min gap), so a big batch trickles out
    // over the day instead of bursting.
    const gap = nextGapSec(settings, pace, sent24h);
    await setSetting('queue_next_send_at', new Date(Date.now() + gap * 1000).toISOString());
    console.log(`[queue] sent to ${lead.email} (item ${item.id}); next in ${gap}s`);
  } catch (err) {
    console.error('[queue] send error:', err.message);
    if (item) {
      // Mark failed so a persistent error (e.g. invalid_grant) doesn't loop,
      // and back off before the next attempt.
      await markQueueItemFailed(item.id, err.message).catch(() => {});
      try {
        const pace = readPace(await getAllSettings());
        await setSetting('queue_next_send_at', new Date(Date.now() + randomGapSec(pace) * 1000).toISOString());
      } catch { /* ignore */ }
    }
  } finally {
    _busy = false;
  }
}

function startQueueWorker() {
  if (_timer) clearInterval(_timer);
  _timer = setInterval(tick, POLL_MS);
  console.log(`[queue] worker started — polling every ${POLL_MS / 1000}s, jittered spacing + daily cap`);
}

module.exports = { startQueueWorker };
