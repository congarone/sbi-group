/**
 * Učenje elastičnosti: za svaki artikal iz promotion_events računamo uplift
 * (prosjek dnevne količine tokom akcije / prosjek dnevne količine 14 dana prije).
 * Rezultat: product_promo_profile (avg_uplift, confidence_score, elasticity_class).
 * Nazivi kolona i logika bez hardcoded pretpostavki - koristi mapping i config.
 */

const db = require('./database');

const BASELINE_DAYS = 14;

/**
 * Grupiše dnevnu prodaju po artiklu i po datumu za brzi lookup.
 * dailySales: Array<{ date, articleCode, quantity }>
 * Returns Map<artikalId, Map<dateStr, quantity>>
 */
function groupSalesByArticleAndDate(dailySales) {
  const byArticle = new Map();
  for (const row of dailySales) {
    const code = String(row.articleCode ?? row.artikal_id ?? '').trim();
    if (!code) continue;
    const dateStr = String(row.date ?? '').slice(0, 10);
    const qty = Number(row.quantity) || 0;
    if (!byArticle.has(code)) byArticle.set(code, new Map());
    const byDate = byArticle.get(code);
    byDate.set(dateStr, (byDate.get(dateStr) || 0) + qty);
  }
  return byArticle;
}

/**
 * Za jedan promo period izračunaj baseline (prosjek dnevne količine 14 dana prije) i during (prosjek tokom akcije).
 */
function getBaselineAndDuring(salesByDate, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const baselineStart = new Date(start);
  baselineStart.setDate(baselineStart.getDate() - BASELINE_DAYS);

  let baselineSum = 0;
  let baselineDays = 0;
  let duringSum = 0;
  let duringDays = 0;

  for (const [dateStr, qty] of salesByDate) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    if (d >= baselineStart && d < start) {
      baselineSum += qty;
      baselineDays += 1;
    } else if (d >= start && d <= end) {
      duringSum += qty;
      duringDays += 1;
    }
  }

  const baselineAvg = baselineDays > 0 ? baselineSum / baselineDays : 0;
  const duringAvg = duringDays > 0 ? duringSum / duringDays : 0;
  return { baselineAvg, duringAvg, baselineDays, duringDays };
}

/**
 * Izračunaj uplift za jedan period. Ako baseline 0, ne možemo računati.
 */
function computeUplift(baselineAvg, duringAvg) {
  if (baselineAvg <= 0) return null;
  return duringAvg / baselineAvg;
}

/**
 * Odredi elasticity_class na osnovu avg_uplift i config thresholda.
 */
function getElasticityClass(avgUplift, thresholds) {
  if (!thresholds) {
    if (avgUplift >= 2.2) return 'EXTREME';
    if (avgUplift >= 1.6) return 'HIGH';
    if (avgUplift >= 1.2) return 'MEDIUM';
    return 'LOW';
  }
  if (thresholds.EXTREME?.minUplift != null && avgUplift >= thresholds.EXTREME.minUplift)
    return 'EXTREME';
  if (thresholds.HIGH?.minUplift != null && avgUplift >= thresholds.HIGH.minUplift && avgUplift < (thresholds.HIGH.maxUplift ?? 999))
    return 'HIGH';
  if (thresholds.MEDIUM?.minUplift != null && avgUplift >= thresholds.MEDIUM.minUplift && avgUplift < (thresholds.MEDIUM.maxUplift ?? 999))
    return 'MEDIUM';
  return 'LOW';
}

/**
 * Pokreće učenje: koristi promotion_events iz baze i daily sales (iz SQL Servera).
 * @param {Array<{ date, articleCode, quantity }>} dailySales - dnevna prodaja (npr. cijela godina 2025)
 * @param {Object} config - config.json (baselineDaysBeforePromo, elasticityThresholds)
 */
async function runElasticityLearning(dailySales, config = {}) {
  const baselineDays = config.baselineDaysBeforePromo ?? BASELINE_DAYS;
  const thresholds = config.elasticityThresholds ?? null;

  const salesByArticle = groupSalesByArticleAndDate(dailySales);
  const events = await db.getPromotionEvents();

  // Grupiši evente po artiklu
  const eventsByArticle = new Map();
  for (const ev of events) {
    const id = String(ev.artikal_id).trim();
    if (!eventsByArticle.has(id)) eventsByArticle.set(id, []);
    eventsByArticle.get(id).push(ev);
  }

  const profiles = [];

  for (const [artikalId, articleEvents] of eventsByArticle) {
    const salesByDate = salesByArticle.get(artikalId);
    const dateMap = salesByDate ? new Map([...salesByDate].sort((a, b) => a[0].localeCompare(b[0]))) : new Map();

    const uplifts = [];
    for (const ev of articleEvents) {
      const { baselineAvg, duringAvg, baselineDays: bd, duringDays: dd } = getBaselineAndDuring(
        dateMap,
        ev.start_date,
        ev.end_date
      );
      const uplift = computeUplift(baselineAvg, duringAvg);
      if (uplift != null && uplift > 0 && uplift < 100) uplifts.push(uplift); // filter outliers
    }

    if (uplifts.length === 0) continue; // nema dovoljno podataka za ovaj artikal

    const avgUplift = uplifts.reduce((a, b) => a + b, 0) / uplifts.length;
    const maxUplift = Math.max(...uplifts);
    const variance = uplifts.length > 1
      ? uplifts.reduce((s, u) => s + Math.pow(u - avgUplift, 2), 0) / (uplifts.length - 1)
      : 0;
    const upliftStd = Math.sqrt(variance);
    // confidence: više uzoraka = veći confidence; manji std = veći confidence
    const confidenceScore = Math.min(1, Math.max(0, (uplifts.length / 5) * 0.3 + (1 - Math.min(1, upliftStd / 2)) * 0.7));
    const elasticityClass = getElasticityClass(avgUplift, thresholds);

    profiles.push({
      artikal_id: artikalId,
      avg_uplift: Math.round(avgUplift * 1000) / 1000,
      max_uplift: Math.round(maxUplift * 1000) / 1000,
      uplift_std: Math.round(upliftStd * 1000) / 1000,
      confidence_score: Math.round(confidenceScore * 1000) / 1000,
      elasticity_class: elasticityClass,
      sample_count: uplifts.length,
    });
  }

  // Snimi u bazu
  for (const p of profiles) {
    await db.upsertProductProfile(p);
  }

  return { profiles, count: profiles.length };
}

module.exports = {
  runElasticityLearning,
  getElasticityClass,
  getCategoryAverageUplift: db.getCategoryAverageUplift,
  groupSalesByArticleAndDate,
  getBaselineAndDuring,
  computeUplift,
};
