const router = require('express').Router();
const db     = require('../utils/db');
const fs     = require('fs');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { generateSaleReport } = require('../services/reportService');

// POST /api/reports/orders/:id — generate (or regenerate) PDF for an order
// Admin only
router.post('/orders/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const filepath = await generateSaleReport(req.params.id);
    res.download(filepath, `readonemore-order-${req.params.id}.pdf`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/orders/:id/pdf — download existing PDF (or regenerate if missing)
// Customers can download their own; admins can download any
router.get('/orders/:id/pdf', authenticate, async (req, res) => {
  try {
    // Verify the user owns this order (or is admin)
    const orderCheck = await db.query(
      `SELECT user_id FROM orders WHERE order_id=$1`,
      [req.params.id]
    );
    if (!orderCheck.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const isAdmin = req.user.role === 'admin';
    const ownsOrder = orderCheck.rows[0].user_id === req.user.userId;
    if (!isAdmin && !ownsOrder) {
      return res.status(403).json({ error: 'Not authorized to view this order' });
    }

    // Look for an existing PDF
    const existing = await db.query(
      `SELECT pdf_path FROM sale_reports
       WHERE order_id=$1
       ORDER BY generated_at DESC LIMIT 1`,
      [req.params.id]
    );

    let filepath;
    if (existing.rows.length && fs.existsSync(existing.rows[0].pdf_path)) {
      filepath = existing.rows[0].pdf_path;
    } else {
      filepath = await generateSaleReport(req.params.id);
    }

    res.download(filepath, `readonemore-order-${req.params.id}.pdf`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;