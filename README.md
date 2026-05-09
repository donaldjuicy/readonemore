# ReadOneMore 📚

A secondhand bookstore web app for selling curated used books in Copenhagen.

## What it does

- Customers can browse, search, and filter books by genre
- Guest checkout with MobilePay payment instructions
- Shipping cost calculated by postal code
- Admin scanner tool for cataloging books by ISBN using a phone camera

## Tech stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Frontend:** Vanilla HTML/CSS/JS (single page)
- **Auth:** JWT (admin only)
- **Image processing:** sharp + multer

## Project structure

```
src/
  app.js                  # Entry point
  routes/
    admin.js              # Admin endpoints + ISBN lookup + photo upload
    auth.js               # Login / JWT
    books.js              # Public book browsing
    orders.js             # Guest checkout
    cart.js               # Cart
    payments.js           # MobilePay
    reports.js            # Admin reports
  middleware/
    auth.js               # JWT verification
  services/
    shipping.js           # Postal code → shipping cost
  utils/
    db.js                 # Postgres connection
    seed.js               # Seed script
public/
  index.html              # Customer storefront
  admin/
    scan.html             # Mobile ISBN scanner tool
db/
  schema.sql              # Full database schema
```

## Getting started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env

# Run database schema
npm run db:migrate

# Start the server
npm start
```

### Environment variables

```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/readonemore
JWT_SECRET=your_secret_here
PORT=3000
```

## Admin scanner

The ISBN scanner lives at `/admin/scan`. It's a mobile-first page for cataloging books:

1. Log in with admin credentials
2. Tap **Start camera** and point at the barcode on the back of a book
3. Metadata auto-fills from Google Books API
4. Add price, condition, and an optional photo
5. Tap **Save & next**

To access it from your phone during local development, use [ngrok](https://ngrok.com):

```bash
# Terminal 1
npm start

# Terminal 2
ngrok http 3000
```

Then open `https://your-ngrok-url.ngrok-free.app/admin/scan` on your phone.

## Shipping zones (Denmark)

| Zone | Postal codes | Cost |
|------|-------------|------|
| Free | 2900 (Hellerup) | 0 kr |
| Zone 1 | 1000–2999 | 20 kr |
| Zone 2 | 3000–3999 | 40 kr |
| Zone 3 | 4000–6999 | 60 kr |
| Zone 4 | 7000–8999 | 80 kr |
| Zone 5 | 9000–9999 | 90 kr |
| Pickup | — | Free |
