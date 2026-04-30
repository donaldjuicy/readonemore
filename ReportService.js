/**
 * PDF Sale Report Service
 * Mirrors Sale_Reports / OpenHTMLToPDF in network_management_system.
 * Generates a clean PDF receipt for a completed order.
 */
const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const db          = require('../utils/db');

async function generateSaleReport(orderId) {
  // 1. Fetch order + items
  const orderResult = await db.query(
    `SELECT o.*, u.full_name, u.email, u.phone,
            a.line1, a.line2, a.city, a.postal_code, a.country
     FROM orders o
     JOIN users u ON o.user_id=u.user_id
     LEFT JOIN addresses a ON o.address_id=a.address_id
     WHERE o.order_id=$1`, [orderId]
  );
  if (!orderResult.rows.length) throw new Error('Order not found');
  const order = orderResult.rows[0];

  const itemsResult = await db.query(
    `SELECT oi.quantity, oi.unit_price, b.title, b.author, b.condition, b.isbn
     FROM order_items oi JOIN books b ON oi.book_id=b.book_id
     WHERE oi.order_id=$1`, [orderId]
  );
  const items = itemsResult.rows;

  // 2. Build PDF
  const dir     = process.env.PDF_OUTPUT_DIR || './reports';
  fs.mkdirSync(dir, { recursive: true });
  const filename = `order-${orderId}-${Date.now()}.pdf`;
  const filepath = path.join(dir, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // Header
    doc.font('Helvetica-Bold').fontSize(22).text('ReadOneMore', 50, 50);
    doc.font('Helvetica').fontSize(10).fillColor('#666')
       .text('Secondhand Books · Copenhagen', 50, 76)
       .text('readonemore.dk', 50, 90);

    doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#c8102e').lineWidth(2).stroke();

    // Order info
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1a1a1a')
       .text(`Sale Receipt — Order #${orderId}`, 50, 125);
    doc.font('Helvetica').fontSize(10).fillColor('#444')
       .text(`Date: ${new Date(order.paid_at || order.created_at).toLocaleDateString('da-DK')}`, 50, 145)
       .text(`Status: ${order.status.toUpperCase()}`, 50, 160)
       .text(`Delivery: ${order.delivery_method === 'pickup' ? 'Pickup in store' : 'Shipping'}`, 50, 175);

    // Customer
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a').text('Customer', 350, 125);
    doc.font('Helvetica').fontSize(10).fillColor('#444')
       .text(order.full_name, 350, 143)
       .text(order.email, 350, 158);
    if (order.delivery_method === 'shipping' && order.line1) {
      doc.text(order.line1, 350, 173)
         .text(`${order.postal_code} ${order.city}`, 350, 188)
         .text(order.country, 350, 203);
    }

    // Table header
    const tableTop = 230;
    doc.moveTo(50, tableTop).lineTo(545, tableTop).strokeColor('#ddd').lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#333')
       .text('Title', 50, tableTop + 8)
       .text('Author', 220, tableTop + 8)
       .text('Cond.', 360, tableTop + 8)
       .text('Qty', 430, tableTop + 8)
       .text('Price', 480, tableTop + 8, { align: 'right', width: 65 });
    doc.moveTo(50, tableTop + 25).lineTo(545, tableTop + 25).strokeColor('#ddd').stroke();

    // Table rows
    let y = tableTop + 35;
    for (const item of items) {
      doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a')
         .text(item.title.substring(0, 28), 50, y, { width: 165 })
         .text(item.author.substring(0, 22), 220, y, { width: 130 })
         .text(item.condition, 360, y)
         .text(item.quantity.toString(), 430, y)
         .text(`${(item.unit_price * item.quantity).toFixed(2)} kr`, 480, y, { align: 'right', width: 65 });
      y += 22;
      doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor('#f0f0f0').stroke();
    }

    // Totals
    y += 10;
    doc.moveTo(350, y).lineTo(545, y).strokeColor('#ccc').stroke();
    y += 10;
    doc.font('Helvetica').fontSize(10).fillColor('#555')
       .text('Subtotal', 350, y).text(`${parseFloat(order.subtotal).toFixed(2)} kr`, 480, y, { align: 'right', width: 65 });
    y += 18;
    doc.text('Shipping', 350, y)
       .text(parseFloat(order.shipping_fee) === 0 ? 'Free' : `${parseFloat(order.shipping_fee).toFixed(2)} kr`, 480, y, { align: 'right', width: 65 });
    y += 18;
    doc.moveTo(350, y).lineTo(545, y).strokeColor('#c8102e').lineWidth(1.5).stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a1a1a')
       .text('Total', 350, y).text(`${parseFloat(order.total).toFixed(2)} kr`, 480, y, { align: 'right', width: 65 });

    // Footer
    doc.font('Helvetica').fontSize(9).fillColor('#999')
       .text('Thank you for shopping at ReadOneMore!', 50, 760, { align: 'center', width: 495 })
       .text('Questions? hello@readonemore.dk', 50, 774, { align: 'center', width: 495 });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // 3. Log in sale_reports table
  await db.query(
    'INSERT INTO sale_reports (order_id, pdf_path) VALUES ($1,$2)',
    [orderId, filepath]
  );

  return filepath;
}

module.exports = { generateSaleReport };