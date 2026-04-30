// ── REPORTS ────────────────────────────────────────────────────
const reportsRouter = require('express').Router();
const db            = require('../utils/db');
const fs            = require('fs');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateSaleReport } = require('../services/reportService');

// POST /api/reports/orders/:id  — generate PDF
reportsRouter.post('/orders/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const filepath = await generateSaleReport(req.params.id);
    res.download(filepath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/orders/:id/pdf  — download existing or regenerate
reportsRouter.get('/orders/:id/pdf', authenticate, async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT pdf_path FROM sale_reports WHERE order_id=$1 ORDER BY generated_at DESC LIMIT 1',
      [req.params.id]
    );
    let filepath;
    if (existing.rows.length && fs.existsSync(existing.rows[0].pdf_path)) {
      filepath = existing.rows[0].pdf_path;
    } else {
      filepath = await generateSaleReport(req.params.id);
    }
    res.download(filepath, `readonemore-order-${req.params.id}.pdf`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BADGES ─────────────────────────────────────────────────────
const badgesRouter = require('express').Router();

// GET /api/badges  — all badge definitions
badgesRouter.get('/', async (req, res) => {
  const result = await db.query('SELECT * FROM badge_definitions ORDER BY threshold');
  res.json(result.rows);
});

// GET /api/badges/my  — customer's earned badges with progress
badgesRouter.get('/my', authenticate, async (req, res) => {
  const result = await db.query(
    `SELECT bd.*, cb.unlocked_at
     FROM badge_definitions bd
     LEFT JOIN customer_badges cb ON bd.badge_id=cb.badge_id AND cb.user_id=$1
     ORDER BY bd.threshold`,
    [req.user.userId]
  );
  res.json(result.rows);
});

// ── WISHLIST ───────────────────────────────────────────────────
const wishlistRouter = require('express').Router();

wishlistRouter.get('/', authenticate, async (req, res) => {
  const result = await db.query(
    `SELECT wi.wishlist_item_id, wi.added_at, b.book_id, b.title, b.author,
            b.price, b.cover_image_url, b.status
     FROM wishlist_items wi JOIN books b ON wi.book_id=b.book_id
     WHERE wi.user_id=$1`, [req.user.userId]
  );
  res.json(result.rows);
});

wishlistRouter.post('/', authenticate, async (req, res) => {
  await db.query(
    `INSERT INTO wishlist_items (user_id, book_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.user.userId, req.body.book_id]
  );
  res.status(201).json({ message: 'Added to wishlist' });
});

wishlistRouter.delete('/:bookId', authenticate, async (req, res) => {
  await db.query('DELETE FROM wishlist_items WHERE user_id=$1 AND book_id=$2',
    [req.user.userId, req.params.bookId]);
  res.json({ message: 'Removed from wishlist' });
});

// ── PAYMENTS (MobilePay) ───────────────────────────────────────
const paymentsRouter = require('express').Router();

// POST /api/payments/mobilepay/initiate — create MobilePay payment
paymentsRouter.post('/mobilepay/initiate', authenticate, async (req, res) => {
  try {
    const { order_id } = req.body;
    const orderResult = await db.query(
      'SELECT * FROM orders WHERE order_id=$1 AND user_id=$2', [order_id, req.user.userId]
    );
    if (!orderResult.rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = orderResult.rows[0];

    // MobilePay ePayment API v1
    const mpOrderId = `ROM-${order_id}-${Date.now()}`;
    const response = await fetch('https://api.mobilepay.dk/epayment/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOBILEPAY_ACCESS_TOKEN}`,
        'Merchant-Serial-Number': process.env.MOBILEPAY_MERCHANT_SERIAL_NUMBER,
        'Ocp-Apim-Subscription-Key': process.env.MOBILEPAY_SUBSCRIPTION_KEY
      },
      body: JSON.stringify({
        amount: { currency: 'DKK', value: Math.round(parseFloat(order.total) * 100) },
        paymentDescription: `ReadOneMore Order #${order_id}`,
        redirectUrl: process.env.MOBILEPAY_REDIRECT_URL + `?order_id=${order_id}`,
        reference: mpOrderId,
        userFlow: 'WEB_REDIRECT'
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'MobilePay error', details: data });

    await db.query(
      'UPDATE orders SET mobilepay_order_id=$1, mobilepay_payment_id=$2 WHERE order_id=$3',
      [mpOrderId, data.paymentId, order_id]
    );
    res.json({ redirectUrl: data.redirectUrl, paymentId: data.paymentId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payments/mobilepay/callback — webhook from MobilePay
paymentsRouter.post('/mobilepay/callback', async (req, res) => {
  try {
    const { reference, status } = req.body;
    if (status === 'AUTHORIZED' || status === 'CAPTURED') {
      await db.query(
        `UPDATE orders SET status='paid', paid_at=now() WHERE mobilepay_order_id=$1`,
        [reference]
      );
    }
    res.sendStatus(200);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN DASHBOARD ────────────────────────────────────────────
const adminRouter = require('express').Router();
adminRouter.use(authenticate, requireAdmin);

// GET /api/admin/stats
adminRouter.get('/stats', async (req, res) => {
  const [revenue, orders, books, customers] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(total),0) AS total_revenue FROM orders WHERE status NOT IN ('cancelled','pending_payment')`),
    db.query(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status`),
    db.query(`SELECT status, COUNT(*) AS count FROM books GROUP BY status`),
    db.query(`SELECT COUNT(*) AS count FROM users WHERE role='customer'`)
  ]);
  res.json({
    totalRevenue: revenue.rows[0].total_revenue,
    ordersByStatus: orders.rows,
    booksByStatus: books.rows,
    totalCustomers: customers.rows[0].count
  });
});

// GET /api/admin/inventory  — full inventory with stock levels
adminRouter.get('/inventory', async (req, res) => {
  const result = await db.query(
    `SELECT b.*, g.name AS genre_name
     FROM books b LEFT JOIN genres g ON b.genre_id=g.genre_id
     ORDER BY b.added_at DESC`
  );
  res.json(result.rows);
});

module.exports = { reportsRouter, badgesRouter, wishlistRouter, paymentsRouter, adminRouter };