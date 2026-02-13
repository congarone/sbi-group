/**
 * Migracija podataka iz SQLite u Supabase.
 * Pokreni: node scripts/migrate-to-supabase.js
 * Zahtijeva: SUPABASE_URL i SUPABASE_SERVICE_KEY u .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const DB_PATH = path.join(__dirname, '..', 'data', 'promo.db');

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Postavi SUPABASE_URL i SUPABASE_SERVICE_KEY u .env');
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error('SQLite baza nije pronađena:', DB_PATH);
    process.exit(1);
  }

  const sqlite = new Database(DB_PATH);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  let total = 0;

  const promoEvents = sqlite.prepare('SELECT artikal_id, start_date, end_date, promo_price, discount_percent, source_file FROM promotion_events').all();
  if (promoEvents.length > 0) {
    const rows = promoEvents.map(r => ({
      artikal_id: r.artikal_id,
      start_date: r.start_date,
      end_date: r.end_date,
      promo_price: r.promo_price ?? null,
      discount_percent: r.discount_percent ?? null,
      source_file: r.source_file ?? null,
    }));
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await supabase.from('promotion_events').insert(rows.slice(i, i + chunk));
      if (error) throw new Error('promotion_events: ' + error.message);
    }
    total += promoEvents.length;
    console.log('promotion_events:', promoEvents.length);
  }

  const profiles = sqlite.prepare('SELECT artikal_id, avg_uplift, max_uplift, uplift_std, confidence_score, elasticity_class, sample_count FROM product_promo_profile').all();
  if (profiles.length > 0) {
    for (const p of profiles) {
      const { error } = await supabase.from('product_promo_profile').upsert({
        artikal_id: p.artikal_id,
        avg_uplift: p.avg_uplift,
        max_uplift: p.max_uplift ?? null,
        uplift_std: p.uplift_std ?? null,
        confidence_score: p.confidence_score ?? null,
        elasticity_class: p.elasticity_class,
        sample_count: p.sample_count ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'artikal_id' });
      if (error) throw new Error('product_promo_profile: ' + error.message);
    }
    total += profiles.length;
    console.log('product_promo_profile:', profiles.length);
  }

  const retailDays = sqlite.prepare('SELECT date, amount, quantity FROM retail_daily_turnover').all();
  if (retailDays.length > 0) {
    for (const r of retailDays) {
      const { error } = await supabase.from('retail_daily_turnover').upsert({
        date: r.date,
        amount: Number(r.amount) || 0,
        quantity: Number(r.quantity) || 0,
        created_at: new Date().toISOString(),
      }, { onConflict: 'date' });
      if (error) throw new Error('retail_daily_turnover: ' + error.message);
    }
    total += retailDays.length;
    console.log('retail_daily_turnover:', retailDays.length);
  }

  const byBrand = sqlite.prepare('SELECT date, brand, amount, quantity FROM retail_daily_by_brand').all();
  if (byBrand.length > 0) {
    for (const b of byBrand) {
      const { error } = await supabase.from('retail_daily_by_brand').upsert({
        date: b.date,
        brand: b.brand || 'Nepoznato',
        amount: Number(b.amount) || 0,
        quantity: Number(b.quantity) || 0,
        created_at: new Date().toISOString(),
      }, { onConflict: 'date,brand' });
      if (error) throw new Error('retail_daily_by_brand: ' + error.message);
    }
    total += byBrand.length;
    console.log('retail_daily_by_brand:', byBrand.length);
  }

  const byRegion = sqlite.prepare('SELECT date, region, amount, quantity FROM retail_daily_by_region').all();
  if (byRegion.length > 0) {
    for (const r of byRegion) {
      const { error } = await supabase.from('retail_daily_by_region').upsert({
        date: r.date,
        region: r.region || 'Nepoznato',
        amount: Number(r.amount) || 0,
        quantity: Number(r.quantity) || 0,
        created_at: new Date().toISOString(),
      }, { onConflict: 'date,region' });
      if (error) throw new Error('retail_daily_by_region: ' + error.message);
    }
    total += byRegion.length;
    console.log('retail_daily_by_region:', byRegion.length);
  }

  sqlite.close();
  console.log('\nMigracija završena. Ukupno:', total, 'zapisa.');
}

run().catch(e => { console.error(e); process.exit(1); });
