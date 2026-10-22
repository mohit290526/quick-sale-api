// Vercel serverless function — Quick Sale API.
//   POST /api/quick-sale   → save one bill (idempotent on bill_no)
//   GET  /api/quick-sale?date=YYYY-MM-DD → that day's bills + day total
//
// Deploy this inside a Vercel project with the `pg` dependency and a
// DATABASE_URL env var pointing at your Postgres (Neon / Supabase / Vercel PG).

const { getPool } = require('../lib/db');

const MODES = ['CASH', 'CARD', 'UPI'];

module.exports = async function handler(req, res) {
  // CORS (harmless if the dashboard is same-origin; needed if it's separate).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'GET') return await handleGet(req, res);
    return res.status(405).json({ status: false, message: 'Method not allowed' });
  } catch (e) {
    console.error('quick-sale error:', e);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ---------- POST (save a bill) ----------
function validateBill(b) {
  if (!b || typeof b !== 'object') return 'Body required';
  if (!b.bill_no || typeof b.bill_no !== 'string') return 'bill_no required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.sale_date || '')) return 'sale_date must be YYYY-MM-DD';
  if (!b.created_at) return 'created_at required';
  if (!MODES.includes(b.payment_mode)) return 'payment_mode must be CASH/CARD/UPI';
  if (typeof b.grand_total !== 'number') return 'grand_total must be a number';
  if (!Array.isArray(b.items) || b.items.length === 0) return 'items[] required';
  for (const it of b.items) {
    if (!it.category) return 'item.category required';
    if (!Number.isFinite(Number(it.pieces))) return 'item.pieces must be a number';
    if (!Number.isFinite(Number(it.price))) return 'item.price must be a number';
    if (!Number.isFinite(Number(it.line_total))) return 'item.line_total must be a number';
  }
  return null;
}

async function handlePost(req, res) {
  const b = req.body || {};
  const err = validateBill(b);
  if (err) return res.status(422).json({ status: false, message: err });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Idempotent: if this bill_no already exists, don't insert again.
    const ins = await client.query(
      `INSERT INTO quick_sale_bills (bill_no, sale_date, created_at, payment_mode, grand_total)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (bill_no) DO NOTHING
       RETURNING bill_no`,
      [b.bill_no, b.sale_date, b.created_at, b.payment_mode, b.grand_total],
    );

    if (ins.rowCount === 0) {
      await client.query('COMMIT');
      return res.status(200).json({ status: true, bill_no: b.bill_no, duplicate: true });
    }

    for (const it of b.items) {
      await client.query(
        `INSERT INTO quick_sale_items (bill_no, category, pieces, price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [b.bill_no, it.category, it.pieces, it.price, it.line_total],
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ status: true, bill_no: b.bill_no, duplicate: false });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- GET (one day's bills) ----------
async function handleGet(req, res) {
  const date = (req.query && req.query.date) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(422).json({ status: false, message: 'date=YYYY-MM-DD required' });
  }

  const q = await getPool().query(
    `SELECT b.bill_no, b.created_at, b.payment_mode, b.grand_total,
            COALESCE(
              json_agg(
                json_build_object('category', i.category, 'pieces', i.pieces,
                                  'price', i.price, 'line_total', i.line_total)
                ORDER BY i.id
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items
     FROM quick_sale_bills b
     LEFT JOIN quick_sale_items i ON i.bill_no = b.bill_no
     WHERE b.sale_date = $1
     GROUP BY b.bill_no, b.created_at, b.payment_mode, b.grand_total
     ORDER BY b.created_at`,
    [date],
  );

  const bills = q.rows.map((r) => ({
    bill_no: r.bill_no,
    created_at: r.created_at,
    payment_mode: r.payment_mode,
    grand_total: Number(r.grand_total),
    items: (r.items || []).map((it) => ({
      category: it.category,
      pieces: Number(it.pieces),
      price: Number(it.price),
      line_total: Number(it.line_total),
    })),
  }));

  const day_total = bills.reduce((a, x) => a + Number(x.grand_total || 0), 0);
  return res.status(200).json({ date, day_total, count: bills.length, bills });
}