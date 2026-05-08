const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── PUBLIC ─────────────────────────────────────────────────────

// GET /api/books  — browse with filters
router.get('/', async (req, res) => {
  try {
    const { genre, condition, mood, search, sort = 'added_at', order = 'DESC', page = 1, limit = 24 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ["b.status = 'available'"];
    const params = [];

    if (genre) { params.push(genre); conditions.push(`g.name = $${params.length}`); }
    if (condition) { params.push(condition); conditions.push(`b.condition = $${params.length}`); }
    if (mood) { params.push(mood); conditions.push(`$${params.length} = ANY(b.mood_tags)`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(b.title ILIKE $${params.length} OR b.author ILIKE $${params.length} OR b.isbn = $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sortCol = ['price', 'added_at', 'title'].includes(sort) ? `b.${sort}` : 'b.added_at';
    const dir     = order === 'ASC' ? 'ASC' : 'DESC';

    params.push(limit, offset);
    const sql = `
      SELECT b.*, g.name AS genre_name
      FROM books b
      LEFT JOIN genres g ON b.genre_id = g.genre_id
      ${where}
      ORDER BY ${sortCol} ${dir}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const countSql = `SELECT COUNT(*) FROM books b LEFT JOIN genres g ON b.genre_id=g.genre_id ${where}`;

    const [books, count] = await Promise.all([
      db.query(sql, params),
      db.query(countSql, params.slice(0, -2))
    ]);
    res.json({ books: books.rows, total: parseInt(count.rows[0].count), page: +page, limit: +limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, g.name AS genre_name
       FROM books b LEFT JOIN genres g ON b.genre_id=g.genre_id
       WHERE b.book_id=$1`, [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Book not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/books/meta/genres
router.get('/meta/genres', async (req, res) => {
  const result = await db.query('SELECT * FROM genres ORDER BY name');
  res.json(result.rows);
});

// ── ADMIN: INVENTORY MANAGEMENT ────────────────────────────────

// POST /api/books  — add book to inventory
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      title, author, isbn, genre_id, condition, edition,
      year_published, language, price, stock, cover_image_url,
      mood_tags, provenance, description
    } = req.body;
    if (!title || !author || !price) return res.status(400).json({ error: 'title, author, price required' });

    const result = await db.query(
      `INSERT INTO books
        (title, author, isbn, genre_id, condition, edition, year_published,
         language, price, stock, cover_image_url, mood_tags, provenance, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [title, author, isbn, genre_id, condition || 'good', edition,
       year_published, language || 'English', price, stock || 1,
       cover_image_url, mood_tags, provenance, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/books/:id  — update book
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['title','author','isbn','genre_id','condition','edition','year_published',
                    'language','price','stock','cover_image_url','mood_tags','provenance','description','status'];
    const updates = [], params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        updates.push(`${f}=$${params.length}`);
      }
    });
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(id);
    const result = await db.query(
      `UPDATE books SET ${updates.join(',')}, updated_at=now() WHERE book_id=$${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Book not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/books/:id — soft delete (set status='sold')
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE books SET status='sold', updated_at=now() WHERE book_id=$1`, [req.params.id]);
    res.json({ message: 'Book removed from inventory' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;