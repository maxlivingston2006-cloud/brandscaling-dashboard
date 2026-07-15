const axios = require('axios');

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// Also catch obfuscated mailto: links like href="mailto:foo@bar.com"
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

// tel: links are the highest-confidence phone source (e.g. href="tel:+18135551234")
const TEL_REGEX = /tel:\+?([0-9().\-\s]{7,}\d)/gi;
// Fallback: North-American phone numbers in visible text
const PHONE_REGEX = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g;

const IGNORE = [
  /noreply/i, /no-reply/i, /donotreply/i, /postmaster/i,
  /@sentry/i, /@cloudflare/i, /@google/i, /@facebook/i,
  /example\.com$/i, /wixpress/i, /squarespace/i, /wordpress/i,
  /\.png$/i, /\.jpg$/i, /\.gif$/i,
];

const FB_SKIP = /\/(sharer|share|dialog|login|photo|video|events|groups|marketplace|watch|notes|policies|legal|help|messages|hashtag|permalink|ajax|plugins)\b/i;

function extractFacebookUrl(html) {
  const matches = String(html).match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'\s>#?]+/gi);
  if (!matches) return null;
  for (const url of matches) {
    if (!FB_SKIP.test(url)) return url.replace(/\/$/, '');
  }
  return null;
}

function extractEmails(html, found) {
  // mailto: links are highest confidence — check these first
  let m;
  const mailto = new RegExp(MAILTO_REGEX.source, 'gi');
  while ((m = mailto.exec(html)) !== null) {
    const email = m[1].toLowerCase();
    if (!IGNORE.some(p => p.test(email))) found.add(email);
  }
  // Fall back to plain regex scan
  const matches = String(html).match(EMAIL_REGEX) || [];
  for (const email of matches) {
    if (!IGNORE.some(p => p.test(email))) found.add(email.toLowerCase());
  }
}

// Collapse a raw phone string to its digits and format as (xxx) xxx-xxxx.
// Returns null if it isn't a plausible 10-digit US number.
function normalizePhone(raw) {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (digits[0] < '2') return null; // area codes never start with 0/1
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function extractPhones(html, found) {
  let m;
  // tel: links first — highest confidence
  const tel = new RegExp(TEL_REGEX.source, 'gi');
  while ((m = tel.exec(html)) !== null) {
    const p = normalizePhone(m[1]);
    if (p) found.add(p);
  }
  // Fall back to visible-text scan
  const phone = new RegExp(PHONE_REGEX.source, 'g');
  while ((m = phone.exec(html)) !== null) {
    const p = normalizePhone(m[0]);
    if (p) found.add(p);
  }
}

const GET_OPTS = {
  timeout:      5000,
  maxRedirects: 3,
  headers:      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
};

/**
 * Scrapes a business website for email addresses and phone numbers, then tries
 * more pages and the business's Facebook About page as a fallback.
 * Returns up to 5 email candidates (own-domain ranked first) and up to 3 phones.
 *
 * @param {string} url
 * @returns {Promise<{ emails: string[], phones: string[] }>}
 */
async function findEmailOnWebsite(url) {
  if (!url) return { emails: [], phones: [] };

  const base = url.startsWith('http') ? url : `https://${url}`;
  const root = base.replace(/\/$/, '');

  // Pages most likely to have contact info, in order
  const pagesToTry = [
    base,
    `${root}/contact`,
    `${root}/contact-us`,
    `${root}/about`,
    `${root}/about-us`,
  ];

  const found  = new Set();
  const phones = new Set();
  let facebookUrl = null;

  for (const page of pagesToTry) {
    try {
      const { data } = await axios.get(page, GET_OPTS);
      extractEmails(String(data), found);
      extractPhones(String(data), phones);
      if (!facebookUrl) facebookUrl = extractFacebookUrl(data);
    } catch {
      // page unreachable — try next
    }
    if (found.size >= 5 && phones.size >= 1) break;
  }

  // Facebook fallback — try the mobile About page which has simpler HTML
  if ((found.size === 0 || phones.size === 0) && facebookUrl) {
    // Convert to mobile About URL: m.facebook.com/pagename/about
    const fbAbout = facebookUrl
      .replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://m.facebook.com')
      + '/about';
    for (const fbUrl of [fbAbout, facebookUrl]) {
      try {
        const { data } = await axios.get(fbUrl, GET_OPTS);
        extractEmails(String(data), found);
        extractPhones(String(data), phones);
      } catch {
        // Facebook blocked or unreachable
      }
      if (found.size > 0) break;
    }
  }

  const emails = [...found];
  const phoneList = [...phones].slice(0, 3);

  // Rank own-domain emails first
  try {
    const domain = new URL(base).hostname.replace(/^www\./, '');
    const own    = emails.filter(e => e.includes(domain));
    const other  = emails.filter(e => !e.includes(domain));
    return { emails: [...own, ...other].slice(0, 5), phones: phoneList };
  } catch {
    return { emails: emails.slice(0, 5), phones: phoneList };
  }
}

module.exports = { findEmailOnWebsite };
