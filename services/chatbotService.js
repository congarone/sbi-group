/**
 * Chatbot za akcije i promet — odgovara na pitanja o prodaji, brendovima, preporukama.
 */

const db = require('./database');
const recommendationEngine = require('./recommendationEngine');
const { loadAndValidateMapping } = require('./dbMapping');
const sqlServer = require('./sqlServer');
const promoActionsService = require('./promoActionsService');

let appConfig = {};
try {
  appConfig = require('../config.json');
} catch (_) {}

const MONTH_NAMES = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];

function normalizeText(s) {
  return (s || '').toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function parseMonthFromMsg(msg) {
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (msg.includes(MONTH_NAMES[i])) return i + 1;
  }
  return null;
}

function getDateRangeForMonth(month, year) {
  const m = String(month).padStart(2, '0');
  return { from: `${year}-${m}-01`, to: `${year}-${m}-31` };
}

async function getDailySalesForChat() {
  try {
    loadAndValidateMapping();
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (appConfig.recommendationLookbackDays || 14));
    return await sqlServer.getDailySales({
      fromDate: from.toISOString().slice(0, 10),
      toDate: to.toISOString().slice(0, 10),
    });
  } catch (_) {
    return [];
  }
}

/**
 * Pronalazi brend u pitanju — traži riječi koje nisu uobičajene (prodavao, kako, u, po, itd.)
 */
function extractBrandFromMsg(msg) {
  const skip = new Set(['kako', 'koliko', 'koliki', 'sta', 'šta', 'prodavao', 'prodaja', 'promet', 'u', 'za', 'po', 'je', 'se', 'februaru', 'januaru', 'martu', 'aprilu', 'maju', 'junu', 'julu', 'avgustu', 'septembru', 'oktobru', 'novembru', 'decembru', 'februar', 'januar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar', 'cijeli', 'ovaj', 'mjesec', 'godinu']);
  const words = msg.split(/\s+/).filter(w => w.length > 2 && !skip.has(w));
  return words.join(' ') || null;
}

/**
 * Glavna funkcija: prima poruku korisnika, vraća odgovor.
 */
async function chat(userMessage) {
  const msg = normalizeText(userMessage);
  const year = new Date().getFullYear();
  const events = await db.getPromotionEvents();
  const retailSummary = await db.getRetailMonthSummary(new Date().getMonth() + 1, year);

  if (!msg) {
    return 'Napiši nešto — mogu da odgovorim na pitanja o prometu, brendovima, preporukama.';
  }

  // --- Prodaja po brendu (npr. "kako se prodavao kidsworld u februaru") ---
  const monthNum = parseMonthFromMsg(msg);
  const brandHint = extractBrandFromMsg(msg);
  if ((msg.includes('prodava') || msg.includes('prodaj') || msg.includes('promet') || msg.includes('koliko')) && (brandHint || monthNum !== null)) {
    const targetMonth = monthNum || (new Date().getMonth() + 1);
    const targetYear = monthNum ? year : year;
    const { from, to } = getDateRangeForMonth(targetMonth, targetYear);
    const byBrand = await db.getRetailByBrand(from, to);
    if (byBrand && byBrand.length > 0) {
      let brandRow = null;
      if (brandHint) {
        const hint = brandHint.toLowerCase();
        const hintStart = hint.slice(0, 4);
        brandRow = byBrand.find(r => {
          const brand = (r.brand || '').toLowerCase();
          return brand.includes(hint) || hint.includes(brand) || brand.startsWith(hintStart) || hint.startsWith(brand.slice(0, 4));
        });
      }
      if (brandRow) {
        const mName = MONTH_NAMES[targetMonth - 1] || targetMonth;
        return `**${brandRow.brand}** u ${mName} ${targetYear}: **${Number(brandRow.totalAmount).toLocaleString('sr-RS')} €** (${brandRow.dayCount || 0} dana).`;
      }
      if (brandHint && byBrand.length > 0) {
        const similar = byBrand.filter(b => (b.brand || '').toLowerCase().includes(brandHint.slice(0, 4)));
        if (similar.length > 0) {
          const mName = MONTH_NAMES[targetMonth - 1] || targetMonth;
          return similar.map(b => `**${b.brand}**: ${Number(b.totalAmount).toLocaleString('sr-RS')} €`).join('\n') + `\n(${mName} ${targetYear})`;
        }
        const onlySvi = byBrand.length === 1 && (byBrand[0].brand || '').toLowerCase() === 'svi';
        if (onlySvi) {
          const total = byBrand[0].totalAmount || 0;
          const mName = MONTH_NAMES[targetMonth - 1] || targetMonth;
          return `Nema podataka po brendu (Excel nema kolonu brend). Ukupan promet u ${mName} ${targetYear}: **${Number(total).toLocaleString('sr-RS')} €**.`;
        }
        return `Nisam pronašao brend "${brandHint}". Dostupni brendovi: ${byBrand.slice(0, 8).map(b => b.brand).join(', ')}${byBrand.length > 8 ? '…' : ''}.`;
      }
      if (monthNum && byBrand.length > 0) {
        const mName = MONTH_NAMES[targetMonth - 1] || targetMonth;
        const top = byBrand.slice(0, 5).map(b => `${b.brand}: ${Number(b.totalAmount).toLocaleString('sr-RS')} €`).join('\n');
        return `Promet po brendu u ${mName} ${targetYear}:\n${top}`;
      }
    } else if (brandHint) {
      return `Nema podataka po brendu za taj period. Preuzmi retail Excel-e i pokreni \`node scripts/retail-parse-by-brand.js\`.`;
    }
  }

  // --- Opšti promet (koliki je promet, promet ovaj mjesec) ---
  if (msg.includes('promet') && !msg.includes('brend') && !brandHint) {
    const total = retailSummary.totalAmount || 0;
    const days = retailSummary.dayCount || 0;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const row = await db.getRetailDay(d.toISOString().slice(0, 10));
    const yesterday = row ? row.amount : 0;
    if (msg.includes('jucer') || msg.includes('jučer') || msg.includes('juce')) {
      return yesterday > 0 ? `Jučerašnji promet: **${Number(yesterday).toLocaleString('sr-RS')} €**.` : 'Nema podataka za jučer.';
    }
    return `Retail promet ovaj mjesec: **${total.toLocaleString('sr-RS')} €** (${days} dana).`;
  }

  // --- Preporuke ---
  if (msg.includes('preporuk') || msg.includes('predlo') || msg.includes('sta da') || msg.includes('šta da')) {
    const sales = await getDailySalesForChat();
    const recs = await recommendationEngine.generateRecommendations(sales, new Map(), appConfig);
    const top = recs.slice(0, 5);
    if (top.length === 0) {
      return 'Nema preporuka za sada. Uvezi istoriju akcija i pokreni učenje, pa preuzmi retail promet.';
    }
    let text = '**Top 5 preporuka:**\n';
    top.forEach((r, i) => {
      text += `${i + 1}. ${r.articleName || r.articleCode} — rabat ${r.suggestedDiscountPercent}%, ${r.suggestedDays} dana. Očekivano +${(r.expectedAdditionalRevenue || 0).toFixed(0)} €.\n`;
    });
    text += '\n(Artikli koji su bili na akciji u zadnjih 30 dana su automatski isključeni.)';
    return text;
  }

  // --- Broj akcija ---
  if (msg.includes('akcij') && (msg.includes('koliko') || msg.includes('broj'))) {
    return `U bazi ima **${events.length}** akcija (iz foldera akcije).`;
  }

  // --- Stavi akciju ---
  if (msg.includes('stavi') && (msg.includes('akciju') || msg.includes('interne') || msg.includes('riscossa') || msg.includes('grupu'))) {
    try {
      const res = await promoActionsService.staviAkciju(userMessage);
      if (res.ok) {
        return `✅ ${res.message}\n\nExcel je u folderu output.`;
      }
      return res.message;
    } catch (e) {
      return 'Greška: ' + e.message;
    }
  }

  // --- Pomoć ---
  if (msg.includes('pomoc') || msg.includes('pomoć') || msg.includes('help') || msg.includes('sta mogu')) {
    return `Mogu da:
• **Promet** — "koliki je promet", "jučerašnji promet"
• **Prodaja po brendu** — "kako se prodavao Kidsworld u februaru"
• **Preporuke** — "šta preporučuješ"
• **Stavi akciju** — "stavi interne za Riscossa"
• **Akcije** — "koliko akcija ima"

Pitaj slobodno.`;
  }

  return 'Pitaj za promet ("koliki je promet"), prodaju po brendu ("kako se prodavao Kidsworld u februaru"), preporuke ("šta preporučuješ") ili pomoć ("pomoć").';
}

module.exports = { chat };
