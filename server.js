/**
 * Express server za AI Promotions sistem.
 * Servira API i statički frontend.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const api = require('./routes/api');
const db = require('./services/database');
const retailFetcher = require('./services/retailFetcher');
const retailExcelParser = require('./services/retailExcelParser');

const app = express();
const PORT = process.env.PORT || 3000;
const retailConfigPath = path.join(__dirname, 'retail.source.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Provjera da li je pravi server (frontend može prikazati upozorenje ako nije)
app.get('/api/ping', (req, res) => res.json({ ok: true, msg: 'SBI Group server' }));

// Retail GET rute direktno na app da uvijek vraćaju JSON (izbjegava 404/HTML)
app.get('/api/retail-config', (req, res) => {
  try {
    const DEFAULT_USERNAME = 'ivan.djukanovic1@gmail.com';
    let config = {
      username: DEFAULT_USERNAME,
      password: '',
      loginUrl: 'https://portal.idea-mlink.me/#!/',
      reportUrl: 'https://portal.idea-mlink.me/#!/mysales',
    };
    if (fs.existsSync(retailConfigPath)) {
      const raw = JSON.parse(fs.readFileSync(retailConfigPath, 'utf8'));
      config = { ...config, ...raw, password: raw.password ? '••••••••' : '' };
    } else {
      config.password = '••••••••';
    }
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/retail-analysis-by-region', async (req, res) => {
  try {
    const now = new Date();
    const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const toDate = now.toISOString().slice(0, 10);
    let rows = await db.getRetailByRegion(fromDate, toDate);
    if (rows.length === 0) {
      const dailyRows = await db.getRetailDateRange(fromDate, toDate);
      const totalAmount = dailyRows.reduce((s, r) => s + (r.amount || 0), 0);
      if (totalAmount > 0) {
        rows = [{ region: 'Svi', totalAmount, totalQuantity: dailyRows.reduce((s, r) => s + (r.quantity || 0), 0), dayCount: dailyRows.length }];
      }
    }
    const totalAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    res.json({ ok: true, data: rows, totalAmount, fromDate, toDate });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/retail-analysis-by-brand', async (req, res) => {
  try {
    const now = new Date();
    const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const toDate = now.toISOString().slice(0, 10);
    const rows = await db.getRetailByBrand(fromDate, toDate);
    const totalAmount = rows.reduce((s, r) => s + (r.totalAmount || 0), 0);
    res.json({ ok: true, data: rows, totalAmount, fromDate, toDate });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/retail-analysis', async (req, res) => {
  try {
    const now = new Date();
    const fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const toDate = now.toISOString().slice(0, 10);
    const rows = await db.getRetailDateRange(fromDate, toDate);
    const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const totalQty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    res.json({
      ok: true,
      data: rows,
      totalAmount,
      totalQuantity: totalQty,
      dayCount: rows.length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/retail-turnover-summary', async (req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const yesterdayRow = await db.getRetailDay(yesterdayStr);
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());
    const days = summary.days || [];
    const lastDay = days.length > 0 ? days[days.length - 1] : null;
    res.json({
      ok: true,
      yesterdayAmount: yesterdayRow ? (yesterdayRow.amount || 0) : 0,
      yesterdayDate: yesterdayStr,
      lastRecordedAmount: lastDay ? (lastDay.amount || 0) : 0,
      lastRecordedDate: lastDay ? lastDay.date : null,
      thisMonthTotal: summary.totalAmount,
      thisMonthQuantity: summary.totalQuantity,
      dayCount: summary.dayCount,
      days: summary.days,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Ručno postavi jedan dan retail prometa (npr. jučer 5704.44) — za test ili kad auto-fetch ne uspije
app.post('/api/retail-set-day', express.json(), async (req, res) => {
  try {
    let { date, amount, quantity } = req.body || {};
    if (!date) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      date = d.toISOString().slice(0, 10);
    }
    amount = Number(amount) || 0;
    quantity = Number(quantity) || 0;
    await db.upsertRetailDay(date, amount, quantity);
    const now = new Date();
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());
    res.json({ ok: true, date, amount, quantity, thisMonthTotal: summary.totalAmount, dayCount: summary.dayCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Obriši sve retail dane i ostavi samo jedan (npr. jučer 5704.44)
app.post('/api/retail-clear', express.json(), async (req, res) => {
  try {
    await db.clearRetailDays();
    const keep = req.body && req.body.keep;
    if (keep && keep.date) {
      await db.upsertRetailDay(keep.date, Number(keep.amount) || 0, Number(keep.quantity) || 0);
    }
    const now = new Date();
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());
    res.json({ ok: true, thisMonthTotal: summary.totalAmount, dayCount: summary.dayCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Postavi više dana odjednom (npr. cijeli februar)
app.post('/api/retail-set-days', express.json(), async (req, res) => {
  try {
    const days = req.body && req.body.days;
    if (!Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ ok: false, error: 'Pošalji body: { "days": [ {"date":"YYYY-MM-DD", "amount": 123}, ... ] }' });
    }
    for (const row of days) {
      const date = row.date;
      const amount = Number(row.amount) || 0;
      const quantity = Number(row.quantity) || 0;
      if (date) await db.upsertRetailDay(date, amount, quantity);
    }
    const now = new Date();
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());
    res.json({ ok: true, saved: days.length, thisMonthTotal: summary.totalAmount, dayCount: summary.dayCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// SQL pomoć — rute direktno na app da uvijek odgovore
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
}
if (api.sqlHandlers) {
  app.options('/api/sql-test', (_, res) => res.sendStatus(204));
  app.post('/api/sql-test', wrap(api.sqlHandlers.sqlTest));
  app.options('/api/sql-databases', (_, res) => res.sendStatus(204));
  app.post('/api/sql-databases', wrap(api.sqlHandlers.sqlDatabases));
  app.options('/api/sql-tables', (_, res) => res.sendStatus(204));
  app.post('/api/sql-tables', wrap(api.sqlHandlers.sqlTables));
  app.options('/api/sql-columns', (_, res) => res.sendStatus(204));
  app.post('/api/sql-columns', wrap(api.sqlHandlers.sqlColumns));
  app.options('/api/sql-save-mapping', (_, res) => res.sendStatus(204));
  app.post('/api/sql-save-mapping', wrap(api.sqlHandlers.sqlSaveMapping));
}

app.use('/api', api);

// Ako neko zatraži /api/... a ruta ne postoji, vrati JSON (da frontend ne dobije HTML)
app.use('/api', (req, res, next) => {
  res.status(404).json({ ok: false, error: 'Ruta nije pronađena: ' + req.method + ' ' + req.path });
});

// Statički fajlovi (frontend)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Za sve API zahtjeve: greške vraćaj kao JSON (nikad HTML)
app.use((err, req, res, next) => {
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    res.status(500).json({ ok: false, error: err.message || 'Greška servera' });
    return;
  }
  next(err);
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`SBI Group server: http://0.0.0.0:${PORT}`);
});

// Automatsko preuzimanje jučerašnjeg prometa svaki dan u 7:00 (preskoči na Renderu — Puppeteer ne radi na free tier)
let lastFetchDate = null;
function runScheduledRetailFetch() {
  if (process.env.RENDER) return; // Render free tier nema Puppeteer
  const now = new Date();
  if (now.getHours() !== 7 || now.getMinutes() > 1) return;
  const today = now.toISOString().slice(0, 10);
  if (lastFetchDate === today) return;
  lastFetchDate = today;
  retailFetcher.fetchRetailExcel({ mode: 'day' }).then(async (result) => {
    if (!result.ok) {
      console.log('[7h] Retail fetch nije uspio:', result.error);
      return;
    }
    const daily = retailExcelParser.parseRetailExcelToDaily(result.path);
    const byBrand = retailExcelParser.parseRetailExcelToDailyByBrand(result.path);
    const byRegion = retailExcelParser.parseRetailExcelToDailyByRegion(result.path);
    for (const d of daily) await db.upsertRetailDay(d.date, d.amount, d.quantity);
    for (const b of byBrand) await db.upsertRetailByBrand(b.date, b.brand, b.amount, b.quantity);
    for (const r of byRegion) await db.upsertRetailByRegion(r.date, r.region, r.amount, r.quantity);
    console.log('[7h] Jučerašnji promet preuzet:', daily[0]?.amount ?? 0, '€');
  }).catch((e) => console.log('[7h] Retail fetch greška:', e.message));
}
setInterval(runScheduledRetailFetch, 60 * 1000);
runScheduledRetailFetch();
