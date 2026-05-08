const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// All cart routes require authentication
router.use(authenticate);

// GET /api/cart — get current user's cart
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ci.cart_item_id, ci.quantity, ci.added_at,
              b.book_id, b.title, b.author, b.price, b.cover_image_url,
              b.condition, b.stock, b.status
       FROM cart_items ci
       JOIN books b ON ci.book_id = b.book_id
       WHERE ci.user_id = $1
       ORDER BY ci.added_at DESC`,
      [req.user.userId]
    );

    const items = result.rows;
    const subtotal = items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
    const bookCount = items.reduce((sum, i) => sum + i.quantity, 0);

    res.json({
      items,
      subtotal: subtotal.toFixed(2),
      bookCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cart — add a book to the cart
router.post('/', async (req, res) => {
  try {
    const { book_id, quantity = 1 } = req.body;
    if (!book_id) return res.status(400).json({ error: 'book_id required' });
    if (quantity < 1) return res.status(400).json({ error: 'quantity must be at least 1' });

    // Check book exists and is available
    const bookResult = await db.query(
      `SELECT book_id, title, stock, status FROM books WHERE book_id=$1`,
      [book_id]
    );
    if (!bookResult.rows.length) return res.status(404).json({ error: 'Book not found' });
    const book = bookResult.rows[0];
    if (book.status !== 'available') {
      return res.status(409).json({ error: 'Book is no longer available' });
    }
    if (book.stock < quantity) {
      return res.status(409).json({ error: `Only ${book.stock} in stock` });
    }

    // Upsert into cart_items (UNIQUE on user_id, book_id)
    const result = await db.query(
      `INSERT INTO cart_items (user_id, book_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
       RETURNING *`,
      [req.user.userId, book_id, quantity]
    );

    // Make sure we don't exceed stock after merge
    const merged = result.rows[0];
    if (merged.quantity > book.stock) {
      await db.query(
        `UPDATE cart_items SET quantity=$1 WHERE cart_item_id=$2`,
        [book.stock, merged.cart_item_id]
      );
      return res.status(200).json({
        ...merged,
        quantity: book.stock,
        warning: `Quantity capped at available stock (${book.stock})`
      });
    }

    res.status(201).json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cart/:bookId — update quantity for a book in the cart
router.patch('/:bookId', async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'quantity must be at least 1' });
    }

    const bookResult = await db.query(
      `SELECT stock FROM books WHERE book_id=$1`, [req.params.bookId]
    );
    if (!bookResult.rows.length) return res.status(404).json({ error: 'Book not found' });
    if (bookResult.rows[0].stock < quantity) {
      return res.status(409).json({ error: `Only ${bookResult.rows[0].stock} in stock` });
    }

    const result = await db.query(
      `UPDATE cart_items SET quantity=$1
       WHERE user_id=$2 AND book_id=$3 RETURNING *`,
      [quantity, req.user.userId, req.params.bookId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Item not in cart' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cart/:bookId — remove a book from the cart
router.delete('/:bookId', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM cart_items WHERE user_id=$1 AND book_id=$2`,
      [req.user.userId, req.params.bookId]
    );
    res.json({ message: 'Removed from cart' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cart — clear the whole cart
router.delete('/', async (req, res) => {
  try {
    await db.query(`DELETE FROM cart_items WHERE user_id=$1`, [req.user.userId]);
    res.json({ message: 'Cart cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;