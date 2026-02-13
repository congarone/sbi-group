/**
 * Import istorijskih akcija iz Excel fajlova.
 * Rekurzivno učitava sve .xlsx iz foldera (npr. akcije ili promo_history_2025).
 * Fleksibilan parser: automatski detektuje header red i pronalazi kolone po različitim nazivima.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Mogući nazivi kolona za mapiranje (case-insensitive, bez dijakritika za upoređivanje)
const COLUMN_ALIASES = {
  articleCode: ['sifra', 'barcode', 'bar kod', 'šifra', 'artikal', 'ean', 'kod'],
  articleName: ['naziv', 'naziv proizvoda', 'naziv artikla', 'proizvod', 'artikal naziv'],
  promoPrice: ['akcijska cijena', 'akcijska mpc', 'akcijska mpc cijena', 'neto cijena', 'cijena akcija'],
  discountPercent: ['akcijski rabat', 'rabat %', 'popust', 'rabat'],
  periodStart: ['datum početka', 'početak', 'start', 'od'],
  periodEnd: ['datum kraja', 'kraj', 'end', 'do'],
  periodText: ['period trajanja akcije', 'period', 'trajanje', 'period akcije'],
  basePrice: ['osnovna cijena', 'osnovna cijena', 'regularna cijena'],
};

const DEFAULT_YEAR = 2025;

/**
 * Normalizuje string za upoređivanje (lowercase, uklanja dijakritike).
 */
function normalizeHeader(str) {
  if (str == null) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

/**
 * Pronalazi indeks kolone u header redu na osnovu aliasa.
 */
function findColumnIndex(headers, key) {
  const normalizedHeaders = headers.map((h, i) => ({ n: normalizeHeader(h), i }));
  const aliases = COLUMN_ALIASES[key];
  if (!aliases) return -1;
  for (const alias of aliases) {
    const found = normalizedHeaders.find(({ n }) => n.includes(alias) || alias.includes(n));
    if (found) return found.i;
  }
  return -1;
}

/**
 * Parsira period iz teksta (npr. "09.01 - 15.01", "03.10.-10.10.", "01.01 - 31.01").
 * Vraća { startDate, endDate } u YYYY-MM-DD, godina iz yearParam.
 */
function parsePeriodText(text, year = DEFAULT_YEAR) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  // Formati: DD.MM - DD.MM  ili  DD.MM.-DD.MM.  ili  DD.MM - DD.MM.
  const match = cleaned.match(
    /(\d{1,2})\.\s*(\d{1,2})\s*[.\s\-]+\s*(\d{1,2})\.\s*(\d{1,2})/
  );
  if (!match) return null;
  const [, d1, m1, d2, m2] = match;
  const startDate = new Date(year, parseInt(m1, 10) - 1, parseInt(d1, 10));
  const endDate = new Date(year, parseInt(m2, 10) - 1, parseInt(d2, 10));
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

/**
 * Iz imena fajla pokušava izvući period (npr. "Redovna 09.01 - 15.01.xlsx" -> 09.01-15.01).
 * Koristi se kao fallback ako u sheetu nema perioda.
 */
function parsePeriodFromFileName(fileName, year = DEFAULT_YEAR) {
  const match = fileName.match(/(\d{1,2})\.\s*(\d{1,2})\s*[.\-\s]+\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!match) return null;
  const [, d1, m1, d2, m2] = match;
  const startDate = new Date(year, parseInt(m1, 10) - 1, parseInt(d1, 10));
  const endDate = new Date(year, parseInt(m2, 10) - 1, parseInt(d2, 10));
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

/**
 * Jedan Excel fajl -> niz promotion event redova.
 */
function parseOneFile(filePath, options = {}) {
  const year = options.year ?? DEFAULT_YEAR;
  const sourceFile = path.basename(filePath);
  const dirPath = path.dirname(filePath);

  // Preskoči temp fajlove (~$...)
  if (path.basename(filePath).startsWith('~$')) return [];

  let wb;
  try {
    wb = XLSX.readFile(filePath, { sheetStubs: true });
  } catch (e) {
    return { events: [], errors: [`${filePath}: ${e.message}`] };
  }

  const events = [];
  const errors = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Automatski detekcija header reda: prvi red koji sadrži neku od ključnih riječi
    let headerRowIndex = 0;
    for (let r = 0; r < Math.min(5, raw.length); r++) {
      const row = raw[r];
      const line = (Array.isArray(row) ? row : Object.values(row)).join(' ').toLowerCase();
      if (
        line.includes('naziv') ||
        line.includes('bar kod') ||
        line.includes('barcode') ||
        line.includes('sifra') ||
        line.includes('cijena') ||
        line.includes('rabat')
      ) {
        headerRowIndex = r;
        break;
      }
    }

    const headers = raw[headerRowIndex];
    if (!Array.isArray(headers) || headers.length === 0) continue;

    const idx = {
      articleCode: findColumnIndex(headers, 'articleCode'),
      articleName: findColumnIndex(headers, 'articleName'),
      promoPrice: findColumnIndex(headers, 'promoPrice'),
      discountPercent: findColumnIndex(headers, 'discountPercent'),
      periodText: findColumnIndex(headers, 'periodText'),
      basePrice: findColumnIndex(headers, 'basePrice'),
    };

    // Minimalno moramo imati identifikator artikla i period ili cijenu
    const hasArticle = idx.articleCode >= 0 || idx.articleName >= 0;
    if (!hasArticle) continue;

    const filePeriod = parsePeriodFromFileName(path.basename(filePath), year);

    for (let r = headerRowIndex + 1; r < raw.length; r++) {
      const row = raw[r];
      if (!Array.isArray(row)) continue;

      const get = (i) => (i >= 0 && row[i] !== undefined && row[i] !== '' ? row[i] : null);
      const articleCode = idx.articleCode >= 0 ? String(get(idx.articleCode)).trim() : '';
      const articleName = idx.articleName >= 0 ? String(get(idx.articleName)).trim() : '';
      if (!articleCode && !articleName) continue;

      const artikalId = articleCode || articleName;

      let period = null;
      const periodStr = get(idx.periodText);
      if (periodStr) period = parsePeriodText(periodStr, year);
      if (!period && filePeriod) period = filePeriod;
      if (!period) continue;

      let promoPrice = null;
      if (idx.promoPrice >= 0) {
        const v = row[idx.promoPrice];
        promoPrice = typeof v === 'number' && !isNaN(v) ? v : parseFloat(v);
      }
      let discountPercent = null;
      if (idx.discountPercent >= 0) {
        const v = row[idx.discountPercent];
        const num = typeof v === 'number' && !isNaN(v) ? v : parseFloat(v);
        if (!isNaN(num)) discountPercent = num <= 1 ? num * 100 : num;
      }

      events.push({
        artikal_id: artikalId,
        start_date: period.startDate,
        end_date: period.endDate,
        promo_price: promoPrice,
        discount_percent: discountPercent,
        source_file: sourceFile,
      });
    }
  }

  return { events, errors };
}

/**
 * Rekurzivno nalazi sve .xlsx fajlove (isključujući ~$).
 */
function findXlsxFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...findXlsxFiles(full, baseDir));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.xlsx') && !e.name.startsWith('~$')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Učitava sve akcije iz foldera i vraća flat listu promotion eventova.
 */
function loadAllPromoHistory(promoHistoryPath, year = DEFAULT_YEAR) {
  const absPath = path.isAbsolute(promoHistoryPath)
    ? promoHistoryPath
    : path.join(__dirname, '..', promoHistoryPath);
  const files = findXlsxFiles(absPath);
  const allEvents = [];
  const allErrors = [];

  for (const f of files) {
    const { events, errors } = parseOneFile(f, { year });
    allEvents.push(...events);
    allErrors.push(...errors);
  }

  return { events: allEvents, errors: allErrors };
}

module.exports = {
  loadAllPromoHistory,
  parseOneFile,
  parsePeriodText,
  findXlsxFiles,
  COLUMN_ALIASES,
};
