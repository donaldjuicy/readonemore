const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../utils/db');

// POST /api/auth/signup  — create a new customer account
router.post('/signup', async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password, full_name required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if email already exists
    const existing = await db.query('SELECT user_id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role)
       VALUES ($1,$2,$3,$4,'customer')
       RETURNING user_id, email, full_name, role`,
      [email, password_hash, full_name, phone || null]
    );
    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await db.query('UPDATE users SET last_login=now() WHERE user_id=$1', [user.user_id]);

    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { user_id: user.user_id, email: user.email, full_name: user.full_name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me  — verify token & return current user
router.get('/me', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query(
      'SELECT user_id, email, full_name, role, phone FROM users WHERE user_id=$1',
      [payload.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;