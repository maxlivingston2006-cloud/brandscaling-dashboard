/**
 * Reply detection — polls the Gmail inbox for messages from contacted leads
 * and auto-moves them to "replied" on the pipeline.
 *
 * Requires the gmail.readonly scope: partners must re-visit /auth once after
 * this feature ships (the /auth route requests both scopes).
 */
const { google } = require('googleapis');
const { getOAuth2Client } = require('./emailer');
const {
  getContactedLeads, updateLeadStatus, logActivity, getAllSettings, setSetting, getLeadById,
} = require('./database');

let inFlight = false;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function checkReplies() {
  if (inFlight) return;
  inFlight = true;
  try {
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!refreshToken || refreshToken === 'will_be_generated_later') return;

    const leads = await getContactedLeads();
    if (!leads.length) return;

    const settings = await getAllSettings();
    // Look back 7 days on the first run, then only since the last check
    const lastChecked = Number(settings.reply_last_checked_at) || (Date.now() - 7 * 86400000);
    const afterEpoch = Math.floor(lastChecked / 1000);

    const gmail = google.gmail({ version: 'v1', auth: getOAuth2Client() });
    const byEmail = new Map(leads.map(l => [l.email.toLowerCase(), l]));

    let repliesFound = 0;
    for (const group of chunk([...byEmail.keys()], 20)) {
      const q = `from:(${group.join(' OR ')}) after:${afterEpoch} in:inbox`;
      let list;
      try {
        list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
      } catch (err) {
        // Missing readonly scope is the common cause — surface once, keep server alive
        if (String(err.message).includes('insufficient') || err.code === 403) {
          console.error('[replies] Gmail readonly scope missing — visit /auth to re-connect Gmail');
          return;
        }
        throw err;
      }

      for (const msg of list.data.messages || []) {
        const detail = await gmail.users.messages.get({
          userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['From'],
        });
        const fromHeader = (detail.data.payload?.headers || [])
          .find(h => h.name === 'From')?.value || '';
        const match = fromHeader.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        if (!match) continue;

        const lead = byEmail.get(match[0].toLowerCase());
        if (!lead) continue;

        // Re-read in case another reply in the same batch already flipped it
        const fresh = await getLeadById(lead.id);
        if (!fresh || !['contacted', 'followed_up'].includes(fresh.status)) continue;

        await updateLeadStatus(lead.id, 'replied', fresh.date_contacted);
        await logActivity('reply_detected', `${lead.business_name} replied to your email 🎉`, { lead_id: lead.id });
        byEmail.delete(match[0].toLowerCase());
        repliesFound++;
      }
    }

    await setSetting('reply_last_checked_at', String(Date.now()));
    if (repliesFound) console.log(`[replies] detected ${repliesFound} new repl${repliesFound === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    console.error('[replies] check failed:', err.message);
  } finally {
    inFlight = false;
  }
}

function start(intervalMinutes = 10) {
  const ms = Math.max(2, Number(intervalMinutes) || 10) * 60 * 1000;
  setInterval(() => checkReplies(), ms);
  // First pass shortly after boot so a restart doesn't delay detection
  setTimeout(() => checkReplies(), 15 * 1000);
  console.log(`[replies] watching inbox every ${Math.round(ms / 60000)} min`);
}

module.exports = { checkReplies, start };
