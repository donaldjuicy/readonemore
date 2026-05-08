const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

// Make sure the uploads folder exists
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'covers');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer keeps the file in memory so sharp can resize before saving
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max input
});

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

// GET /api/admin/isbn-lookup/:isbn
// Looks up book metadata from Google Books API for the scanner tool
router.get('/isbn-lookup/:isbn', async (req, res) => {
  const { isbn } = req.params;

  const cleanIsbn = isbn.replace(/[-\s]/g, '');
  if (!/^\d{10}(\d{3})?$/.test(cleanIsbn)) {
    return res.status(400).json({ error: 'Invalid ISBN format' });
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`
    );
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({
        error: 'Book not found',
        isbn: cleanIsbn,
        suggest_manual: true
      });
    }

    const book = data.items[0].volumeInfo;
    res.json({
      isbn: cleanIsbn,
      title: book.title || '',
      authors: book.authors || [],
      year: book.publishedDate ? parseInt(book.publishedDate.substring(0, 4)) : null,
      description: book.description || '',
      cover_url: book.imageLinks?.thumbnail?.replace('http://', 'https://') || null,
      categories: book.categories || [],
      page_count: book.pageCount || null,
      language: book.language || null
    });
  } catch (err) {
    console.error('ISBN lookup failed:', err);
    res.status(500).json({ error: 'Lookup service unavailable' });
  }
});

// GET /api/admin/genres — list all genres for dropdown
router.get('/genres', async (req, res) => {
  try {
    const result = await db.query('SELECT genre_id, name FROM genres ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/books — add a new book (used by the scanner)
router.post('/books', async (req, res) => {
  const {
    title, author, isbn, genre_id, condition, edition,
    year_published, language, price, stock,
    cover_image_url, description
  } = req.body;

  // Required fields
  if (!title || !author || price == null) {
    return res.status(400).json({ error: 'title, author, and price are required' });
  }

  // Validate condition matches schema enum
  const validConditions = ['like_new', 'good', 'fair', 'worn'];
  const cond = condition && validConditions.includes(condition) ? condition : 'good';

  try {
    const result = await db.query(
      `INSERT INTO books
        (title, author, isbn, genre_id, condition, edition,
         year_published, language, price, stock,
         cover_image_url, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING book_id, title, author, isbn, price, stock`,
      [
        title,
        author,
        isbn || null,
        genre_id || null,
        cond,
        edition || null,
        year_published || null,
        language || 'English',
        price,
        stock != null ? stock : 1,
        cover_image_url || null,
        description || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add book failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/upload-cover — accept image, resize, save, return URL
router.post('/upload-cover', upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const filename = `cover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Resize: max 600px wide, JPEG, ~80% quality. Keeps photos around 100-200 KB.
    await sharp(req.file.buffer)
      .rotate()                       // respect EXIF orientation from phone
      .resize({ width: 600, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(filepath);

    const publicUrl = `/uploads/covers/${filename}`;
    res.json({ url: publicUrl });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;