const router = require('express').Router();
const db     = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// POST /api/payments/mobilepay/initiate — start a MobilePay payment for an order
router.post('/mobilepay/initiate', authenticate, async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const orderResult = await db.query(
      'SELECT * FROM orders WHERE order_id=$1 AND user_id=$2',
      [order_id, req.user.userId]
    );
    if (!orderResult.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const order = orderResult.rows[0];

    if (order.status !== 'pending_payment') {
      return res.status(409).json({
        error: `Order is in status "${order.status}" and cannot be paid for`
      });
    }

    // MobilePay ePayment API v1
    const mpOrderId = `ROM-${order_id}-${Date.now()}`;
    const response = await fetch('https://api.mobilepay.dk/epayment/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOBILEPAY_ACCESS_TOKEN}`,
        'Merchant-Serial-Number': process.env.MOBILEPAY_MERCHANT_SERIAL_NUMBER,
        'Ocp-Apim-Subscription-Key': process.env.MOBILEPAY_SUBSCRIPTION_KEY
      },
      body: JSON.stringify({
        amount: {
          currency: 'DKK',
          value: Math.round(parseFloat(order.total) * 100)  // MobilePay uses minor units (øre)
        },
        paymentDescription: `ReadOneMore Order #${order_id}`,
        redirectUrl: `${process.env.MOBILEPAY_REDIRECT_URL}?order_id=${order_id}`,
        reference: mpOrderId,
        userFlow: 'WEB_REDIRECT'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('MobilePay error:', data);
      return res.status(502).json({ error: 'MobilePay error', details: data });
    }

    await db.query(
      `UPDATE orders SET mobilepay_order_id=$1, mobilepay_payment_id=$2
       WHERE order_id=$3`,
      [mpOrderId, data.paymentId, order_id]
    );

    res.json({ redirectUrl: data.redirectUrl, paymentId: data.paymentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/mobilepay/callback — webhook from MobilePay
// MobilePay calls this when payment status changes
router.post('/mobilepay/callback', async (req, res) => {
  try {
    const { reference, name: status } = req.body;

    if (status === 'AUTHORIZED' || status === 'CAPTURED') {
      await db.query(
        `UPDATE orders SET status='paid', paid_at=now()
         WHERE mobilepay_order_id=$1 AND status='pending_payment'`,
        [reference]
      );
    } else if (status === 'CANCELLED' || status === 'EXPIRED' || status === 'ABORTED') {
      await db.query(
        `UPDATE orders SET status='cancelled', cancelled_at=now()
         WHERE mobilepay_order_id=$1 AND status='pending_payment'`,
        [reference]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('MobilePay callback error:', err);
    res.sendStatus(500);
  }
});

// GET /api/payments/status/:orderId — check current payment status
router.get('/status/:orderId', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT order_id, status, paid_at, total
       FROM orders WHERE order_id=$1 AND user_id=$2`,
      [req.params.orderId, req.user.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;