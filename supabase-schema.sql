-- Pokreni u Supabase SQL Editor (Dashboard -> SQL Editor)
-- Kreira tabele za SBI Group aplikaciju

CREATE TABLE IF NOT EXISTS promotion_events (
  id BIGSERIAL PRIMARY KEY,
  artikal_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  promo_price REAL,
  discount_percent REAL,
  source_file TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_artikal ON promotion_events(artikal_id);
CREATE INDEX IF NOT EXISTS idx_promo_dates ON promotion_events(start_date, end_date);

CREATE TABLE IF NOT EXISTS product_promo_profile (
  id BIGSERIAL PRIMARY KEY,
  artikal_id TEXT NOT NULL UNIQUE,
  avg_uplift REAL NOT NULL,
  max_uplift REAL,
  uplift_std REAL,
  confidence_score REAL,
  elasticity_class TEXT NOT NULL,
  sample_count INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_artikal ON product_promo_profile(artikal_id);

CREATE TABLE IF NOT EXISTS retail_daily_turnover (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retail_date ON retail_daily_turnover(date);

CREATE TABLE IF NOT EXISTS retail_daily_by_brand (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  brand TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, brand)
);
CREATE INDEX IF NOT EXISTS idx_retail_brand_date ON retail_daily_by_brand(date);
CREATE INDEX IF NOT EXISTS idx_retail_brand_name ON retail_daily_by_brand(brand);

CREATE TABLE IF NOT EXISTS retail_daily_by_region (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  region TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, region)
);
CREATE INDEX IF NOT EXISTS idx_retail_region_date ON retail_daily_by_region(date);
CREATE INDEX IF NOT EXISTS idx_retail_region_name ON retail_daily_by_region(region);

-- Napomena: Service role key (SUPABASE_SERVICE_KEY) zaobilazi RLS i ima pun pristup.
