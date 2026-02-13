/**
 * Re-parsira sve retail Excel fajlove iz retail_downloads i puni retail_daily_by_brand.
 * Pokreni nakon što imaš preuzete Excel-e: node scripts/retail-parse-by-brand.js
 */
const path = require('path');
const fs = require('fs');
const retailExcelParser = require(path.join(__dirname, '..', 'services', 'retailExcelParser'));
const db = require(path.join(__dirname, '..', 'services', 'database'));

const downloadDir = path.join(__dirname, '..', 'data', 'retail_downloads');

async function run() {
  if (!fs.existsSync(downloadDir)) {
    console.log('Folder', downloadDir, 'ne postoji. Prvo preuzmi retail Excel-e.');
    process.exit(1);
  }
  const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
  console.log('Pronađeno', files.length, 'Excel fajlova');
  let ok = 0, err = 0;
  for (const f of files) {
    const filePath = path.join(downloadDir, f);
    try {
      const daily = retailExcelParser.parseRetailExcelToDaily(filePath);
      const byBrand = retailExcelParser.parseRetailExcelToDailyByBrand(filePath);
      const byRegion = retailExcelParser.parseRetailExcelToDailyByRegion(filePath);
      for (const d of daily) await db.upsertRetailDay(d.date, d.amount, d.quantity);
      for (const b of byBrand) await db.upsertRetailByBrand(b.date, b.brand, b.amount, b.quantity);
      for (const r of byRegion) await db.upsertRetailByRegion(r.date, r.region, r.amount, r.quantity);
      if (byBrand.length > 0 || byRegion.length > 0) {
        const brands = [...new Set(byBrand.map(x => x.brand))].join(', ');
        const regions = [...new Set(byRegion.map(x => x.region))].join(', ');
        console.log('OK:', f, '->', byBrand.length, 'brend,', byRegion.length, 'regija,', brands || regions);
        ok++;
      }
    } catch (e) {
      console.log('GREŠKA:', f, e.message);
      err++;
    }
  }
  const brandSummary = await db.getRetailByBrand('2026-01-01', '2026-12-31');
  const regionSummary = await db.getRetailByRegion('2026-01-01', '2026-12-31');
  console.log('');
  console.log('Završeno:', ok, 'OK,', err, 'grešaka');
  console.log('Analiza po brendu:', brandSummary.length, 'brendova');
  brandSummary.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.brand}: ${r.totalAmount.toFixed(0)} € (${r.dayCount} dana)`);
  });
  if (regionSummary.length > 0) {
    console.log('Analiza po regiji:', regionSummary.length, 'regija');
    regionSummary.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.region}: ${r.totalAmount.toFixed(0)} €`);
    });
  }
}

run().catch(e => { console.error(e); process.exit(1); });
