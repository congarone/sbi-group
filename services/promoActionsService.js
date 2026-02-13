/**
 * Servis za akcije 2026: učitava grupe iz Excel-a (interne, januar, februar),
 * filtrira po nazivu grupe i generiše Excel sa razmacima između grupa.
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

let appConfig = {};
try {
  appConfig = require('../config.json');
} catch (_) {}

const AKCIJE_2026 = path.join(__dirname, '..', appConfig.promoHistoryPath2026 || 'akcije 2026');

/**
 * Parsira Excel akcije i grupiše po praznim redovima.
 * Vraća: [{ groupName, articles: [{ naziv, barcode, osnovnaCijena, rabatPct, period }] }]
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
        const groupName = firstNaziv.split(' ').slice(0, 2).join(' ') || 'Grupa';
        groups.push({ groupName, articles: currentGroup });
        currentGroup = [];
      }
      continue;
    }

    const rabatVal = row[idx.rabat];
    const rabatPct = typeof rabatVal === 'number' ? rabatVal * 100 : (parseFloat(rabatVal) || 0) * 100;

    currentGroup.push({
      naziv,
      barcode: String(row[idx.barcode] ?? ''),
      osnovnaCijena: Number(row[idx.osnovna]) || 0,
      rabatPct: rabatPct || 0,
      period: (row[idx.period] ?? '').toString(),
    });
  }
  if (currentGroup.length > 0) {
    const firstNaziv = currentGroup[0].naziv;
    const groupName = firstNaziv.split(' ').slice(0, 2).join(' ') || 'Grupa';
    groups.push({ groupName, articles: currentGroup });
  }

  return groups;
}

/**
 * Nalazi sve Excel fajlove u akcije 2026.
 */
function findAkcijaFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...findAkcijaFiles(full));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.xlsx') && !e.name.startsWith('~$')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Učitava sve grupe iz akcije 2026 (interne januar, interne februar, itd.).
 */
function loadAllGroups2026() {
  const files = findAkcijaFiles(AKCIJE_2026);
  const allGroups = [];
  for (const f of files) {
    try {
      const groups = parseAkcijaExcelGrouped(f);
      const source = path.basename(f, '.xlsx');
      for (const g of groups) {
        allGroups.push({ ...g, source });
      }
    } catch (e) {
      console.warn('Greška pri čitanju', f, e.message);
    }
  }
  return allGroups;
}

/**
 * Filtrira grupe po ključnoj riječi (npr. "Riscossa", "interne").
 */
function filterGroupsByKeyword(groups, keyword) {
  const k = (keyword || '').toLowerCase();
  if (!k) return groups;
  return groups.filter(g =>
    g.groupName.toLowerCase().includes(k) ||
    g.articles.some(a => a.naziv.toLowerCase().includes(k))
  );
}

/**
 * Kreira Excel akcije sa razmacima između grupa.
 */
async function createAkcijaExcel(groups, outputPath, periodText) {
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
      const period = periodText || a.period;

      ws.getRow(rowNum).values = [
        null, i + 1, a.naziv, a.barcode, a.osnovnaCijena, 0.08, rabatDec,
        netoCijena, 0.05, 0.21, akcijskaMPC, period
      ];
      rowNum++;
    }
    ws.getRow(rowNum).values = [null, '', '', '', '', '', '', '', '', '', ''];
    rowNum++;
  }

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!outputPath) {
    const now = new Date();
    outputPath = path.join(outDir, `Akcija-${now.getDate().toString().padStart(2,'0')}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getFullYear()}.xlsx`);
  }
  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

/**
 * "Stavi" akciju: korisnik kaže šta da stavi (npr. "Riscossa", "sve interne").
 * Vraća putanju do generisanog Excel-a ili poruku.
 */
async function staviAkciju(userInput) {
  const groups = loadAllGroups2026();
  if (groups.length === 0) {
    return { ok: false, message: 'Nema akcija u akcije 2026. Dodaj interne januar/februar.' };
  }

  const msg = (userInput || '').toLowerCase();
  let filtered = groups;

  if (msg.includes('riscossa') || msg.includes('pasta')) {
    filtered = filterGroupsByKeyword(groups, 'Riscossa');
  } else if (msg.includes('napolitanke') || msg.includes('happy')) {
    filtered = filterGroupsByKeyword(groups, 'Napolitanke');
  } else if (msg.includes('proteinski') || msg.includes('active')) {
    filtered = filterGroupsByKeyword(groups, 'Proteinski');
  } else if (msg.includes('ovsena') || msg.includes('my life')) {
    filtered = filterGroupsByKeyword(groups, 'Ovsena');
  } else if (msg.includes('deleco') || msg.includes('tursij')) {
    filtered = filterGroupsByKeyword(groups, 'Deleco');
  } else if (msg.includes('sve') || msg.includes('sve interne') || msg.includes('sve grupe')) {
    filtered = groups;
  } else {
    const words = msg.split(/\s+/).filter(w => w.length > 2);
    for (const w of words) {
      if (['stavi', 'akciju', 'za', 'interne', 'februar', 'januar'].includes(w)) continue;
      filtered = filterGroupsByKeyword(groups, w);
      if (filtered.length > 0) break;
    }
  }

  if (filtered.length === 0) {
    return { ok: false, message: `Nisam pronašao grupu za "${userInput}". Probaj: Riscossa, Napolitanke, Proteinski, "sve interne".` };
  }

  const periodText = msg.match(/(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})/);
  const period = periodText ? `${periodText[1].padStart(2,'0')}.${periodText[2].padStart(2,'0')}.-${periodText[3].padStart(2,'0')}.${periodText[4].padStart(2,'0')}.` : null;

  const outPath = await createAkcijaExcel(filtered, null, period);
  const totalArtikala = filtered.reduce((s, g) => s + g.articles.length, 0);
  return {
    ok: true,
    message: `Spremljeno: ${path.basename(outPath)}. ${filtered.length} grupa(e), ${totalArtikala} artikala.`,
    outputPath: outPath,
  };
}

module.exports = {
  parseAkcijaExcelGrouped,
  loadAllGroups2026,
  filterGroupsByKeyword,
  createAkcijaExcel,
  staviAkciju,
};
