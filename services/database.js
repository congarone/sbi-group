/**
 * Database adapter: SQLite (lokalno) ili Supabase (cloud).
 * Ako su SUPABASE_URL i SUPABASE_SERVICE_KEY postavljeni, koristi Supabase.
 * Na Renderu MORA Supabase (SQLite ne radi). Inače koristi SQLite.
 */

const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

if (process.env.RENDER && !useSupabase) {
  console.error('[DB] Na Renderu moraš postaviti SUPABASE_URL i SUPABASE_SERVICE_KEY u Environment.');
  process.exit(1);
}

let impl;
if (useSupabase) {
  impl = require('./databaseSupabase');
} else {
  impl = require('./databaseSqlite');
}

// Omotaj SQLite funkcije u Promise radi jedinstvenog async API-ja
function wrapSync(fn) {
  return function (...args) {
    return Promise.resolve(fn.apply(impl, args));
  };
}

const db = {
  getDb: impl.getDb,
  closeDb: impl.closeDb,
  DB_PATH: impl.DB_PATH,
};

const syncMethods = [
  'upsertPromotionEvents', 'clearPromotionEvents', 'getPromotionEvents',
  'wasArticleOnPromoRecently', 'upsertProductProfile', 'getProductProfiles',
  'getCategoryAverageUplift', 'upsertRetailDay', 'clearRetailDays', 'getRetailDaysCount',
  'getRetailDay', 'getRetailMonthSummary', 'getRetailDateRange',
  'upsertRetailByBrand', 'getRetailByBrand', 'upsertRetailByRegion', 'getRetailByRegion',
];

for (const m of syncMethods) {
  db[m] = impl[m].constructor.name === 'AsyncFunction' ? impl[m] : wrapSync(impl[m]);
}

module.exports = db;
