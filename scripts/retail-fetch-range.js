/**
 * Preuzima retail Excel za radne dane u rasponu (npr. 1.1.–13.2.).
 * Preskače nedjelje i praznike (CG) — prodavnice ne rade.
 * Pokreni: node scripts/retail-fetch-range.js [od] [do]
 * Primjer: node scripts/retail-fetch-range.js 1.1.2026 13.2.2026
 */
const path = require('path');
const retailFetcher = require(path.join(__dirname, '..', 'services', 'retailFetcher'));
const retailExcelParser = require(path.join(__dirname, '..', 'services', 'retailExcelParser'));
const db = require(path.join(__dirname, '..', 'services', 'database'));

/** Praznici CG (MM-DD) — fiksni. Vaskrs se dodaje posebno. */
const CG_HOLIDAYS_MMDD = [
  '01-01', '01-06', '01-07',
  '05-01', '05-21', '07-13', '09-20', '11-13',
];
const EASTER_2026 = '2026-04-05';
const EASTER_2026_2 = '2026-04-06';
const ORTHODOX_EASTER_2026 = '2026-04-12';
const ORTHODOX_EASTER_2026_2 = '2026-04-13';

function isWorkingDayCG(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getDay() === 0) return false;
  const mmdd = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (CG_HOLIDAYS_MMDD.includes(mmdd)) return false;
  if ([EASTER_2026, EASTER_2026_2, ORTHODOX_EASTER_2026, ORTHODOX_EASTER_2026_2].includes(dateStr)) return false;
  return true;
}

function parseDate(str) {
  const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/) || str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  if (str.includes('-')) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
}

function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function* dateRange(from, to) {
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur <= end) {
    yield toIso(cur);
    cur.setDate(cur.getDate() + 1);
  }
}

async function run() {
  const year = new Date().getFullYear();
  let fromStr = process.argv[2] || `1.1.${year}`;
  let toStr = process.argv[3] || toIso(new Date());

  const from = parseDate(fromStr);
  const to = parseDate(toStr);
  if (!from || !to || from > to) {
    console.log('Upotreba: node scripts/retail-fetch-range.js [od] [do]');
    console.log('Primjer: node scripts/retail-fetch-range.js 1.1.2026 13.2.2026');
    process.exit(1);
  }

  const allDays = [...dateRange(from, to)];
  const days = allDays.filter(isWorkingDayCG);
  const skipped = allDays.length - days.length;
  console.log(`Preuzimam ${days.length} radnih dana (preskočeno ${skipped}: nedjelje + praznici): ${fromStr} – ${toStr}`);
  console.log('');

  const BATCH = 5;
  let ok = 0, fail = 0;
  for (let b = 0; b < days.length; b += BATCH) {
    const batch = days.slice(b, b + BATCH);
    const results = await Promise.all(
      batch.map(async (date) => {
        try {
          const result = await retailFetcher.fetchRetailExcel({ date });
          if (result.ok) {
            const daily = retailExcelParser.parseRetailExcelToDaily(result.path);
            for (const d of daily) {
              db.upsertRetailDay(d.date, d.amount, d.quantity);
            }
            const byBrand = retailExcelParser.parseRetailExcelToDailyByBrand(result.path);
            const byRegion = retailExcelParser.parseRetailExcelToDailyByRegion(result.path);
            for (const b of byBrand) db.upsertRetailByBrand(b.date, b.brand, b.amount, b.quantity);
            for (const r of byRegion) db.upsertRetailByRegion(r.date, r.region, r.amount, r.quantity);
            return { ok: true, date, amount: daily[0]?.amount ?? 0 };
          }
          return { ok: false, date, error: result.error };
        } catch (e) {
          return { ok: false, date, error: e.message };
        }
      })
    );
    results.forEach((r, idx) => {
      const ddmm = r.date.split('-').reverse().join('.');
      const n = b + idx + 1;
      if (r.ok) {
        console.log(`[${n}/${days.length}] ${ddmm} OK (${r.amount.toFixed(0)} €)`);
        ok++;
      } else {
        console.log(`[${n}/${days.length}] ${ddmm} GREŠKA: ${r.error}`);
        fail++;
      }
    });
    if (b + BATCH < days.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const summary = db.getRetailMonthSummary(to.getMonth() + 1, to.getFullYear());
  console.log('');
  console.log(`Završeno: ${ok} OK, ${fail} grešaka`);
  console.log(`Ukupno u bazi: ${summary.totalAmount.toFixed(2)} € (${summary.dayCount} dana)`);
}

run().catch((e) => {
  console.error('GREŠKA:', e.message);
  process.exit(1);
});
