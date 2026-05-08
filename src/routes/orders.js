const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { calculateShipping } = require('../services/shipping');

// ─────────────────────────────────────────────────────────────
// POST /api/orders  — create order from cart
// ─────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { delivery_method, address_id, postal_code, notes } = req.body;

    // 1. Load cart
    const cartResult = await client.query(
      `SELECT ci.quantity, b.book_id, b.price, b.stock, b.title
       FROM cart_items ci JOIN books b ON ci.book_id = b.book_id
       WHERE ci.user_id = $1`,
      [req.user.userId]
    );
    const items = cartResult.rows;
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

    // 2. Stock check
    for (const item of items) {
      if (item.stock < item.quantity) {
        return res.status(409).json({ error: `"${item.title}" only has ${item.stock} in stock` });
      }
    }

    await client.query('BEGIN');

    // 3. Totals
    const subtotal = items.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
    const shippingFee = delivery_method === 'pickup'
      ? 0
      : calculateShipping(postal_code);
    const total = subtotal + shippingFee;

    // 4. Create order (status defaults to 'pending_payment' from schema)
    const orderResult = await client.query(
      `INSERT INTO orders
        (user_id, delivery_method, address_id, subtotal, shipping_fee, total, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.userId,
        delivery_method || 'shipping',
        address_id || null,
        subtotal.toFixed(2),
        shippingFee.toFixed(2),
        total.toFixed(2),
        notes || null
      ]
    );
    const order = orderResult.rows[0];

    // 5. Insert order items + decrement stock + mark sold if depleted
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, book_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.order_id, item.book_id, item.quantity, item.price]
      );
      await client.query(
        `UPDATE books
         SET stock = stock - $1,
             status = CASE WHEN stock - $1 <= 0 THEN 'sold' ELSE status END,
             updated_at = now()
         WHERE book_id = $2`,
        [item.quantity, item.book_id]
      );
    }

    // 6. Clear cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.userId]);

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order creation failed:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/orders  — customer: own orders | admin: all
// ─────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { status, page = 1, limit = 20 } = req.query;
    const params = isAdmin ? [] : [req.user.userId];
    const conditions = isAdmin ? [] : ['o.user_id = $1'];
    if (status) { params.push(status); conditions.push(`o.status = $${params.length}`); }
    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const sql = `
      SELECT o.*, u.full_name, u.email,
             COUNT(oi.item_id) AS item_count
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      LEFT JOIN order_items oi ON o.order_id = oi.order_id
      ${where}
      GROUP BY o.order_id, u.full_name, u.email
      ORDER BY o.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/orders/:id
// ─────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const orderResult = await db.query(
      `SELECT o.*, u.full_name, u.email, a.line1, a.line2, a.city, a.postal_code
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       LEFT JOIN addresses a ON o.address_id = a.address_id
       WHERE o.order_id = $1 AND ($2 OR o.user_id = $3)`,
      [req.params.id, req.user.role === 'admin', req.user.userId]
    );
    if (!orderResult.rows.length) return res.status(404).json({ error: 'Order not found' });
    const itemsResult = await db.query(
      `SELECT oi.*, b.title, b.author, b.cover_image_url
       FROM order_items oi JOIN books b ON oi.book_id = b.book_id
       WHERE oi.order_id = $1`,
      [req.params.id]
    );
    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/orders/:id/status  — admin update order status
// ─────────────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending_payment','paid','shipped','ready_for_pickup','completed','cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const timestamps = {
      paid: 'paid_at', shipped: 'shipped_at',
      completed: 'completed_at', cancelled: 'cancelled_at'
    };
    const tsField = timestamps[status];
    const sql = tsField
      ? `UPDATE orders SET status = $1, ${tsField} = now() WHERE order_id = $2 RETURNING *`
      : `UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *`;
    const result = await db.query(sql, [status, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;