/**
 * Engine za preporuku akcija: na osnovu zadnjih 7 dana prodaje, elastičnosti i (opciono) zaliha
 * predlaže akcije (rabat, trajanje, očekivani uplift, očekivani dodatni promet).
 * Bez heuristike - koristi naučene profile.
 */

const db = require('./database');

const LOOKBACK_DAYS = 7;

/**
 * Grupiše dnevnu prodaju po artiklu (zbroj količina i iznosa u periodu).
 */
function aggregateSalesByArticle(dailySales) {
  const byArticle = new Map();
  for (const row of dailySales) {
    const code = String(row.articleCode ?? row.artikal_id ?? '').trim();
    if (!code) continue;
    const qty = Number(row.quantity) || 0;
    const amount = Number(row.amount) || 0;
    const name = row.articleName ?? row.article_name ?? '';
    if (!byArticle.has(code)) {
      byArticle.set(code, { articleCode: code, articleName: name, quantity: 0, amount: 0, days: 0 });
    }
    const rec = byArticle.get(code);
    rec.quantity += qty;
    rec.amount += amount;
    rec.days += 1;
  }
  return Array.from(byArticle.values());
}

/**
 * Detektuje artikle u padu: upoređuje zadnjih 7 dana sa prethodnih 7 (ili sa prosjekom).
 * Ako nema prethodnog perioda, koristimo trend: pad u odnosu na prvu polovinu vs drugu polovinu lookbacka.
 */
function detectDecliningArticles(dailySales, lookbackDays = LOOKBACK_DAYS) {
  const byArticle = new Map();
  for (const row of dailySales) {
    const code = String(row.articleCode ?? '').trim();
    if (!code) continue;
    const dateStr = String(row.date ?? '').slice(0, 10);
    const qty = Number(row.quantity) || 0;
    if (!byArticle.has(code)) byArticle.set(code, []);
    byArticle.get(code).push({ date: dateStr, quantity: qty });
  }

  const declining = [];
  const half = Math.floor(lookbackDays / 2);
  for (const [code, entries] of byArticle) {
    const sorted = entries.sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < half) continue;
    const firstHalf = sorted.slice(0, half);
    const secondHalf = sorted.slice(-half);
    const avgFirst = firstHalf.reduce((s, e) => s + e.quantity, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, e) => s + e.quantity, 0) / secondHalf.length;
    if (avgFirst <= 0) continue;
    const changePct = (avgSecond - avgFirst) / avgFirst;
    if (changePct < -0.1) {
      declining.push({
        articleCode: code,
        changePercent: Math.round(changePct * 100) / 100,
        avgFirst,
        avgSecond,
      });
    }
  }
  return declining.sort((a, b) => a.changePercent - b.changePercent);
}

/**
 * Za artikle bez prometa u lookbacku (potencijalno za reaktivaciju) možemo uzeti sve artikle iz profila.
 */
async function getRecommendationCandidates(aggregatedSales, decliningArticles, includeAllWithProfile = false) {
  const decliningCodes = new Set(decliningArticles.map((d) => d.articleCode));
  const byCode = new Map(aggregatedSales.map((a) => [a.articleCode, a]));
  const candidates = new Set(decliningCodes);
  if (includeAllWithProfile) {
    const profiles = await db.getProductProfiles();
    for (const p of profiles) candidates.add(p.artikal_id);
  }
  return Array.from(candidates).map((code) => ({
    articleCode: code,
    ...byCode.get(code),
    isDeclining: decliningCodes.has(code),
    decline: decliningArticles.find((d) => d.articleCode === code),
  }));
}

/**
 * Preporuka po elastičnosti (specifikacija):
 * HIGH/EXTREME -> agresivna akcija
 * LOW -> ne stavljati na akciju osim clearing stock
 * MEDIUM -> standard letak
 */
function getSuggestedDiscountAndDuration(elasticityClass, isDeclining, hasStockToClear) {
  switch (elasticityClass) {
    case 'EXTREME':
      return { suggestedDiscountPercent: 25, suggestedDays: 7, rationale: 'Agresivna akcija - ekstremna elastičnost' };
    case 'HIGH':
      return { suggestedDiscountPercent: 18, suggestedDays: 7, rationale: 'Agresivna akcija - visoka elastičnost' };
    case 'MEDIUM':
      return { suggestedDiscountPercent: 12, suggestedDays: 7, rationale: 'Standard letak' };
    case 'LOW':
    default:
      if (hasStockToClear) {
        return { suggestedDiscountPercent: 10, suggestedDays: 5, rationale: 'Clearing zaliha' };
      }
      return null; // ne preporučuj akciju
  }
}

/**
 * Glavna funkcija: generiše listu preporuka za akcije.
 * @param dailySales - zadnjih N dana prodaje (iz SQL)
 * @param stockByArticle - opciono Map<articleCode, quantity> (zalihe)
 * @param config - { recommendationLookbackDays }
 */
async function generateRecommendations(dailySales, stockByArticle = new Map(), config = {}) {
  const lookback = config.recommendationLookbackDays ?? LOOKBACK_DAYS;
  const aggregated = aggregateSalesByArticle(dailySales);
  const declining = detectDecliningArticles(dailySales, lookback);
  const candidates = await getRecommendationCandidates(aggregated, declining, true);

  const categoryAvg = await db.getCategoryAverageUplift();
  const recommendations = [];

  const today = new Date().toISOString().slice(0, 10);
  const minDaysBetween = 30;

  for (const c of candidates) {
    if (await db.wasArticleOnPromoRecently(c.articleCode, today, minDaysBetween)) continue;
    const profile = await db.getProductProfiles(c.articleCode);
    const avgUplift = profile ? profile.avg_uplift : categoryAvg.avg_uplift;
    const confidence = profile ? profile.confidence_score : categoryAvg.confidence_score ?? 0.5;
    const elasticityClass = profile ? profile.elasticity_class : 'MEDIUM';
    const hasStockToClear = stockByArticle.has(c.articleCode) && stockByArticle.get(c.articleCode) > 0;

    const suggestion = getSuggestedDiscountAndDuration(
      elasticityClass,
      c.isDeclining,
      hasStockToClear
    );
    if (!suggestion && elasticityClass === 'LOW' && !hasStockToClear) continue;

    const rec = {
      articleCode: c.articleCode,
      articleName: c.articleName || c.articleCode,
      elasticityClass,
      confidenceScore: confidence,
      avgUplift,
      suggestedDiscountPercent: suggestion?.suggestedDiscountPercent ?? 0,
      suggestedDays: suggestion?.suggestedDays ?? 7,
      rationale: suggestion?.rationale ?? '',
      isDeclining: c.isDeclining,
      changePercent: c.decline?.changePercent,
      lastPeriodQuantity: c.quantity ?? 0,
      lastPeriodAmount: c.amount ?? 0,
    };

    // Očekivani uplift (koristi naučeni avg_uplift)
    rec.expectedUplift = avgUplift;
    const dailyQty = (c.quantity ?? 0) / Math.max(1, c.days ?? lookback);
    const dailyAmount = (c.amount ?? 0) / Math.max(1, c.days ?? lookback);
    rec.expectedAdditionalQuantity = Math.max(0, dailyQty * (avgUplift - 1) * rec.suggestedDays);
    rec.expectedAdditionalRevenue = Math.max(0, dailyAmount * (avgUplift - 1) * rec.suggestedDays);

    recommendations.push(rec);
  }

  return recommendations.sort((a, b) => (b.expectedAdditionalRevenue || 0) - (a.expectedAdditionalRevenue || 0));
}

module.exports = {
  generateRecommendations,
  detectDecliningArticles,
  aggregateSalesByArticle,
  getSuggestedDiscountAndDuration,
};
