-- Quick Sale — database schema (PostgreSQL: Neon / Supabase / Vercel Postgres)
-- Run this once on your database.

CREATE TABLE IF NOT EXISTS quick_sale_bills (
  bill_no       VARCHAR(55) PRIMARY KEY,     -- unique bill number from the app
  sale_date     DATE          NOT NULL,      -- for date-wise dashboard filtering
  created_at    TIMESTAMPTZ   NOT NULL,      -- exact time of sale (ISO 8601)
  payment_mode  VARCHAR(10)   NOT NULL,      -- 'CASH' | 'CARD' | 'UPI'
  grand_total   DECIMAL(12,2) NOT NULL       -- Σ line_total
);

CREATE TABLE IF NOT EXISTS quick_sale_items (
  id          BIGSERIAL     PRIMARY KEY,
  bill_no     VARCHAR(55)   NOT NULL REFERENCES quick_sale_bills(bill_no) ON DELETE CASCADE,
  category    VARCHAR(30)   NOT NULL,        -- Earrings | Bracelets | Rings | Necklace
  pieces      INT           NOT NULL,
  price       DECIMAL(12,2) NOT NULL,        -- price PER PIECE
  line_total  DECIMAL(12,2) NOT NULL         -- pieces × price
);

CREATE INDEX IF NOT EXISTS idx_qsb_date ON quick_sale_bills (sale_date);
CREATE INDEX IF NOT EXISTS idx_qsi_bill ON quick_sale_items (bill_no);