/**
 * Finance engine — invoice math & lifecycle, overdue sweep, revenue forecast.
 * Invoices live in SQLite (src/database.js); this module owns the business rules.
 */
const {
  getInvoiceById, updateInvoiceStatus, getMaxInvoiceNumber, markOverdueInvoices,
  insertTransaction, logActivity,
} = require('./database');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// line_items: [{ description, quantity, unit_price }]
function computeTotals(lineItems, taxRate = 0) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 1) * (Number(it.unit_price) || 0), 0);
  const total = subtotal * (1 + (Number(taxRate) || 0) / 100);
  return { subtotal: round2(subtotal), total: round2(total) };
}

// 'BS' + 2026 → 'BS-2026-001', incrementing the highest existing sequence
async function nextInvoiceNumber(prefix = 'BS', year = new Date().getFullYear()) {
  const max = await getMaxInvoiceNumber(prefix, year);
  const seq = max ? parseInt(max.split('-').pop(), 10) + 1 : 1;
  return `${prefix}-${year}-${String(seq).padStart(3, '0')}`;
}

// Idempotent: marking an already-paid invoice again is a no-op.
// Paying creates the matching income transaction so the P&L stays truthful.
async function markInvoicePaid(id) {
  const inv = await getInvoiceById(id);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'paid') return inv;

  const paidDate = new Date().toISOString().slice(0, 10);
  await updateInvoiceStatus(id, 'paid', paidDate);
  await insertTransaction({
    type:        'income',
    category:    'Client Revenue',
    amount:      inv.total,
    date:        paidDate,
    description: `Invoice ${inv.number} — ${inv.client_company}`,
    client_id:   inv.client_id,
    invoice_id:  inv.id,
  });
  await logActivity('invoice_paid', `Invoice ${inv.number} paid — $${inv.total.toLocaleString('en-US')}`, {
    client_id: inv.client_id, invoice_id: inv.id,
  });
  return getInvoiceById(id);
}

// Sweep sent invoices past their due date → overdue (startup + daily interval)
async function checkOverdue() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await markOverdueInvoices(today);
  if (res.changes > 0) console.log(`[finance] marked ${res.changes} invoice(s) overdue`);
  return res.changes;
}

// Forecast = MRR + stage-weighted pipeline value.
// Weights are deliberately conservative for cold outreach.
const STAGE_WEIGHTS = { contacted: 0.05, followed_up: 0.10, replied: 0.25 };

function computeForecast(leads, clients, settings = {}) {
  const activeClients = clients.filter(c => c.status === 'active');
  const mrr = activeClients.reduce((s, c) => s + (Number(c.monthly_retainer) || 0), 0);

  const avgRetainer = activeClients.length ? mrr / activeClients.length : 0;
  const avgDeal = Number(settings.avg_deal_value) || avgRetainer || 1500;

  const pipeline = leads.reduce((s, l) => s + (STAGE_WEIGHTS[l.status] || 0) * avgDeal, 0);
  return {
    mrr:               round2(mrr),
    avg_deal_value:    round2(avgDeal),
    pipeline_weighted: round2(pipeline),
    forecast:          round2(mrr + pipeline),
  };
}

// Branded invoice email — light background (email-client friendly), emerald accent.
// All dynamic strings are HTML-escaped.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmtMoney = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d
  ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  : '—';

function renderInvoiceHtml(invoice, client, settings = {}) {
  let items = [];
  try { items = JSON.parse(invoice.line_items || '[]'); } catch { items = []; }

  const senderName  = settings.sender_name  || process.env.SENDER_NAME  || 'Your Name';
  const companyName = settings.company_name || process.env.COMPANY_NAME || 'Your Agency';
  const rows = items.map(it => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e9ef;color:#1f2937;">${escHtml(it.description)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e9ef;text-align:center;color:#1f2937;">${Number(it.quantity) || 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e9ef;text-align:right;color:#1f2937;">${fmtMoney(it.unit_price)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e7e9ef;text-align:right;color:#1f2937;font-weight:600;">${fmtMoney((Number(it.quantity) || 1) * (Number(it.unit_price) || 0))}</td>
    </tr>`).join('');

  const taxRow = Number(invoice.tax_rate)
    ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#6b7280;">Tax (${invoice.tax_rate}%)</td>
         <td style="padding:6px 12px;text-align:right;color:#1f2937;">${fmtMoney(invoice.total - invoice.subtotal)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#052e16;padding:26px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:#22c55e;color:#052e16;font-weight:800;font-size:18px;border-radius:9px;">${escHtml(companyName.charAt(0).toUpperCase())}</span>
            <span style="color:#ffffff;font-weight:700;font-size:18px;margin-left:10px;vertical-align:middle;">${escHtml(companyName)}</span>
          </td>
          <td style="text-align:right;color:#86efac;font-weight:700;font-size:15px;">INVOICE ${escHtml(invoice.number)}</td>
        </tr></table>
      </div>
      <div style="padding:28px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
          <td style="vertical-align:top;">
            <div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.06em;">BILLED TO</div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-top:4px;">${escHtml(client.company)}</div>
            ${client.contact_name ? `<div style="font-size:13px;color:#4b5563;">${escHtml(client.contact_name)}</div>` : ''}
            ${client.email ? `<div style="font-size:13px;color:#4b5563;">${escHtml(client.email)}</div>` : ''}
          </td>
          <td style="vertical-align:top;text-align:right;">
            <div style="font-size:13px;color:#4b5563;">Issued: <b style="color:#111827;">${fmtDate(invoice.issue_date)}</b></div>
            <div style="font-size:13px;color:#4b5563;margin-top:4px;">Due: <b style="color:#111827;">${fmtDate(invoice.due_date)}</b></div>
          </td>
        </tr></table>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <thead><tr>
            <th style="padding:9px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;letter-spacing:.06em;">DESCRIPTION</th>
            <th style="padding:9px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;text-align:center;font-size:11px;color:#6b7280;letter-spacing:.06em;">QTY</th>
            <th style="padding:9px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;letter-spacing:.06em;">RATE</th>
            <th style="padding:9px 12px;background:#f9fafb;border-bottom:2px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;letter-spacing:.06em;">AMOUNT</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td colspan="3" style="padding:12px 12px 4px;text-align:right;color:#6b7280;">Subtotal</td>
                <td style="padding:12px 12px 4px;text-align:right;color:#1f2937;">${fmtMoney(invoice.subtotal)}</td></tr>
            ${taxRow}
            <tr><td colspan="3" style="padding:10px 12px;text-align:right;font-weight:800;color:#111827;font-size:16px;">Total Due</td>
                <td style="padding:10px 12px;text-align:right;font-weight:800;color:#16a34a;font-size:18px;">${fmtMoney(invoice.total)}</td></tr>
          </tfoot>
        </table>

        ${invoice.notes ? `<div style="margin-top:18px;padding:13px 16px;background:#f9fafb;border-radius:10px;font-size:13px;color:#4b5563;">${escHtml(invoice.notes)}</div>` : ''}

        <div style="margin-top:26px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">
          Questions about this invoice? Just reply to this email.<br/>
          <b style="color:#111827;">${escHtml(senderName)}</b> · ${escHtml(companyName)}
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function renderInvoiceText(invoice, client) {
  let items = [];
  try { items = JSON.parse(invoice.line_items || '[]'); } catch { items = []; }
  const companyName = process.env.COMPANY_NAME || 'Your Agency';
  return [
    `Invoice ${invoice.number} from ${companyName}`,
    `Billed to: ${client.company}`,
    `Issued: ${fmtDate(invoice.issue_date)} · Due: ${fmtDate(invoice.due_date)}`,
    '',
    ...items.map(it => `- ${it.description} × ${Number(it.quantity) || 1} @ ${fmtMoney(it.unit_price)}`),
    '',
    `Total due: ${fmtMoney(invoice.total)}`,
    invoice.notes ? `\n${invoice.notes}` : '',
  ].join('\n');
}

module.exports = {
  computeTotals, nextInvoiceNumber, markInvoicePaid, checkOverdue,
  computeForecast, renderInvoiceHtml, renderInvoiceText,
};
