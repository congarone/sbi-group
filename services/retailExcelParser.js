/**
 * Parsira preuzeti retail Excel: izvlači datum i iznos (i količinu) po danu,
 * agregira po datumu i vraća listu { date, amount, quantity } za upsert u retail_daily_turnover.
 */

const XLSX = require('xlsx');

function normalize(s) {
  if (s == null) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function findColumnIndex(headers, aliases) {
  for (let c = 0; c < headers.length; c++) {
    const h = normalize(headers[c]);
    for (const a of aliases) {
      if (h.includes(a) || a.includes(h)) return c;
    }
  }
  return -1;
}

/**
 * Iz Excel fajla (putanja) izvlači redove po datumu i sumira amount/quantity.
 * Vraća [{ date: 'YYYY-MM-DD', amount, quantity }, ...].
 */
function parseRetailExcelToDaily(filePath) {
  const wb = XLSX.readFile(filePath, { sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const line = (raw[r] || []).join(' ').toLowerCase();
    if (line.includes('datum') || line.includes('date') || line.includes('iznos') || line.includes('amount') || line.includes('ukupno')) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = raw[headerRowIndex] || [];
  const dateIdx = findColumnIndex(headers, ['datum od', 'datum do', 'datum', 'date', 'dan']);
  const AB_COL = 27;
  const amountIdx = AB_COL;
  const qtyIdx = findColumnIndex(headers, ['prodaja kol', 'kolicina', 'quantity', 'qty', 'kol']);

  if (dateIdx < 0 && amountIdx < 0) {
    return [];
  }

  const byDate = new Map();

  for (let r = headerRowIndex + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;

    let dateVal = dateIdx >= 0 ? row[dateIdx] : null;
    if (dateVal == null || dateVal === '') continue;

    let dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = dateVal.toISOString().slice(0, 10);
    } else {
      const s = String(dateVal).trim();
      let match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) dateStr = match[0];
      else {
        match = s.match(/(\d{1,2})-(\d{2})-(\d{4})/);
        if (match) dateStr = `${match[3]}-${match[2]}-${match[1].padStart(2, '0')}`;
        else {
          match = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (match) dateStr = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
          else continue;
        }
      }
    }

    const amount = amountIdx >= 0 ? (Number(row[amountIdx]) || 0) : 0;
    const quantity = qtyIdx >= 0 ? (Number(row[qtyIdx]) || 0) : 0;

    if (!byDate.has(dateStr)) byDate.set(dateStr, { date: dateStr, amount: 0, quantity: 0 });
    const rec = byDate.get(dateStr);
    rec.amount += amount;
    rec.quantity += quantity;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Parsira retail Excel sa detaljima po brendu.
 * Vraća [{ date, brand, amount, quantity }, ...].
 * Ako nema kolone brend/brand, koristi "Svi".
 */
function parseRetailExcelToDailyByBrand(filePath) {
  const wb = XLSX.readFile(filePath, { sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const line = (raw[r] || []).join(' ').toLowerCase();
    if (line.includes('datum') || line.includes('date') || line.includes('iznos') || line.includes('amount') || line.includes('ukupno') || line.includes('brend') || line.includes('brand')) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = raw[headerRowIndex] || [];
  const dateIdx = findColumnIndex(headers, ['datum od', 'datum do', 'datum', 'date', 'dan']);
  const brandIdx = findColumnIndex(headers, ['brend', 'brand', 'marka', 'proizvodjac', 'manufacturer']);
  const AB_COL = 27;
  const amountIdx = AB_COL;
  const qtyIdx = findColumnIndex(headers, ['prodaja kol', 'kolicina', 'quantity', 'qty', 'kol']);

  const byDateBrand = new Map();

  for (let r = headerRowIndex + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;

    let dateVal = dateIdx >= 0 ? row[dateIdx] : null;
    if (dateVal == null || dateVal === '') continue;

    let dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = dateVal.toISOString().slice(0, 10);
    } else {
      const s = String(dateVal).trim();
      let match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) dateStr = match[0];
      else {
        match = s.match(/(\d{1,2})-(\d{2})-(\d{4})/);
        if (match) dateStr = `${match[3]}-${match[2]}-${match[1].padStart(2, '0')}`;
        else {
          match = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (match) dateStr = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
          else continue;
        }
      }
    }

    const brand = brandIdx >= 0 ? String(row[brandIdx] || '').trim() || 'Nepoznato' : 'Svi';
    const amount = amountIdx >= 0 ? (Number(row[amountIdx]) || 0) : 0;
    const quantity = qtyIdx >= 0 ? (Number(row[qtyIdx]) || 0) : 0;

    const key = `${dateStr}|${brand}`;
    if (!byDateBrand.has(key)) byDateBrand.set(key, { date: dateStr, brand, amount: 0, quantity: 0 });
    const rec = byDateBrand.get(key);
    rec.amount += amount;
    rec.quantity += quantity;
  }

  return Array.from(byDateBrand.values()).sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.brand.localeCompare(b.brand);
  });
}

/**
 * Parsira retail Excel sa detaljima po regiji.
 * Vraća [{ date, region, amount, quantity }, ...].
 * Traži kolonu: regija, region, poslovnica, objekat, prodajno mjesto, prodavnica.
 * Koristi isti header red kao byBrand (datum/iznos) radi konzistentnosti.
 */
function parseRetailExcelToDailyByRegion(filePath) {
  const wb = XLSX.readFile(filePath, { sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const line = (raw[r] || []).join(' ').toLowerCase();
    if (line.includes('datum') || line.includes('date') || line.includes('iznos') || line.includes('amount') || line.includes('ukupno')) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = raw[headerRowIndex] || [];
  const dateIdx = findColumnIndex(headers, ['datum od', 'datum do', 'datum', 'date', 'dan']);
  const regionCol = findColumnIndex(headers, ['regija', 'region', 'poslovnica', 'objekat', 'shop', 'store', 'prodajno mjesto', 'prodavnica', 'lokacija', 'prodajna jedinica']);
  const regionIdx = regionCol >= 0 ? regionCol : 21; // kolona V ako nije pronađena po imenu
  const amtCol = findColumnIndex(headers, ['iznos', 'amount', 'ukupno', 'prodaja iznos']);
  const amountIdx = amtCol >= 0 ? amtCol : 27;
  const qtyIdx = findColumnIndex(headers, ['prodaja kol', 'kolicina', 'quantity', 'qty', 'kol']);

  const byDateRegion = new Map();

  for (let r = headerRowIndex + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;

    let dateVal = dateIdx >= 0 ? row[dateIdx] : null;
    if (dateVal == null || dateVal === '') continue;

    let dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = dateVal.toISOString().slice(0, 10);
    } else {
      const s = String(dateVal).trim();
      let match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) dateStr = match[0];
      else {
        match = s.match(/(\d{1,2})-(\d{2})-(\d{4})/);
        if (match) dateStr = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        else {
          match = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (match) dateStr = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
          else continue;
        }
      }
    }

    const region = regionIdx >= 0 ? String(row[regionIdx] || '').trim() || 'Nepoznato' : 'Svi';
    const amount = amountIdx >= 0 ? (Number(row[amountIdx]) || 0) : 0;
    const quantity = qtyIdx >= 0 ? (Number(row[qtyIdx]) || 0) : 0;

    const key = `${dateStr}|${region}`;
    if (!byDateRegion.has(key)) byDateRegion.set(key, { date: dateStr, region, amount: 0, quantity: 0 });
    const rec = byDateRegion.get(key);
    rec.amount += amount;
    rec.quantity += quantity;
  }

  return Array.from(byDateRegion.values()).sort((a, b) => a.date.localeCompare(b.date) || a.region.localeCompare(b.region));
}

/**
 * Ispisuje header red iz Excel-a (za debug — vidjeti koje kolone postoje).
 */
function dumpHeaders(filePath) {
  const wb = XLSX.readFile(filePath, { sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = raw[0] || [];
  return headers.map((h, i) => `${i}: ${h}`).join('\n');
}

module.exports = { parseRetailExcelToDaily, parseRetailExcelToDailyByBrand, parseRetailExcelToDailyByRegion, dumpHeaders };
