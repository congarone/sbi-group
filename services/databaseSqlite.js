/**
 * SQLite baza — lokalno. Koristi se kad SUPABASE_URL nije postavljen.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'promo.db');

let db = null;

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artikal_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      promo_price REAL,
      discount_percent REAL,
      source_file TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_promo_artikal ON promotion_events(artikal_id);
    CREATE INDEX IF NOT EXISTS idx_promo_dates ON promotion_events(start_date, end_date);
    CREATE TABLE IF NOT EXISTS product_promo_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artikal_id TEXT NOT NULL UNIQUE,
      avg_uplift REAL NOT NULL,
      max_uplift REAL,
      uplift_std REAL,
      confidence_score REAL,
      elasticity_class TEXT NOT NULL,
      sample_count INTEGER,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_profile_artikal ON product_promo_profile(artikal_id);
    CREATE TABLE IF NOT EXISTS retail_daily_turnover (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_retail_date ON retail_daily_turnover(date);
    CREATE TABLE IF NOT EXISTS retail_daily_by_brand (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      brand TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, brand)
    );
    CREATE INDEX IF NOT EXISTS idx_retail_brand_date ON retail_daily_by_brand(date);
    CREATE TABLE IF NOT EXISTS retail_daily_by_region (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      region TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, region)
    );
    CREATE INDEX IF NOT EXISTS idx_retail_region_date ON retail_daily_by_region(date);
  `);
  return db;
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

function upsertPromotionEvents(events) {
  const database = getDb();
  const stmt = database.prepare(`INSERT INTO promotion_events (artikal_id, start_date, end_date, promo_price, discount_percent, source_file) VALUES (@artikal_id, @start_date, @end_date, @promo_price, @discount_percent, @source_file)`);
  database.transaction(() => { for (const row of events) stmt.run(row); })();
}

function clearPromotionEvents() {
  getDb().exec('DELETE FROM promotion_events');
}

function getPromotionEvents(artikalId = null) {
  const database = getDb();
  if (artikalId) return database.prepare('SELECT * FROM promotion_events WHERE artikal_id = ? ORDER BY start_date').all(artikalId);
  return database.prepare('SELECT * FROM promotion_events ORDER BY artikal_id, start_date').all();
}

function upsertProductProfile(profile) {
  getDb().prepare(`INSERT INTO product_promo_profile (artikal_id, avg_uplift, max_uplift, uplift_std, confidence_score, elasticity_class, sample_count, updated_at)
    VALUES (@artikal_id, @avg_uplift, @max_uplift, @uplift_std, @confidence_score, @elasticity_class, @sample_count, datetime('now'))
    ON CONFLICT(artikal_id) DO UPDATE SET avg_uplift=excluded.avg_uplift, max_uplift=excluded.max_uplift, uplift_std=excluded.uplift_std, confidence_score=excluded.confidence_score, elasticity_class=excluded.elasticity_class, sample_count=excluded.sample_count, updated_at=datetime('now')`).run(profile);
}

function wasArticleOnPromoRecently(artikalId, beforeDate, minDaysBetweenPromos = 30) {
  const cutoff = new Date(beforeDate);
  cutoff.setDate(cutoff.getDate() - minDaysBetweenPromos);
  const row = getDb().prepare('SELECT 1 FROM promotion_events WHERE artikal_id = ? AND end_date >= ? LIMIT 1').get(artikalId, cutoff.toISOString().slice(0, 10));
  return !!row;
}

function getProductProfiles(artikalId = null) {
  const database = getDb();
  if (artikalId) return database.prepare('SELECT * FROM product_promo_profile WHERE artikal_id = ?').get(artikalId);
  return database.prepare('SELECT * FROM product_promo_profile ORDER BY artikal_id').all();
}

function getCategoryAverageUplift() {
  const row = getDb().prepare('SELECT AVG(avg_uplift) as avg_uplift, AVG(confidence_score) as confidence_score FROM product_promo_profile').get();
  return { avg_uplift: row?.avg_uplift ?? 1.2, confidence_score: row?.confidence_score ?? 0.5 };
}

function upsertRetailDay(dateStr, amount, quantity) {
  getDb().prepare(`INSERT INTO retail_daily_turnover (date, amount, quantity, created_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(date) DO UPDATE SET amount=excluded.amount, quantity=excluded.quantity`).run(dateStr, Number(amount) || 0, Number(quantity) || 0);
}

function clearRetailDays() {
  getDb().prepare('DELETE FROM retail_daily_turnover').run();
}

function getRetailDaysCount() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM retail_daily_turnover').get()?.c ?? 0;
}

function upsertRetailByBrand(dateStr, brand, amount, quantity) {
  getDb().prepare(`INSERT INTO retail_daily_by_brand (date, brand, amount, quantity, created_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(date, brand) DO UPDATE SET amount=excluded.amount, quantity=excluded.quantity`).run(dateStr, brand || 'Nepoznato', Number(amount) || 0, Number(quantity) || 0);
}

function getRetailByBrand(fromDate, toDate) {
  return getDb().prepare(`SELECT brand, SUM(amount) as totalAmount, SUM(quantity) as totalQuantity, COUNT(DISTINCT date) as dayCount FROM retail_daily_by_brand WHERE date >= ? AND date <= ? GROUP BY brand ORDER BY totalAmount DESC`).all(fromDate, toDate);
}

function upsertRetailByRegion(dateStr, region, amount, quantity) {
  getDb().prepare(`INSERT INTO retail_daily_by_region (date, region, amount, quantity, created_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(date, region) DO UPDATE SET amount=excluded.amount, quantity=excluded.quantity`).run(dateStr, region || 'Nepoznato', Number(amount) || 0, Number(quantity) || 0);
}

function getRetailByRegion(fromDate, toDate) {
  return getDb().prepare(`SELECT region, SUM(amount) as totalAmount, SUM(quantity) as totalQuantity, COUNT(DISTINCT date) as dayCount FROM retail_daily_by_region WHERE date >= ? AND date <= ? GROUP BY region ORDER BY totalAmount DESC`).all(fromDate, toDate);
}

function getRetailDateRange(fromDate, toDate) {
  return getDb().prepare('SELECT date, amount, quantity FROM retail_daily_turnover WHERE date >= ? AND date <= ? ORDER BY date').all(fromDate, toDate);
}

function getRetailDay(dateStr) {
  return getDb().prepare('SELECT date, amount, quantity FROM retail_daily_turnover WHERE date = ?').get(dateStr) || null;
}

function getRetailMonthSummary(month, year) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  const rows = getDb().prepare('SELECT date, amount, quantity FROM retail_daily_turnover WHERE date >= ? AND date <= ? ORDER BY date').all(start, end);
  return { totalAmount: rows.reduce((s, r) => s + (r.amount || 0), 0), totalQuantity: rows.reduce((s, r) => s + (r.quantity || 0), 0), days: rows, dayCount: rows.length };
}

module.exports = {
  getDb,
  closeDb,
  upsertPromotionEvents,
  clearPromotionEvents,
  getPromotionEvents,
  wasArticleOnPromoRecently,
  upsertProductProfile,
  getProductProfiles,
  getCategoryAverageUplift,
  upsertRetailDay,
  clearRetailDays,
  getRetailDaysCount,
  getRetailDay,
  getRetailMonthSummary,
  getRetailDateRange,
  upsertRetailByBrand,
  getRetailByBrand,
  upsertRetailByRegion,
  getRetailByRegion,
  DB_PATH: DB_PATH,
};
