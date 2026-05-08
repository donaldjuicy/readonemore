const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/wishlist — current user's wishlist
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT wi.wishlist_item_id, wi.added_at,
              b.book_id, b.title, b.author, b.price, b.cover_image_url, b.status
       FROM wishlist_items wi
       JOIN books b ON wi.book_id = b.book_id
       WHERE wi.user_id = $1
       ORDER BY wi.added_at DESC`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wishlist — add a book to wishlist
router.post('/', async (req, res) => {
  try {
    const { book_id } = req.body;
    if (!book_id) return res.status(400).json({ error: 'book_id required' });

    await db.query(
      `INSERT INTO wishlist_items (user_id, book_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, book_id) DO NOTHING`,
      [req.user.userId, book_id]
    );
    res.status(201).json({ message: 'Added to wishlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/wishlist/:bookId — remove a book from wishlist
router.delete('/:bookId', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM wishlist_items WHERE user_id=$1 AND book_id=$2`,
      [req.user.userId, req.params.bookId]
    );
    res.json({ message: 'Removed from wishlist' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;