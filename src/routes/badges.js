const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// GET /api/badges — all badge definitions (public)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM badge_definitions ORDER BY threshold'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/badges/my — current user's earned badges + progress
router.get('/my', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT bd.badge_id, bd.name, bd.description, bd.icon,
              bd.trigger_type, bd.threshold,
              cb.unlocked_at,
              CASE WHEN cb.unlocked_at IS NOT NULL THEN true ELSE false END AS unlocked
       FROM badge_definitions bd
       LEFT JOIN customer_badges cb
         ON bd.badge_id = cb.badge_id AND cb.user_id = $1
       ORDER BY bd.threshold`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;