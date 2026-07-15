/**
 * Deterministic 0–100 lead score — no AI, no API calls, instant.
 *
 *   rating        0–25   (google rating / 5 × 25)
 *   reviews       0–20   (log scale — 200+ reviews maxes out)
 *   website       0–15   (has one, and it isn't known-broken)
 *   email         0–15   (we have somewhere to send outreach)
 *   opportunity   0–25   (how well their gap matches what we sell)
 */
const OPPORTUNITY_POINTS = {
  HIGH_POTENTIAL:    25, // good business, weak presence — ideal target
  NO_WEBSITE:        20, // clearest pitch, but often least sophisticated buyer
  SCALING_CANDIDATE: 15, // strong already, harder to land but big retainers
  WEAK_ADVERTISING:  10,
};

function computeScore(lead) {
  let score = 0;

  const rating = Number(lead.google_rating) || 0;
  score += Math.min(rating / 5, 1) * 25;

  const reviews = Number(lead.review_count) || 0;
  // log10(1)=0 … log10(200)≈2.3 → cap at 200 reviews
  score += Math.min(Math.log10(reviews + 1) / Math.log10(201), 1) * 20;

  if (lead.website && lead.website_status !== 'broken') score += 15;

  if (lead.email && String(lead.email).includes('@')) score += 15;

  score += OPPORTUNITY_POINTS[lead.opportunity_type] || 0;

  return Math.round(Math.min(score, 100));
}

// Startup pass: score anything unscored (mirrors backfillOpportunityTypes)
async function backfillScores() {
  const { getAllLeads, updateLeadScore } = require('./database');
  const leads = await getAllLeads();
  const missing = leads.filter(l => l.score == null);
  if (!missing.length) return 0;

  for (const lead of missing) {
    await updateLeadScore(lead.id, computeScore(lead));
  }
  console.log(`[scoring] backfilled scores for ${missing.length} leads`);
  return missing.length;
}

module.exports = { computeScore, backfillScores };
