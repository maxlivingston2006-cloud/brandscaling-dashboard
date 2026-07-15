require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const { updateLeadStatus, getAllSettings, insertEmailEvent } = require('./database');
const { nameFromEmail, cityFromAddress, titleCase } = require('./personalize');
const { selectTemplate } = require('./niches');

// ---------------------------------------------------------------------------
// OAuth2 client — exported so server.js can reuse it for the /auth flow
// ---------------------------------------------------------------------------
function getOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  if (process.env.GMAIL_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------
function loadTemplate(filename) {
  return fs.readFileSync(path.join(__dirname, 'templates', filename), 'utf8');
}

function applyTemplate(raw, vars) {
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// Templates store the subject on the first line as "Subject: ..."
// Everything after the blank line that follows is the body.
function parseTemplate(text) {
  const lines = text.split('\n');
  const subjectIdx = lines.findIndex(l => l.startsWith('Subject:'));
  if (subjectIdx === -1) throw new Error('Template missing Subject: line');
  const subject = lines[subjectIdx].replace('Subject:', '').trim();
  const body    = lines.slice(subjectIdx + 1).join('\n').trimStart();
  return { subject, body };
}

// ---------------------------------------------------------------------------
// Merge-field resolution — shared by preview + send so both render identically.
// Every token has a natural fallback so nothing ever renders blank
// ("Hi {{first_name}}," becomes "Hi there," when no name is known).
// ---------------------------------------------------------------------------

// The one line that adapts to the lead's opportunity type. Kept generic (no
// niche noun) so it slots cleanly after any niche-specific opener.
function observationFor(opportunityType) {
  if (opportunityType === 'NO_WEBSITE') {
    return "I noticed you don't have a website yet, so when people search for you online they can't find you.";
  }
  return "I noticed you're not really showing up in local search right now, which usually means those leads are going to competitors.";
}

function resolveVars(lead) {
  const name = lead.owner_name || nameFromEmail(lead.email);
  return {
    business_name: lead.business_name,
    business_type: lead.category || 'business',
    first_name:    name ? titleCase(name) : 'there',
    city:          cityFromAddress(lead.address) || 'your area',
    observation:   observationFor(lead.opportunity_type),
    sender_name:   process.env.SENDER_NAME  || 'Your Name',
    sender_phone:  process.env.SENDER_PHONE || '(555) 000-0000',
  };
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------
const P_STYLE = "font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:400;line-height:1.75;color:#525252;margin:0 0 18px 0;";

function textToHtmlParagraphs(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map(para => `<p style="${P_STYLE}">${para.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function wrapInHtmlTemplate(plainText, logoSrc) {
  const bodyHtml = textToHtmlParagraphs(plainText);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#fafafa;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafafa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:16px;overflow:hidden;box-shadow:0 12px 44px rgba(0,0,0,0.09);">
          <!-- TOP ACCENT -->
          <tr>
            <td style="height:4px;line-height:4px;font-size:4px;background-color:#FF4D00;">&nbsp;</td>
          </tr>
          <!-- HEADER -->
          <tr>
            <td style="background-color:#ffffff;padding:30px 40px 26px 40px;border-bottom:1px solid rgba(0,0,0,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td><a href="${co.website}" style="text-decoration:none;display:inline-block;">${logoSrc ? `<img src="${logoSrc}" alt="${co.name}" width="132" height="85" style="display:block;border:0;">` : `<span style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#0d0d0d;letter-spacing:-0.5px;">${co.name}</span>`}</a></td>
                  <td align="right"><span style="font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;color:#FF4D00;letter-spacing:2px;text-transform:uppercase;">${co.tagline}</span></td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- VALUE-PROP BANNER -->
          <tr>
            <td style="background-color:#FF4D00;padding:15px 40px;">
              <p style="margin:0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#ffffff;letter-spacing:-0.2px;text-align:center;">Same budget. <span style="color:#0d0d0d;">3&times; the revenue.</span></p>
            </td>
          </tr>
          <!-- BODY CONTENT -->
          <tr>
            <td style="background-color:#ffffff;padding:44px 40px 36px 40px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- CTA BLOCK -->
          <tr>
            <td style="background-color:#ffffff;padding:0 40px 8px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF4F0;border:1px solid rgba(255,77,0,0.12);border-radius:14px;">
                <tr>
                  <td style="padding:32px 32px;">
                    <h2 style="margin:0 0 6px 0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:#0d0d0d;letter-spacing:-0.4px;">Ready to see what's possible?</h2>
                    <p style="margin:0 0 24px 0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:400;color:#666666;line-height:1.6;">Takes 20 minutes. No pitch — just an honest look at what we'd do for your business.</p>
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#FF4D00;border-radius:10px;">
                          <a href="mailto:${co.email}" style="display:inline-block;padding:14px 28px;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.2px;">Book a Free Call →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background-color:#ffffff;padding:26px 40px 32px 40px;border-top:1px solid rgba(0,0,0,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#0d0d0d;">${co.people}</p>
                    <p style="margin:0 0 12px 0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:400;color:#999999;">${co.name} — ${co.location} &nbsp;·&nbsp; <a href="${co.website}" style="color:#FF4D00;text-decoration:none;font-weight:600;">${websiteLabel}</a></p>
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:16px;"><a href="${telHref}" style="font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;color:#666666;text-decoration:none;">${co.phone}</a></td>
                        <td><a href="mailto:${co.email}" style="font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;color:#666666;text-decoration:none;">${co.email}</a></td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" valign="middle">
                    <p style="margin:0;font-family:'Plus Jakarta Sans','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10px;font-weight:400;color:#bbbbbb;">To unsubscribe, reply with "unsubscribe"</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Build a base64url-encoded RFC 2822 message for the Gmail API.
// Pass `html` to send multipart/alternative — the plain part is kept first
// for deliverability, the HTML part is what most clients render.
function encodeMessage({ to, subject, body, html }) {
  // RFC 2047 encode the subject so non-ASCII characters survive transit
  const encSubject = /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

  let raw;
  if (html) {
    const boundary = 'bs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    raw = [
      `To: ${to}`,
      `Subject: ${encSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body || '',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    raw = [
      `To: ${to}`,
      `Subject: ${encSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');
  }
  return Buffer.from(raw).toString('base64url');
}

// Generic HTML sender (invoices, reports) — independent of the lead pipeline.
async function sendHtmlEmail({ to, subject, html, text }) {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === 'will_be_generated_later') {
    throw new Error('GMAIL_REFRESH_TOKEN not set — visit /auth to complete the OAuth2 flow');
  }
  if (!to) throw new Error('No recipient email address');

  const auth  = getOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodeMessage({ to, subject, body: text || '', html }) },
  });
  return { sentTo: to, subject };
}

// ---------------------------------------------------------------------------
// Core send logic (shared by both outreach and follow-up)
// ---------------------------------------------------------------------------
async function send(lead, templateFile, newStatus, overrides = {}) {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === 'will_be_generated_later') {
    throw new Error('GMAIL_REFRESH_TOKEN not set — visit /auth to complete the OAuth2 flow');
  }
  if (!lead.email) {
    throw new Error(`Lead "${lead.business_name}" has no email address`);
  }

  let subject, body;
  if (overrides.subject && overrides.body) {
    // Use whatever the user typed in the preview modal
    subject = overrides.subject;
    body    = overrides.body;
  } else {
    const vars = resolveVars(lead);
    ({ subject, body } = parseTemplate(applyTemplate(loadTemplate(templateFile), vars)));
  }

  // Cold outreach ships as PLAIN TEXT — no branded HTML wrapper, no logo, no
  // CTA card. A genuine-looking 1:1 text email lands far better in cold-email
  // deliverability. (Invoices/reports still use HTML via sendHtmlEmail.)
  // Note: open tracking is disabled for outreach because the tracking pixel is
  // an HTML image, which a text/plain body cannot carry.
  const auth   = getOAuth2Client();
  const gmail  = google.gmail({ version: 'v1', auth });

  await gmail.users.messages.send({
    userId:      'me',
    requestBody: { raw: encodeMessage({ to: lead.email, subject, body }) },
  });

  const dateContacted = new Date().toISOString();
  await updateLeadStatus(lead.id, newStatus, dateContacted);

  return { subject, sentTo: lead.email, status: newStatus, dateContacted, tracked: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function sendOutreach(lead, overrides = {}) {
  // Template chosen by niche (from the lead's category), with tiered fallback.
  const template = selectTemplate(lead.category);
  return send(lead, template, 'contacted', overrides);
}

async function sendFollowUp(lead, overrides = {}) {
  return send(lead, 'followup.txt', 'followed_up', overrides);
}

// Returns the rendered { subject, body } without sending — used for preview modal
function previewEmail(lead, type = 'outreach') {
  const templateFile = type === 'followup' ? 'followup.txt' : selectTemplate(lead.category);
  return parseTemplate(applyTemplate(loadTemplate(templateFile), resolveVars(lead)));
}

module.exports = { sendOutreach, sendFollowUp, previewEmail, getOAuth2Client, sendHtmlEmail };
