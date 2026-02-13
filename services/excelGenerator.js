/**
 * Generator Excel akcija: čita korisnikov template .xlsx, ne mijenja format,
 * samo popunjava redove predloženim akcijama. Validacija: promo cijena < regularne, nema duplikata.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

/**
 * Mapira preporuke na kolone u templateu.
 * Korisnik može imati različite nazive kolona - ovdje definišemo moguće alias-e za pronalazak kolona.
 */
const TEMPLATE_COLUMN_ALIASES = {
  articleCode: ['sifra', 'bar kod', 'barcode', 'šifra', 'kod', 'artikal'],
  articleName: ['naziv', 'naziv proizvoda', 'naziv artikla'],
  promoPrice: ['akcijska cijena', 'akcijska mpc', 'neto cijena'],
  discountPercent: ['rabat', 'akcijski rabat', 'popust %'],
  regularPrice: ['osnovna cijena', 'redovna cijena'],
};

function normalize(s) {
  if (s == null) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

/**
 * Pronađi indeks kolone u prvom redu na osnovu aliasa.
 */
function findColumnIndex(headers, key) {
  const aliases = TEMPLATE_COLUMN_ALIASES[key];
  if (!aliases) return -1;
  for (let c = 0; c < headers.length; c++) {
    const h = normalize(headers[c]);
    for (const alias of aliases) {
      if (h.includes(alias) || alias.includes(h)) return c;
    }
  }
  return -1;
}

/**
 * Čita template i vraća workbook + mapiranje kolona (header row index i indeksi kolona).
 */
async function readTemplate(templatePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Template nema nijedan sheet.');

  // Pronađi header red (prvi red sa ključnom riječi)
  let headerRowIndex = 0;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const line = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      line.push(normalize(cell.value));
    });
    const lineStr = line.join(' ');
    if (
      lineStr.includes('naziv') ||
      lineStr.includes('cijena') ||
      lineStr.includes('sifra') ||
      lineStr.includes('barcode')
    ) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = [];
  ws.getRow(headerRowIndex).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cell.value != null ? String(cell.value) : '';
  });

  const columnMap = {
    headerRowIndex,
    articleCode: findColumnIndex(headers, 'articleCode'),
    articleName: findColumnIndex(headers, 'articleName'),
    promoPrice: findColumnIndex(headers, 'promoPrice'),
    discountPercent: findColumnIndex(headers, 'discountPercent'),
    regularPrice: findColumnIndex(headers, 'regularPrice'),
  };

  if (columnMap.articleCode < 0 && columnMap.articleName < 0) {
    throw new Error('U templateu nije pronađena kolona za šifru/barcode ili naziv artikla.');
  }

  return { workbook: wb, worksheet: ws, columnMap, headers };
}

/**
 * Izračunaj akcijsku cijenu iz redovne i rabata (ako template očekuje cijenu).
 * regularPrice * (1 - discountPercent/100) = promoPrice
 */
function computePromoPrice(regularPrice, discountPercent) {
  const r = Number(regularPrice) || 0;
  const d = Number(discountPercent) || 0;
  return Math.round(r * (1 - d / 100) * 100) / 100;
}

/**
 * Popunjava template preporukama. Ne mijenja stil, samo vrijednosti.
 * recommendations: Array<{ articleCode, articleName, suggestedDiscountPercent, ... }>
 * regularPrices: Map<articleCode, number> - opciono, ako nemamo uzimamo 0 i ne validiramo
 */
async function fillTemplateWithRecommendations(
  templatePath,
  recommendations,
  regularPrices = new Map(),
  outputPath
) {
  const { workbook, worksheet, columnMap } = await readTemplate(templatePath);
  const startRow = columnMap.headerRowIndex + 1;
  const seen = new Set();
  const errors = [];

  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    const rowIndex = startRow + i;
    const articleKey = rec.articleCode || rec.articleName;
    if (seen.has(articleKey)) {
      errors.push(`Duplikat artikla preskočen: ${articleKey}`);
      continue;
    }
    seen.add(articleKey);

    const regularPrice = regularPrices.get(rec.articleCode) ?? rec.regularPrice ?? 0;
    const discount = rec.suggestedDiscountPercent ?? 0;
    const promoPrice = computePromoPrice(regularPrice, discount);

    if (regularPrice > 0 && promoPrice >= regularPrice) {
      errors.push(`Artikal ${articleKey}: akcijska cijena mora biti manja od redovne. Preskočen.`);
      continue;
    }

    const row = worksheet.getRow(rowIndex);
    if (columnMap.articleCode >= 0) row.getCell(columnMap.articleCode + 1).value = rec.articleCode;
    if (columnMap.articleName >= 0) row.getCell(columnMap.articleName + 1).value = rec.articleName;
    if (columnMap.promoPrice >= 0) row.getCell(columnMap.promoPrice + 1).value = promoPrice;
    // Rabat: u Excelu često 0–1 (npr. 0.15 = 15%), pa upisujemo decimal
    if (columnMap.discountPercent >= 0) row.getCell(columnMap.discountPercent + 1).value = discount / 100;
    if (columnMap.regularPrice >= 0) row.getCell(columnMap.regularPrice + 1).value = regularPrice;
  }

  if (!outputPath) {
    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const outDir = path.join(path.dirname(templatePath), '..', 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    outputPath = path.join(outDir, `Akcije ${dd}-${mm}-${yyyy}.xlsx`);
  }

  await workbook.xlsx.writeFile(outputPath);
  return { outputPath, errors };
}

module.exports = {
  readTemplate,
  fillTemplateWithRecommendations,
  computePromoPrice,
  TEMPLATE_COLUMN_ALIASES,
};
