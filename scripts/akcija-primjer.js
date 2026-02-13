/**
 * Primjer: kako program kombinuje sve podatke i pravi akciju.
 * - Učitava akcije 2026 (interne januar, interne februar)
 * - Grupiše artikle po praznim redovima (razmak = nova grupa)
 * - Kombinuje sa retail prometom
 * - Generiše Excel sa razmacima između grupa
 *
 * Pokretanje: node scripts/akcija-primjer.js
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const AKCIJE_2026 = path.join(__dirname, '..', 'akcije 2026');
const db = require(path.join(__dirname, '..', 'services', 'database'));

/**
 * Parsira Excel akcije i grupiše po praznim redovima.
 * Vraća: [{ groupName, articles: [{ naziv, barcode, osnovnaCijena, rabat, period }] }]
 */
function parseAkcijaExcelGrouped(filePath) {
  const wb = XLSX.readFile(filePath, { sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const headers = raw[0] || [];
  const idx = {
    naziv: headers.findIndex(h => String(h).toLowerCase().includes('naziv')),
    barcode: headers.findIndex(h => String(h).toLowerCase().includes('bar kod') || String(h).toLowerCase().includes('barcode')),
    osnovna: headers.findIndex(h => String(h).toLowerCase().includes('osnovna cijena')),
    rabat: headers.findIndex(h => String(h).toLowerCase().includes('akcijski rabat')),
    period: headers.findIndex(h => String(h).toLowerCase().includes('period')),
  };

  const groups = [];
  let currentGroup = [];

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const naziv = (row[idx.naziv] ?? '').toString().trim();
    const isEmpty = !naziv || row.every(c => c === '' || c == null);

    if (isEmpty) {
      if (currentGroup.length > 0) {
        const firstNaziv = currentGroup[0].naziv;
        const groupName = firstNaziv.split(' ')[0] || 'Grupa'; // Riscossa, Napolitanke, Proteinski...
        groups.push({ groupName, articles: currentGroup });
        currentGroup = [];
      }
      continue;
    }

    const rabatVal = row[idx.rabat];
    const rabatPct = typeof rabatVal === 'number' ? rabatVal * 100 : parseFloat(rabatVal) * 100 || 0;

    currentGroup.push({
      naziv,
      barcode: row[idx.barcode] ?? '',
      osnovnaCijena: Number(row[idx.osnovna]) || 0,
      rabatPct: rabatPct || 0,
      period: (row[idx.period] ?? '').toString(),
    });
  }
  if (currentGroup.length > 0) {
    const firstNaziv = currentGroup[0].naziv;
    const groupName = firstNaziv.split(' ')[0] || 'Grupa';
    groups.push({ groupName, articles: currentGroup });
  }

  return groups;
}

/**
 * Kreira Excel akcije sa razmacima između grupa (kao u originalu).
 */
async function createAkcijaExcel(groups, outputPath, periodText = '15.02.-21.02.') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Akcija', { views: [{ state: 'frozen', ySplit: 1 }] });

  const headers = ['R.br.', 'Naziv proizvoda', 'Bar kod', 'Osnovna cijena', 'Rabat', 'Akcijski rabat', 'Neto cijena', 'Marza', 'PDV', 'Akcijska MPC', 'Period trajanja akcije'];
  ws.getRow(1).values = [null, ...headers];

  let rowNum = 2;
  for (const group of groups) {
    for (let i = 0; i < group.articles.length; i++) {
      const a = group.articles[i];
      const rabatDec = a.rabatPct / 100;
      const netoCijena = a.osnovnaCijena * (1 - rabatDec);
      const akcijskaMPC = Math.round(netoCijena * 1.21 * 100) / 100;

      ws.getRow(rowNum).values = [
        null, i + 1, a.naziv, a.barcode, a.osnovnaCijena, 0.08, rabatDec,
        netoCijena, 0.05, 0.21, akcijskaMPC, periodText
      ];
      rowNum++;
    }
    ws.getRow(rowNum).values = [null, '', '', '', '', '', '', '', '', '', '']; // RAZMAK između grupa
    rowNum++;
  }

  if (!outputPath) {
    outputPath = path.join(__dirname, '..', 'output', 'Akcija-primjer.xlsx');
  }
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

async function run() {
  console.log('=== PRIMJER: Kako program pravi akciju ===\n');

  const interneFeb = path.join(AKCIJE_2026, 'interne', 'interne februar.xlsx');
  if (!fs.existsSync(interneFeb)) {
    console.log('Nema akcije 2026/interne/interne februar.xlsx');
    process.exit(1);
  }

  const groups = parseAkcijaExcelGrouped(interneFeb);
  console.log('1. Učitane grupe iz interne februar:');
  groups.forEach((g, i) => {
    console.log(`   Grupa ${i + 1}: ${g.groupName} — ${g.articles.length} artikala`);
    g.articles.slice(0, 2).forEach(a => console.log(`      - ${a.naziv.slice(0, 40)}... rabat ${a.rabatPct}%`));
    if (g.articles.length > 2) console.log(`      ... i još ${g.articles.length - 2}`);
  });

  const retailByBrand = db.getRetailByBrand('2026-01-01', '2026-02-13');
  console.log('\n2. Retail promet po brendu (1.1.–13.2.2026):');
  if (retailByBrand.length > 0) {
    retailByBrand.slice(0, 5).forEach(r => {
      console.log(`   ${r.brand}: ${Number(r.totalAmount).toFixed(0)} €`);
    });
  } else {
    console.log('   (Nema podataka — pokreni retail-parse-by-brand.js)');
  }

  const retailTotal = db.getRetailDateRange('2026-01-01', '2026-02-13');
  const totalAmount = retailTotal.reduce((s, r) => s + (r.amount || 0), 0);
  console.log(`   Ukupno retail: ${totalAmount.toFixed(0)} € (${retailTotal.length} dana)`);

  console.log('\n3. Generisanje Excel akcije sa razmacima između grupa...');
  const outPath = await createAkcijaExcel(groups, null, '15.02.-21.02.');
  console.log(`   Spremljeno: ${outPath}`);
  console.log('\n4. Kako chatbot radi:');
  console.log('   Ti kažeš: "Stavi interne akciju za Riscossa"');
  console.log('   Program: učitava grupu Riscossa (6 pasta), stavlja u Excel sa rabatom 23–37%');
  console.log('   Ti kažeš: "Stavi sve interne za februar"');
  console.log('   Program: sve grupe, svaka grupa odvojena praznim redom');
}

run().catch(e => { console.error(e); process.exit(1); });
