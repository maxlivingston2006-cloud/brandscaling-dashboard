require('dotenv').config();
const axios = require('axios');
const { insertLead, getAllLeads } = require('./database');
const { qualifyAdvanced } = require('./qualifier');
const { analyzeWebsite }  = require('./website-analyzer');

const API_KEY    = process.env.GOOGLE_PLACES_API_KEY;
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.photos',
  'nextPageToken',
].join(',');

// Google requires 2 s before a nextPageToken becomes usable
const PAGE_DELAY_MS  = 2000;
// Short pause between variation queries
const QUERY_DELAY_MS = 500;
// Hard cap: 3 pages × 20 results = 60 max per query variant
const MAX_PAGES = 3;

// ─── Search variations ────────────────────────────────────────────────────────
// If the user's query contains a key (case-insensitive), all listed variants
// are automatically searched and deduplicated before saving.
const SEARCH_VARIATIONS = {
  'med spa':          ['med spa', 'medical spa', 'aesthetic clinic', 'skin clinic'],
  'medspa':           ['medspa', 'med spa', 'medical spa', 'aesthetic clinic'],
  'life coach':       ['life coach', 'life coaching', 'personal development coach', 'mindset coach'],
  'personal trainer': ['personal trainer', 'personal training', 'fitness coach'],
  'chiropractor':     ['chiropractor', 'chiropractic clinic', 'chiropractic care'],
  'dentist':          ['dentist', 'dental office', 'dental clinic', 'dental practice'],
  'real estate':      ['real estate agent', 'realtor', 'real estate broker'],
  'nutritionist':     ['nutritionist', 'dietitian', 'nutrition coach', 'wellness coach'],
  'therapist':        ['therapist', 'mental health counselor', 'psychotherapist', 'counselor'],
  'gym':              ['gym', 'fitness center', 'health club', 'crossfit gym'],
  'yoga':             ['yoga studio', 'yoga instructor', 'pilates studio'],
  'accountant':       ['accountant', 'accounting firm', 'cpa', 'tax preparation'],
  'plumber':          ['plumber', 'plumbing service', 'plumbing contractor'],
  'electrician':      ['electrician', 'electrical contractor', 'electrical service'],
  'roofing':          ['roofing contractor', 'roofer', 'roofing company', 'roof repair'],
  'hvac':             ['hvac', 'air conditioning', 'heating and cooling', 'ac repair'],
  'landscaping':      ['landscaping', 'lawn care', 'landscape design', 'lawn service'],
};

function getVariations(query) {
  const q = query.toLowerCase().trim();
  for (const [key, variants] of Object.entries(SEARCH_VARIATIONS)) {
    if (q.includes(key)) return variants;
  }
  return [query];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(textQuery, pageToken = null) {
  const body = { textQuery };
  if (pageToken) body.pageToken = pageToken;

  const { data } = await axios.post(SEARCH_URL, body, {
    headers: {
      'X-Goog-Api-Key':   API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
      'Content-Type':     'application/json',
    },
  });
  return data;
}

// Fetch up to MAX_PAGES for one query variant.
// Pushes qualifying leads directly into `saved`; updates `seen` to prevent dups.
// Stops early if saved.length reaches totalCap.
async function scrapeQuery(textQuery, category, totalCap, seen, saved, allowedTypes = null, sessionId = null) {
  console.log(`\n  → variant: "${textQuery}"`);
  let pageToken = null;
  let pageNum   = 0;

  do {
    if (pageToken) {
      console.log(`     waiting ${PAGE_DELAY_MS / 1000}s for next_page_token…`);
      await sleep(PAGE_DELAY_MS);
    }

    const page   = await fetchPage(textQuery, pageToken);
    const places = page.places || [];
    pageNum++;

    console.log(`     page ${pageNum}: ${places.length} places returned`);
    if (places.length === 0) break;

    for (const place of places) {
      if (saved.length >= totalCap) break;

      const business_name = place.displayName?.text || '';
      const address       = place.formattedAddress  || '';
      const key           = dedupKey(business_name, address);

      if (seen.has(key)) {
        console.log(`     [dup]  ${business_name}`);
        continue;
      }
      seen.add(key);

      const website       = place.websiteUri        || null;
      const google_rating = place.rating            ?? 0;
      const review_count  = place.userRatingCount   ?? 0;
      const photo_count   = (place.photos || []).length;
      const primary_type  = place.primaryType        || null;

      const analysis         = await analyzeWebsite(website);
      const opportunity_type = qualifyAdvanced(website, google_rating, review_count, analysis, photo_count);

      // Skip if caller only wants specific opportunity types
      if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(opportunity_type)) {
        console.log(`     [skip] ${business_name} → ${opportunity_type} (filtered out)`);
        continue;
      }

      const lead = {
        business_name,
        category,
        address,
        phone:         place.nationalPhoneNumber || '',
        website,
        google_rating,
        review_count,
        email:         '',
        opportunity_type,
        notes:         null,
        session_id:    sessionId,
        date_added:    new Date().toISOString(),
      };

      await insertLead(lead);
      saved.push(lead);
      console.log(`     [+] ${business_name} → ${opportunity_type} (${review_count} reviews, ${google_rating}★)`);
    }

    pageToken = (saved.length < totalCap && page.nextPageToken) ? page.nextPageToken : null;
  } while (pageToken && pageNum < MAX_PAGES);
}

/**
 * Scrape Google Places for leads matching `query` near `location`.
 * Automatically expands to related search variants and deduplicates results.
 *
 * @param {string} query
 * @param {string} location
 * @param {object} options
 * @param {number} [options.maxResults=60]  total cap across all variants
 * @param {string} [options.category]       DB category label (defaults to query)
 */
async function scrapeLeads(query, location, options = {}) {
  if (!API_KEY || API_KEY === 'your_key_here') {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in .env');
  }

  const { maxResults = 60, category = query, allowedTypes = null, sessionId = null } = options;
  const variations = getVariations(query);

  console.log(`\n[scrape] query="${query}" location="${location}" maxResults=${maxResults}`);
  if (variations.length > 1) {
    console.log(`[variants] ${variations.length} search terms: ${variations.join(' | ')}`);
  }

  // Load existing leads once for deduplication across ALL variants
  const existing = await getAllLeads();
  const seen     = new Set(existing.map(l => dedupKey(l.business_name, l.address)));
  console.log(`[dedup]  ${existing.length} existing leads loaded into dedup set`);

  const saved = [];

  for (let i = 0; i < variations.length; i++) {
    if (saved.length >= maxResults) break;
    if (i > 0) await sleep(QUERY_DELAY_MS);
    await scrapeQuery(`${variations[i]} ${location}`, category, maxResults, seen, saved, allowedTypes, sessionId);
  }

  // ── Summary breakdown ──────────────────────────────────────────────────────
  const counts = {};
  for (const lead of saved) {
    counts[lead.opportunity_type] = (counts[lead.opportunity_type] || 0) + 1;
  }

  console.log(`\n[done] ${saved.length} new leads saved across ${variations.length} variant(s)`);
  const order = ['NO_WEBSITE', 'WEAK_ADVERTISING', 'HIGH_POTENTIAL', 'SCALING_CANDIDATE'];
  for (const type of order) {
    if (counts[type]) {
      const pct = Math.round((counts[type] / saved.length) * 100);
      console.log(`  ${type.padEnd(20)} ${counts[type]} (${pct}%)`);
    }
  }

  return saved;
}

function dedupKey(name, address) {
  return `${name.trim().toLowerCase()}|${address.trim().toLowerCase()}`;
}

module.exports = { scrapeLeads };

// CLI: node src/scraper.js "life coaches" "Tampa, FL" 20
if (require.main === module) {
  const [, , query, location, maxResults] = process.argv;
  if (!query || !location) {
    console.error('Usage: node src/scraper.js "<query>" "<location>" [maxResults]');
    process.exit(1);
  }
  scrapeLeads(query, location, { maxResults: Number(maxResults) || 60 })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Scrape failed:', err.message);
      process.exit(1);
    });
}
