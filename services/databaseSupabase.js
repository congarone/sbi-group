/**
 * Supabase cloud baza — isti API kao database.js, ali async.
 * Koristi se kad su SUPABASE_URL i SUPABASE_SERVICE_KEY postavljeni.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function upsertPromotionEvents(events) {
  if (!events || events.length === 0) return;
  await clearPromotionEvents();
  const rows = events.map(e => ({
    artikal_id: e.artikal_id,
    start_date: e.start_date,
    end_date: e.end_date,
    promo_price: e.promo_price ?? null,
    discount_percent: e.discount_percent ?? null,
    source_file: e.source_file ?? null,
  }));
  const { error } = await supabase.from('promotion_events').insert(rows);
  if (error) throw new Error(error.message);
}

async function clearPromotionEvents() {
  const { error } = await supabase.from('promotion_events').delete().neq('id', 0);
  if (error) throw new Error(error.message);
}

async function getPromotionEvents(artikalId = null) {
  let q = supabase.from('promotion_events').select('*').order('start_date');
  if (artikalId) q = q.eq('artikal_id', artikalId);
  else q = q.order('artikal_id');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function upsertProductProfile(profile) {
  const { error } = await supabase.from('product_promo_profile').upsert({
    artikal_id: profile.artikal_id,
    avg_uplift: profile.avg_uplift,
    max_uplift: profile.max_uplift ?? null,
    uplift_std: profile.uplift_std ?? null,
    confidence_score: profile.confidence_score ?? null,
    elasticity_class: profile.elasticity_class,
    sample_count: profile.sample_count ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'artikal_id' });
  if (error) throw new Error(error.message);
}

async function wasArticleOnPromoRecently(artikalId, beforeDate, minDaysBetweenPromos = 30) {
  const cutoff = new Date(beforeDate);
  cutoff.setDate(cutoff.getDate() - minDaysBetweenPromos);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const { data, error } = await supabase.from('promotion_events')
    .select('id').eq('artikal_id', artikalId).gte('end_date', cutoffStr).limit(1);
  if (error) throw new Error(error.message);
  return (data && data.length > 0);
}

async function getProductProfiles(artikalId = null) {
  if (artikalId) {
    const { data, error } = await supabase.from('product_promo_profile').select('*').eq('artikal_id', artikalId).single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data || null;
  }
  const { data, error } = await supabase.from('product_promo_profile').select('*').order('artikal_id');
  if (error) throw new Error(error.message);
  return data || [];
}

async function getCategoryAverageUplift() {
  const { data, error } = await supabase.from('product_promo_profile').select('avg_uplift, confidence_score');
  if (error) throw new Error(error.message);
  const rows = data || [];
  const avgUplift = rows.length ? rows.reduce((s, r) => s + (r.avg_uplift || 0), 0) / rows.length : 1.2;
  const avgConf = rows.length ? rows.reduce((s, r) => s + (r.confidence_score || 0), 0) / rows.length : 0.5;
  return { avg_uplift: avgUplift, confidence_score: avgConf };
}

async function upsertRetailDay(dateStr, amount, quantity) {
  const { error } = await supabase.from('retail_daily_turnover').upsert({
    date: dateStr,
    amount: Number(amount) || 0,
    quantity: Number(quantity) || 0,
    created_at: new Date().toISOString(),
  }, { onConflict: 'date' });
  if (error) throw new Error(error.message);
}

async function clearRetailDays() {
  const { error } = await supabase.from('retail_daily_turnover').delete().neq('id', 0);
  if (error) throw new Error(error.message);
}

async function getRetailDaysCount() {
  const { count, error } = await supabase.from('retail_daily_turnover').select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function upsertRetailByBrand(dateStr, brand, amount, quantity) {
  const { error } = await supabase.from('retail_daily_by_brand').upsert({
    date: dateStr,
    brand: brand || 'Nepoznato',
    amount: Number(amount) || 0,
    quantity: Number(quantity) || 0,
    created_at: new Date().toISOString(),
  }, { onConflict: 'date,brand' });
  if (error) throw new Error(error.message);
}

async function getRetailByBrand(fromDate, toDate) {
  const { data, error } = await supabase.from('retail_daily_by_brand')
    .select('date, brand, amount, quantity')
    .gte('date', fromDate).lte('date', toDate);
  if (error) throw new Error(error.message);
  const byBrand = {};
  for (const r of data || []) {
    const b = r.brand || 'Nepoznato';
    if (!byBrand[b]) byBrand[b] = { brand: b, totalAmount: 0, totalQuantity: 0, dates: new Set() };
    byBrand[b].totalAmount += r.amount || 0;
    byBrand[b].totalQuantity += r.quantity || 0;
    byBrand[b].dates.add(r.date);
  }
  return Object.values(byBrand).map(b => ({
    brand: b.brand,
    totalAmount: b.totalAmount,
    totalQuantity: b.totalQuantity,
    dayCount: b.dates.size,
  })).sort((a, b) => b.totalAmount - a.totalAmount);
}

async function upsertRetailByRegion(dateStr, region, amount, quantity) {
  const { error } = await supabase.from('retail_daily_by_region').upsert({
    date: dateStr,
    region: region || 'Nepoznato',
    amount: Number(amount) || 0,
    quantity: Number(quantity) || 0,
    created_at: new Date().toISOString(),
  }, { onConflict: 'date,region' });
  if (error) throw new Error(error.message);
}

async function getRetailByRegion(fromDate, toDate) {
  const { data, error } = await supabase.from('retail_daily_by_region')
    .select('date, region, amount, quantity')
    .gte('date', fromDate).lte('date', toDate);
  if (error) throw new Error(error.message);
  const byRegion = {};
  for (const r of data || []) {
    const reg = r.region || 'Nepoznato';
    if (!byRegion[reg]) byRegion[reg] = { region: reg, totalAmount: 0, totalQuantity: 0, dates: new Set() };
    byRegion[reg].totalAmount += r.amount || 0;
    byRegion[reg].totalQuantity += r.quantity || 0;
    byRegion[reg].dates.add(r.date);
  }
  return Object.values(byRegion).map(b => ({
    region: b.region,
    totalAmount: b.totalAmount,
    totalQuantity: b.totalQuantity,
    dayCount: b.dates.size,
  })).sort((a, b) => b.totalAmount - a.totalAmount);
}

async function getRetailDateRange(fromDate, toDate) {
  const { data, error } = await supabase.from('retail_daily_turnover')
    .select('date, amount, quantity')
    .gte('date', fromDate).lte('date', toDate)
    .order('date');
  if (error) throw new Error(error.message);
  return data || [];
}

async function getRetailDay(dateStr) {
  const { data, error } = await supabase.from('retail_daily_turnover').select('date, amount, quantity').eq('date', dateStr).single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data || null;
}

async function getRetailMonthSummary(month, year) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  const rows = await getRetailDateRange(start, end);
  const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const totalQuantity = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  return { totalAmount, totalQuantity, days: rows, dayCount: rows.length };
}

function closeDb() {
  // Supabase nema close
}

const DB_PATH = 'supabase';

module.exports = {
  getDb: null,
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
  DB_PATH,
};
