/**
 * Preuzima retail Excel sa portala, parsira i upisuje u Supabase.
 * Za GitHub Actions ili ručno pokretanje.
 *
 * Env varijable:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY — obavezno
 *   RETAIL_USERNAME, RETAIL_PASSWORD — za login na portal (ili retail.source.json)
 *
 * Pokreni: node scripts/retail-fetch-and-sync.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');

const retailConfigPath = path.join(__dirname, '..', 'retail.source.json');

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Postavi SUPABASE_URL i SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }

  if (process.env.RETAIL_USERNAME || process.env.RETAIL_PASSWORD) {
    let cfg = {};
    if (fs.existsSync(retailConfigPath)) {
      try {
        cfg = JSON.parse(fs.readFileSync(retailConfigPath, 'utf8'));
      } catch (_) {}
    }
    cfg.username = process.env.RETAIL_USERNAME || cfg.username;
    cfg.password = process.env.RETAIL_PASSWORD || cfg.password;
    cfg.loginUrl = cfg.loginUrl || 'https://portal.idea-mlink.me/#!/';
    cfg.reportUrl = cfg.reportUrl || 'https://portal.idea-mlink.me/#!/mysales';
    cfg.dateOption = cfg.dateOption || 'yesterday';
    fs.writeFileSync(retailConfigPath, JSON.stringify(cfg, null, 2), 'utf8');
  }

  const retailFetcher = require('../services/retailFetcher');
  const retailExcelParser = require('../services/retailExcelParser');
  const db = require('../services/database');

  const daysInDb = await db.getRetailDaysCount();
  const isFirstMonth = daysInDb === 0;
  const mode = isFirstMonth ? 'month' : 'day';

  console.log('Preuzimanje retail Excel-a (mode:', mode, ')...');
  const result = await retailFetcher.fetchRetailExcel({ mode });
  if (!result.ok) {
    console.error('Greška:', result.error);
    process.exit(1);
  }

  let daily = retailExcelParser.parseRetailExcelToDaily(result.path);
  const byBrand = retailExcelParser.parseRetailExcelToDailyByBrand(result.path);
  const byRegion = retailExcelParser.parseRetailExcelToDailyByRegion(result.path);

  if (daily.length === 0 && result.dateTo) {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(result.path, { sheetStubs: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const header = (rows[0] || []).map(h => String(h).toLowerCase());
    const amountCol = header.findIndex(h => h.includes('iznos') || h.includes('amount') || h.includes('ukupno'));
    const qtyCol = header.findIndex(h => h.includes('kolicina') || h.includes('quantity'));
    let sumAmount = 0, sumQty = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (amountCol >= 0 && row[amountCol] != null) sumAmount += Number(row[amountCol]) || 0;
      if (qtyCol >= 0 && row[qtyCol] != null) sumQty += Number(row[qtyCol]) || 0;
    }
    daily = [{ date: result.dateTo, amount: sumAmount, quantity: sumQty }];
  }

  if (daily.length === 0 && (byBrand.length > 0 || byRegion.length > 0)) {
    const dates = [...new Set([...(byBrand.map(b => b.date)), ...(byRegion.map(r => r.date))])];
    daily = dates.map(d => {
      const bRows = byBrand.filter(x => x.date === d);
      const rRows = byRegion.filter(x => x.date === d);
      const amount = bRows.length > 0 ? bRows.reduce((s, x) => s + (x.amount || 0), 0) : rRows.reduce((s, x) => s + (x.amount || 0), 0);
      const quantity = bRows.length > 0 ? bRows.reduce((s, x) => s + (x.quantity || 0), 0) : rRows.reduce((s, x) => s + (x.quantity || 0), 0);
      return { date: d, amount, quantity };
    });
  }

  for (const b of byBrand) await db.upsertRetailByBrand(b.date, b.brand, b.amount, b.quantity);
  for (const r of byRegion) await db.upsertRetailByRegion(r.date, r.region, r.amount, r.quantity);
  for (const d of daily) await db.upsertRetailDay(d.date, d.amount, d.quantity);

  const summary = await db.getRetailMonthSummary(new Date().getMonth() + 1, new Date().getFullYear());
  console.log('Završeno. Uvezeno:', daily.length, 'dana. Ukupno ovaj mjesec:', summary.totalAmount?.toFixed(0), '€');
}

run().catch(e => { console.error(e); process.exit(1); });
