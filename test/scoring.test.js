const test = require('node:test');
const assert = require('node:assert/strict');
const { computeScore, getScoreBreakdown } = require('../src/scoring');

test('score breakdown explains every scoring category and matches total', () => {
  const lead = {
    google_rating: 4.8,
    review_count: 240,
    website: 'https://example.test',
    email: 'owner@example.test',
    opportunity_type: 'SCALING_CANDIDATE',
  };
  const breakdown = getScoreBreakdown(lead);

  assert.equal(breakdown.total, computeScore(lead));
  assert.equal(breakdown.factors.length, 5);
  assert.deepEqual(breakdown.factors.map(factor => factor.key), [
    'rating', 'reviews', 'website', 'email', 'opportunity',
  ]);
  assert.ok(breakdown.factors.every(factor => factor.reason.length > 10));
});

test('strong, reachable companies score above leads with no digital signals', () => {
  const strong = computeScore({
    google_rating: 4.9, review_count: 280, website: 'https://example.test',
    email: 'owner@example.test', opportunity_type: 'HIGH_POTENTIAL',
  });
  const early = computeScore({
    google_rating: 0, review_count: 0, website: null, email: '',
    opportunity_type: 'NO_WEBSITE',
  });

  assert.ok(strong >= 90);
  assert.ok(early <= 25);
  assert.ok(strong > early);
});

test('broken websites do not receive digital-presence points', () => {
  const breakdown = getScoreBreakdown({
    google_rating: 4, review_count: 20, website: 'https://broken.test',
    website_status: 'broken', email: '', opportunity_type: 'WEAK_ADVERTISING',
  });

  assert.equal(breakdown.factors.find(factor => factor.key === 'website').points, 0);
});
