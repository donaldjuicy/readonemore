/**
 * BadgeService
 * Mirrors AchievementEvaluationScheduler from network_management_system.
 * Called after each completed order to check if new badges are unlocked.
 */
const db = require('../utils/db');

async function evaluateBadges(userId) {
  // 1. Compute stats for this user
  const statsResult = await db.query(
    `SELECT
       COUNT(DISTINCT o.order_id)                        AS orders_count,
       COALESCE(SUM(oi.quantity), 0)                     AS books_count,
       COALESCE(SUM(o.total), 0)                         AS spend_total,
       COUNT(DISTINCT g.genre_id)                        AS genre_count
     FROM orders o
     JOIN order_items oi ON o.order_id=oi.order_id
     JOIN books b ON oi.book_id=b.book_id
     LEFT JOIN genres g ON b.genre_id=g.genre_id
     WHERE o.user_id=$1 AND o.status NOT IN ('cancelled')`,
    [userId]
  );
  const stats = statsResult.rows[0];

  // 2. Load all badge definitions
  const badgesResult = await db.query('SELECT * FROM badge_definitions');

  // 3. Load already-unlocked badges
  const unlockedResult = await db.query(
    'SELECT badge_id FROM customer_badges WHERE user_id=$1', [userId]
  );
  const unlocked = new Set(unlockedResult.rows.map(r => r.badge_id));

  // 4. Evaluate each definition — mirrors achievement threshold logic
  for (const badge of badgesResult.rows) {
    if (unlocked.has(badge.badge_id)) continue; // preserve unlock date like the waste system

    const progress = parseFloat(stats[badge.trigger_type] || 0);
    if (progress >= parseFloat(badge.threshold)) {
      await db.query(
        `INSERT INTO customer_badges (user_id, badge_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [userId, badge.badge_id]
      );
    }
  }
}

module.exports = { evaluateBadges };