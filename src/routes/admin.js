const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All admin routes require authentication AND admin role
router.use(authenticate, requireAdmin);

// GET /api/admin/stats — dashboard summary
router.get('/stats', async (req, res) => {
  try {
    const [revenue, orders, books, customers] = await Promise.all([
      db.query(
        `SELECT COALESCE(SUM(total), 0) AS total_revenue
         FROM orders
         WHERE status NOT IN ('cancelled','pending_payment')`
      ),
      db.query(
        `SELECT status, COUNT(*) AS count FROM orders GROUP BY status`
      ),
      db.query(
        `SELECT status, COUNT(*) AS count FROM books GROUP BY status`
      ),
      db.query(
        `SELECT COUNT(*) AS count FROM users WHERE role='customer'`
      )
    ]);
    res.json({
      totalRevenue: revenue.rows[0].total_revenue,
      ordersByStatus: orders.rows,
      booksByStatus: books.rows,
      totalCustomers: customers.rows[0].count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/inventory — full inventory with stock levels
router.get('/inventory', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, g.name AS genre_name
       FROM books b
       LEFT JOIN genres g ON b.genre_id = g.genre_id
       ORDER BY b.added_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/customers — list all customers
router.get('/customers', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.user_id, u.email, u.full_name, u.phone, u.created_at, u.last_login,
              COUNT(DISTINCT o.order_id) AS order_count,
              COALESCE(SUM(o.total), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON u.user_id = o.user_id
            AND o.status NOT IN ('cancelled','pending_payment')
       WHERE u.role = 'customer'
       GROUP BY u.user_id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;