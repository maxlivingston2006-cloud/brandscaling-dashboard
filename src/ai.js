/**
 * AI engine — all Claude API calls (official @anthropic-ai/sdk).
 * Key resolution: settings.anthropic_api_key → env ANTHROPIC_API_KEY.
 * Every caller must tolerate the NO_API_KEY error and degrade gracefully.
 */
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { recommendPackage } = require('./packages');

const MODEL = 'claude-opus-4-8';

function getApiKey(settings = {}) {
  return settings.anthropic_api_key || process.env.ANTHROPIC_API_KEY || null;
}

function isConfigured(settings = {}) {
  return !!getApiKey(settings);
}

function noKeyError() {
  const err = new Error('Add your Claude API key in Settings to use AI features.');
  err.code = 'NO_API_KEY';
  return err;
}

// Single entry point for Claude calls. Pass `schema` to get parsed JSON back,
// omit it for plain text. claude-opus-4-8: adaptive thinking only, no sampling params.
async function callClaude({ settings, system, user, schema, maxTokens = 6000 }) {
  const apiKey = getApiKey(settings);
  if (!apiKey) throw noKeyError();

  const client = new Anthropic({ apiKey });
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (schema) {
    params.output_config = { format: { type: 'json_schema', schema } };
  }

  const response = await client.messages.create(params);
  const text = response.content.find(b => b.type === 'text')?.text || '';
  return schema ? JSON.parse(text) : text.trim();
}

// ─── Website text — context for personalization ─────────────────────────────
// Same fetch posture as email-finder: short timeout, graceful empty result.
async function fetchWebsiteText(url) {
  if (!url) return '';
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 3,
      maxContentLength: 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: s => s < 400,
    });
    const html = String(res.data || '');
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 8000);
  } catch {
    return '';
  }
}

// ─── Personalized outreach ───────────────────────────────────────────────────
const OUTREACH_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Email subject line, under 60 characters, no clickbait' },
    body:    { type: 'string', description: 'Plain-text email body with line breaks, ready to send' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
};

async function generateOutreach(lead, websiteText, settings, type = 'outreach') {
  const senderName  = settings.sender_name  || process.env.SENDER_NAME  || 'our team';
  const senderPhone = settings.sender_phone || process.env.SENDER_PHONE || '';
  const plan = recommendPackage(lead);

  const system = `You write cold outreach emails for a growth agency that helps
local service businesses grow through better websites, advertising, and brand presence.
Voice: confident, specific, human — never salesy, never generic, no buzzwords, no em-dash overuse.
Keep emails under 150 words. Structure: one concrete observation about THEIR business, then pitch
the specific recommended plan — name it, say what it includes in their terms (tie it to the gap you
observed), and state the price plainly without apologizing for it. End with one low-friction call to
action (a quick call or reply). Sign off as ${senderName}${senderPhone ? `, ${senderPhone}` : ''}.`;

  const user = `Write a ${type === 'followup' ? 'short, polite follow-up to a previous cold email (reference that you reached out before, add one NEW angle, and re-anchor the recommended plan below)' : 'first-touch cold outreach email'} to this business:

Business: ${lead.business_name}
Category: ${lead.category || 'local business'}
Location: ${lead.address || 'unknown'}
Google rating: ${lead.google_rating ?? 'n/a'} (${lead.review_count ?? 0} reviews)
Website: ${lead.website || 'NONE — they have no website at all'}
Opportunity angle: ${lead.opportunity_type || 'unknown'}

RECOMMENDED PLAN TO OFFER (pitch this one, not the whole menu):
- Plan: ${plan.name}
- Price: ${plan.price}
- Includes: ${plan.includes}
- Why it fits them: ${plan.reason}

${websiteText ? `Content from their website (use 1-2 specific details from this to personalize — mention something real):\n"""${websiteText}"""` : 'No website content available — personalize from the rating/review/no-website angle instead.'}`;

  const draft = await callClaude({ settings, system, user, schema: OUTREACH_SCHEMA, maxTokens: 4000 });
  return { ...draft, recommended_plan: { name: plan.name, price: plan.price, key: plan.key } };
}

// ─── Lead brief ──────────────────────────────────────────────────────────────
const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    summary:     { type: 'string', description: 'Two-sentence overview of the business and how winnable they are' },
    strengths:   { type: 'array', items: { type: 'string' }, description: '2-4 things going well for them' },
    weaknesses:  { type: 'array', items: { type: 'string' }, description: '2-4 gaps the agency could fix' },
    pitch_angle: { type: 'string', description: 'The single strongest angle to lead with when pitching them' },
  },
  required: ['summary', 'strengths', 'weaknesses', 'pitch_angle'],
  additionalProperties: false,
};

async function generateBrief(lead, websiteText, settings) {
  const system = `You are a sharp agency strategist preparing a pre-call brief on a prospect for
a growth agency (websites, ads, brand growth for local service businesses). Be concrete and honest —
weak prospects should read as weak. Base claims only on the data given.`;

  const user = `Prepare a brief on this prospect:

Business: ${lead.business_name}
Category: ${lead.category || 'local business'}
Location: ${lead.address || 'unknown'}
Google rating: ${lead.google_rating ?? 'n/a'} (${lead.review_count ?? 0} reviews)
Website: ${lead.website || 'NONE'}
Pipeline status: ${lead.status}
Our notes: ${lead.notes || 'none'}

${websiteText ? `Their website content:\n"""${websiteText}"""` : 'No website content available.'}`;

  return callClaude({ settings, system, user, schema: BRIEF_SCHEMA, maxTokens: 4000 });
}

// ─── Insights digest ─────────────────────────────────────────────────────────
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 short, specific, actionable insights. Each one sentence, may start with an emoji.',
    },
  },
  required: ['bullets'],
  additionalProperties: false,
};

async function generateDigest(context, settings) {
  const system = `You are the operations brain of a growth agency.
Given a snapshot of their pipeline and finances, produce 3-5 sharp insights: what's working,
what's stalling, and the single highest-leverage action for this week. Be specific — reference
actual numbers from the snapshot. No fluff, no restating the obvious.`;

  return callClaude({
    settings, system,
    user: `Workspace snapshot (JSON):\n${JSON.stringify(context, null, 2)}`,
    schema: DIGEST_SCHEMA,
    maxTokens: 4000,
  });
}

// ─── Ask the dashboard ───────────────────────────────────────────────────────
async function askDashboard(question, context, settings) {
  const system = `You answer questions for the team running the agency using ONLY the
workspace snapshot provided. Answer in 1-4 sentences, plain text, with concrete numbers where
relevant. If the snapshot can't answer the question, say so briefly. Today is ${new Date().toISOString().slice(0, 10)}.`;

  return callClaude({
    settings, system,
    user: `Workspace snapshot (JSON):\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}`,
    maxTokens: 2000,
  });
}

// ─── Owner-name extraction (best-effort personalization) ────────────────────
const OWNER_NAME_SCHEMA = {
  type: 'object',
  properties: {
    first_name: {
      type: ['string', 'null'],
      description: "Owner/founder/primary-contact FIRST name only, or null if none is clearly stated",
    },
  },
  required: ['first_name'],
  additionalProperties: false,
};

/**
 * Reads a business website and returns the owner/founder first name if one is
 * clearly stated. Best-effort: returns null on no key, no website, or no clear
 * name — never throws. Used to personalize the outreach greeting.
 */
async function extractOwnerName({ settings = {}, website, businessName } = {}) {
  if (!isConfigured(settings) || !website) return null;
  try {
    const root = website.replace(/\/$/, '');
    const texts = await Promise.all([
      fetchWebsiteText(website),
      fetchWebsiteText(`${root}/about`),
    ]);
    const pageText = texts.filter(Boolean).join('\n').slice(0, 8000);
    if (!pageText) return null;

    const system = `You extract the owner, founder, or primary contact person's FIRST name from a
local business website. Return a name ONLY when the text clearly ties a specific person to running the
business (e.g. "Owner: Mike Johnson", "Founded by Sarah", an About/team bio). Never guess from generic
copy. If no specific person is clearly named, return null.`;
    const user = `Business: ${businessName || 'unknown'}\n\nWebsite text:\n${pageText}`;

    const result = await callClaude({ settings, system, user, schema: OWNER_NAME_SCHEMA, maxTokens: 500 });
    const name = (result?.first_name || '').toString().trim();
    if (!name) return null;
    // Guard against the model returning a phrase instead of a single name.
    const first = name.split(/\s+/)[0];
    if (!/^[A-Za-z][A-Za-z'\-]{1,20}$/.test(first)) return null;
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch {
    return null;
  }
}

module.exports = {
  isConfigured, fetchWebsiteText,
  generateOutreach, generateBrief, generateDigest, askDashboard, extractOwnerName,
};
