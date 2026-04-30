-- ReadOneMore Database Schema
-- Secondhand bookstore | Copenhagen | Single admin
-- Inspired by network_management_system architecture

BEGIN;

-- ─────────────────────────────────────────────
-- 1. USERS (admin + customers)
-- role: 'admin' | 'customer'
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
    user_id       bigserial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name     text NOT NULL,
    role          varchar(10) NOT NULL DEFAULT 'customer',
    phone         text,
    created_at    timestamp DEFAULT now(),
    last_login    timestamp
);

-- ─────────────────────────────────────────────
-- 2. GENRES  (flat list, admin-managed)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.genres (
    genre_id   bigserial PRIMARY KEY,
    name       text NOT NULL UNIQUE
);

-- ─────────────────────────────────────────────
-- 3. BOOKS  (the "materials" of the bookstore)
-- condition: 'like_new' | 'good' | 'fair' | 'worn'
-- status:    'available' | 'reserved' | 'sold'
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.books (
    book_id           bigserial PRIMARY KEY,
    title             text NOT NULL,
    author            text NOT NULL,
    isbn              text,
    genre_id          bigint REFERENCES public.genres(genre_id),
    condition         varchar(10) NOT NULL DEFAULT 'good',
    edition           text,
    year_published    integer,
    language          text DEFAULT 'English',
    price             numeric(8, 2) NOT NULL,
    stock             integer NOT NULL DEFAULT 1,  -- mirrors materials stock logic
    cover_image_url   text,
    mood_tags         text[],                      -- e.g. {'cozy','melancholic','adventurous'}
    provenance        text,                         -- story of the book
    description       text,
    status            varchar(10) NOT NULL DEFAULT 'available',
    added_at          timestamp DEFAULT now(),
    updated_at        timestamp DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. ADDRESSES  (reusable for shipping)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.addresses (
    address_id  bigserial PRIMARY KEY,
    user_id     bigint REFERENCES public.users(user_id),
    full_name   text NOT NULL,
    line1       text NOT NULL,
    line2       text,
    city        text NOT NULL,
    postal_code text NOT NULL,
    country     text NOT NULL DEFAULT 'Denmark',
    is_default  boolean DEFAULT false
);

-- ─────────────────────────────────────────────
-- 5. ORDERS  (mirrors 'sale' lifecycle)
-- delivery_method: 'shipping' | 'pickup'
-- status: 'pending_payment' | 'paid' | 'shipped' | 'ready_for_pickup' | 'completed' | 'cancelled'
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
    order_id            bigserial PRIMARY KEY,
    user_id             bigint REFERENCES public.users(user_id),
    delivery_method     varchar(20) NOT NULL DEFAULT 'shipping',
    address_id          bigint REFERENCES public.addresses(address_id),  -- null for pickup
    subtotal            numeric(10, 2) NOT NULL,
    shipping_fee        numeric(8, 2) NOT NULL DEFAULT 0,
    total               numeric(10, 2) NOT NULL,
    status              varchar(20) NOT NULL DEFAULT 'pending_payment',
    mobilepay_payment_id text,
    mobilepay_order_id  text UNIQUE,
    notes               text,
    created_at          timestamp DEFAULT now(),
    paid_at             timestamp,
    shipped_at          timestamp,
    completed_at        timestamp,
    cancelled_at        timestamp
);

-- ─────────────────────────────────────────────
-- 6. ORDER ITEMS  (mirrors sale line items)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_items (
    item_id    bigserial PRIMARY KEY,
    order_id   bigint NOT NULL REFERENCES public.orders(order_id),
    book_id    bigint NOT NULL REFERENCES public.books(book_id),
    quantity   integer NOT NULL DEFAULT 1,
    unit_price numeric(8, 2) NOT NULL  -- snapshot at time of order
);

-- ─────────────────────────────────────────────
-- 7. CART  (ephemeral, per user)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cart_items (
    cart_item_id bigserial PRIMARY KEY,
    user_id      bigint NOT NULL REFERENCES public.users(user_id),
    book_id      bigint NOT NULL REFERENCES public.books(book_id),
    quantity     integer NOT NULL DEFAULT 1,
    added_at     timestamp DEFAULT now(),
    UNIQUE (user_id, book_id)
);

-- ─────────────────────────────────────────────
-- 8. WISHLISTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wishlist_items (
    wishlist_item_id bigserial PRIMARY KEY,
    user_id          bigint NOT NULL REFERENCES public.users(user_id),
    book_id          bigint NOT NULL REFERENCES public.books(book_id),
    added_at         timestamp DEFAULT now(),
    UNIQUE (user_id, book_id)
);

-- ─────────────────────────────────────────────
-- 9. BADGE DEFINITIONS  (mirrors achievement definitions)
-- trigger_type: 'orders_count' | 'books_count' | 'genre_count' | 'spend_total'
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badge_definitions (
    badge_id      bigserial PRIMARY KEY,
    name          text NOT NULL,
    description   text NOT NULL,
    icon          text NOT NULL,               -- emoji or icon key
    trigger_type  varchar(20) NOT NULL,
    threshold     numeric(10, 2) NOT NULL,     -- e.g. 5 orders, 100 DKK spent
    created_at    timestamp DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 10. CUSTOMER BADGES  (mirrors worker achievements)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_badges (
    customer_badge_id bigserial PRIMARY KEY,
    user_id           bigint NOT NULL REFERENCES public.users(user_id),
    badge_id          bigint NOT NULL REFERENCES public.badge_definitions(badge_id),
    unlocked_at       timestamp DEFAULT now(),
    UNIQUE (user_id, badge_id)
);

-- ─────────────────────────────────────────────
-- 11. SALE REPORTS  (PDF generation log)
-- mirrors Sale_Reports in the waste system
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_reports (
    report_id    bigserial PRIMARY KEY,
    order_id     bigint NOT NULL REFERENCES public.orders(order_id),
    generated_at timestamp DEFAULT now(),
    pdf_path     text NOT NULL
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_books_status    ON public.books(status);
CREATE INDEX IF NOT EXISTS idx_books_genre     ON public.books(genre_id);
CREATE INDEX IF NOT EXISTS idx_orders_user     ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_cart_user       ON public.cart_items(user_id);

-- ─────────────────────────────────────────────
-- SEED: Genres
-- ─────────────────────────────────────────────
INSERT INTO public.genres (name) VALUES
  ('Fiction'), ('Non-Fiction'), ('Mystery & Thriller'), ('Science Fiction'),
  ('Fantasy'), ('Romance'), ('Biography'), ('History'), ('Philosophy'),
  ('Science'), ('Poetry'), ('Travel'), ('Self-Help'), ("Children's"), ('Comics & Graphic Novels')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: Badge Definitions  (mirrors achievement seeds in DMS_db_schema.sql)
-- ─────────────────────────────────────────────
INSERT INTO public.badge_definitions (name, description, icon, trigger_type, threshold) VALUES
  ('First Page',       'Placed your first order',                '📖', 'orders_count', 1),
  ('Bookworm',         'Ordered 5 or more books',                '🐛', 'orders_count', 5),
  ('Chapter Collector','Ordered 10 or more books',               '📚', 'orders_count', 10),
  ('Library Builder',  'Ordered 25 or more books',               '🏛️', 'orders_count', 25),
  ('Penny Reader',     'Spent 100 DKK or more',                  '💰', 'spend_total',  100),
  ('Big Spender',      'Spent 500 DKK or more',                  '🤑', 'spend_total',  500),
  ('Genre Explorer',   'Bought books from 5 different genres',   '🗺️', 'genre_count',  5),
  ('Omnivore',         'Bought books from 10 different genres',  '🦁', 'genre_count',  10)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: Admin user (password: changeme123 — bcrypt below is a placeholder)
-- Run: node -e "const b=require('bcryptjs');console.log(b.hashSync('changeme123',10))"
-- and replace the hash before deploying
-- ─────────────────────────────────────────────
INSERT INTO public.users (email, password_hash, full_name, role)
VALUES ('admin@readonemore.dk', '$2b$10$PLACEHOLDER_REPLACE_ME', 'ReadOneMore Admin', 'admin')
ON CONFLICT DO NOTHING;

COMMIT;