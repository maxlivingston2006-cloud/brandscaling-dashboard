/**
 * Seed demo leads so the dashboard has something to show locally.
 * Safe to run repeatedly (INSERT OR IGNORE de-dupes by name+address).
 * Run:  node scripts/seed-demo.js
 * This only touches your local leads.db (gitignored) — never production.
 */
const {
  createSession, updateSessionLeadCount, insertLead, getLeadById, updateLeadStatus,
  insertClient, getAllClients, insertTask, getTasks, logActivity,
  insertInvoice, getAllInvoices, insertTransaction, setSetting,
} = require('../src/database');

const NOW = Date.now();
const day = (n) => new Date(NOW - n * 86400000).toISOString();

const SESSIONS = [
  {
    query: 'life coaches', location: 'Austin, TX', ts: day(9),
    leads: [
      { business_name: 'Clarity Life Coaching', category: 'Life Coach', address: '210 Congress Ave, Austin, TX', phone: '(512) 555-0110', website: null, google_rating: 0, review_count: 0, email: '', status: 'new', date_added: day(9) },
      { business_name: 'Peak Mindset Co', category: 'Life Coach', address: '88 Lavaca St, Austin, TX', phone: '(512) 555-0144', website: 'https://peakmindset.example', google_rating: 4.2, review_count: 31, email: 'hello@peakmindset.example', status: 'contacted', date_added: day(9), follow_up_date: day(1) },
      { business_name: 'Rise & Align', category: 'Mindset Coach', address: '500 W 2nd St, Austin, TX', phone: '(512) 555-0188', website: 'https://risealign.example', google_rating: 4.8, review_count: 240, email: 'team@risealign.example', status: 'replied', date_added: day(8) },
    ],
  },
  {
    query: 'med spa', location: 'Miami, FL', ts: day(5),
    leads: [
      { business_name: 'Glow Aesthetic Studio', category: 'Med Spa', address: '1200 Brickell Ave, Miami, FL', phone: '(305) 555-0199', website: null, google_rating: 0, review_count: 0, email: '', status: 'new', date_added: day(5) },
      { business_name: 'Radiance Medical Spa', category: 'Med Spa', address: '99 SW 8th St, Miami, FL', phone: '(305) 555-0123', website: 'https://radiancemedspa.example', google_rating: 4.6, review_count: 310, email: 'concierge@radiancemedspa.example', status: 'converted', date_added: day(5) },
      { business_name: 'Lumen Skin Clinic', category: 'Skin Clinic', address: '410 Lincoln Rd, Miami, FL', phone: '(305) 555-0166', website: 'https://lumenskin.example', google_rating: 3.9, review_count: 22, email: '', status: 'followed_up', date_added: day(4) },
      { business_name: 'Aura Aesthetics', category: 'Aesthetic Clinic', address: '7 Ocean Dr, Miami, FL', phone: '(305) 555-0177', website: 'https://auraaesthetics.example', google_rating: 4.4, review_count: 120, email: 'info@auraaesthetics.example', status: 'contacted', date_added: day(3), follow_up_date: day(0) },
    ],
  },
  {
    query: 'personal trainer', location: 'Denver, CO', ts: day(1),
    leads: [
      { business_name: 'Summit Strength', category: 'Personal Trainer', address: '1500 Market St, Denver, CO', phone: '(303) 555-0150', website: null, google_rating: 0, review_count: 0, email: '', status: 'new', date_added: day(1) },
      { business_name: 'IronWill Fitness', category: 'Fitness Coach', address: '22 Larimer St, Denver, CO', phone: '(303) 555-0112', website: 'https://ironwill.example', google_rating: 4.1, review_count: 47, email: '', status: 'new', date_added: day(1) },
      { business_name: 'Apex Performance', category: 'Personal Trainer', address: '900 Blake St, Denver, CO', phone: '(303) 555-0133', website: 'https://apexperformance.example', google_rating: 4.9, review_count: 280, email: 'coach@apexperformance.example', status: 'replied', date_added: day(0) },
    ],
  },
];

const { qualify } = require('../src/qualifier');

async function seedClientsTasksActivity() {
  // Skip if clients already exist — keeps re-runs idempotent
  const existing = await getAllClients();
  if (existing.length > 0) {
    console.log('clients already seeded — skipping clients/tasks/activity');
    return;
  }

  const clients = [
    {
      company: 'Radiance Medical Spa', contact_name: 'Dana Reyes',
      email: 'concierge@radiancemedspa.example', phone: '(305) 555-0123',
      service_description: 'Website rebuild + monthly Google Ads management',
      monthly_retainer: 2500, status: 'active', start_date: day(20).slice(0, 10),
      notes: 'Paid setup fee upfront. Wants monthly reporting on ad spend.',
    },
    {
      company: 'Apex Performance', contact_name: 'Chris Walton',
      email: 'coach@apexperformance.example', phone: '(303) 555-0133',
      service_description: 'Brand refresh + social content engine',
      monthly_retainer: 1800, status: 'active', start_date: day(6).slice(0, 10),
      notes: 'Trial month at reduced rate, review pricing after 30 days.',
    },
  ];
  const clientIds = [];
  for (const c of clients) {
    const r = await insertClient(c);
    clientIds.push(r.lastID);
    console.log(`seeded client "${c.company}"`);
  }

  const tasks = [
    { title: 'Send Radiance their first monthly report', due_date: day(0).slice(0, 10), client_id: clientIds[0] },
    { title: 'Kickoff call with Apex Performance', due_date: day(-2).slice(0, 10), client_id: clientIds[1] },
    { title: 'Prepare Q3 pricing sheet', due_date: day(-5).slice(0, 10) },
  ];
  for (const t of tasks) await insertTask(t);
  console.log(`seeded ${tasks.length} tasks`);

  await logActivity('scrape', 'Scraped 10 leads for “med spa” in Miami, FL');
  await logActivity('client_added', 'Radiance Medical Spa converted to client', { client_id: clientIds[0] });
  await logActivity('client_added', 'New client added: Apex Performance', { client_id: clientIds[1] });
  console.log('seeded activity feed');
}

async function seedFinance() {
  // Skip if invoices already exist — invoice numbers are UNIQUE
  const existing = await getAllInvoices();
  if (existing.length > 0) {
    console.log('invoices already seeded — skipping finance data');
    return;
  }
  const clients = await getAllClients();
  if (!clients.length) return;
  const radiance = clients.find(c => c.company.includes('Radiance')) || clients[0];
  const apex     = clients.find(c => c.company.includes('Apex')) || clients[clients.length - 1];

  const year  = new Date().getFullYear();
  const month = new Date().toISOString().slice(0, 7);
  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);

  // Paid invoice last month (with its income transaction), one sent this month
  const inv1 = await insertInvoice({
    client_id: radiance.id, number: `BS-${year}-001`,
    line_items: [{ description: 'Website rebuild — final milestone', quantity: 1, unit_price: 3500 },
                 { description: 'Google Ads management', quantity: 1, unit_price: 2500 }],
    subtotal: 6000, tax_rate: 0, total: 6000, status: 'paid',
    issue_date: `${lastMonth}-05`, due_date: `${lastMonth}-19`, paid_date: `${lastMonth}-15`,
  });
  await insertTransaction({
    type: 'income', category: 'Client Revenue', amount: 6000, date: `${lastMonth}-15`,
    description: `Invoice BS-${year}-001 — ${radiance.company}`, client_id: radiance.id, invoice_id: inv1.lastID,
  });

  await insertInvoice({
    client_id: radiance.id, number: `BS-${year}-002`,
    line_items: [{ description: 'Google Ads management', quantity: 1, unit_price: 2500 }],
    subtotal: 2500, tax_rate: 0, total: 2500, status: 'sent',
    issue_date: `${month}-02`, due_date: `${month}-16`,
  });
  await insertInvoice({
    client_id: apex.id, number: `BS-${year}-003`,
    line_items: [{ description: 'Brand refresh sprint', quantity: 1, unit_price: 1800 }],
    subtotal: 1800, tax_rate: 0, total: 1800, status: 'draft',
    issue_date: `${month}-08`, due_date: `${month}-22`,
  });

  // Income + expenses spread over two months
  const txs = [
    { type: 'income',  category: 'Client Revenue', amount: 1800, date: `${month}-03`, description: `${apex.company} retainer`, client_id: apex.id },
    { type: 'expense', category: 'Software',       amount: 210,  date: `${month}-01`, description: 'SaaS stack (CRM, design, hosting)', recurring: 1 },
    { type: 'expense', category: 'Ad Spend',       amount: 450,  date: `${month}-04`, description: 'Client campaign top-ups' },
    { type: 'expense', category: 'Contractors',    amount: 600,  date: `${month}-06`, description: 'Freelance designer — brand refresh' },
    { type: 'expense', category: 'Software',       amount: 210,  date: `${lastMonth}-01`, description: 'SaaS stack', recurring: 1 },
    { type: 'expense', category: 'Ad Spend',       amount: 380,  date: `${lastMonth}-12`, description: 'Campaign top-ups' },
  ];
  for (const t of txs) await insertTransaction(t);

  await setSetting('revenue_goal_monthly', '10000');
  console.log('seeded 3 invoices, 7 transactions, revenue goal $10,000');
}

(async () => {
  for (const s of SESSIONS) {
    const session = await createSession(s.query, s.location);
    const sid = session.lastID;
    let count = 0;
    for (const l of s.leads) {
      const opportunity_type = qualify(l.website, l.google_rating, l.review_count);
      const r = await insertLead({ ...l, opportunity_type, session_id: sid });
      count++;
      // insertLead resets status to default 'new'; apply intended status
      if (r.lastID && l.status && l.status !== 'new') {
        await updateLeadStatus(r.lastID, l.status, l.date_added);
      }
    }
    await updateSessionLeadCount(sid, count);
    console.log(`seeded session "${s.query}" (${count} leads)`);
  }
  await seedClientsTasksActivity();
  await seedFinance();
  console.log('Demo seed complete.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
