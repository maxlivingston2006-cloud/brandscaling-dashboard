// ---------------------------------------------------------------------------
// Personalization helpers — derive a first name and a city for merge fields.
// All functions here are pure and synchronous so the preview/send path stays
// instant; the (optional) AI name lookup lives in ai.js and runs at
// email-finding time, persisting owner_name to the lead.
// ---------------------------------------------------------------------------

// Mailbox prefixes that are role addresses, not a person's name.
const GENERIC_MAILBOXES = new Set([
  'info', 'contact', 'sales', 'admin', 'hello', 'team', 'office', 'support',
  'service', 'services', 'help', 'mail', 'email', 'inquiries', 'inquiry',
  'enquiries', 'enquiry', 'booking', 'bookings', 'appointments', 'appointment',
  'frontdesk', 'reception', 'billing', 'accounts', 'accounting', 'hr', 'jobs',
  'careers', 'marketing', 'newsletter', 'noreply', 'no-reply', 'webmaster',
  'postmaster', 'general', 'main', 'company', 'business', 'owner', 'manager',
  'staff', 'orders', 'order', 'quote', 'quotes', 'estimate', 'estimates',
  'schedule', 'scheduling', 'dispatch', 'customerservice', 'hi', 'hey',
]);

function titleCase(word) {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Best-effort first name from an email address.
 *   mike@abcpools.com        -> "Mike"
 *   john.smith@abcpools.com  -> "John"
 *   info@abcpools.com        -> null  (role mailbox)
 *   j.smith@abcpools.com     -> null  (too ambiguous)
 * Precision over recall: only returns a name it's fairly confident about.
 */
function nameFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const local = email.split('@')[0].toLowerCase().trim();
  if (!local || GENERIC_MAILBOXES.has(local)) return null;

  // Split on common separators and strip trailing digits (john123 -> john)
  const tokens = local
    .split(/[._\-+]/)
    .map(t => t.replace(/\d+$/g, ''))
    .filter(Boolean);

  const first = tokens[0];
  // Require a plausible name: alphabetic and at least 3 chars (avoids "j", "jp")
  if (!first || first.length < 3 || !/^[a-z]+$/.test(first)) return null;
  if (GENERIC_MAILBOXES.has(first)) return null;
  return titleCase(first);
}

/**
 * Extract the city from a Google-formatted address.
 *   "123 Main St, Tampa, FL 33602, USA" -> "Tampa"
 *   "Tampa, FL, USA"                     -> "Tampa"
 * Returns null when it can't be determined confidently.
 */
function cityFromAddress(address) {
  if (!address || typeof address !== 'string') return null;
  let parts = address.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length && /^(usa|us|united states)$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  if (parts.length < 2) return null;
  const city = parts[parts.length - 2];           // part before "ST ZIP"
  if (!city || /^\d/.test(city) || city.length < 2) return null;
  return city;
}

module.exports = { nameFromEmail, cityFromAddress, titleCase };
