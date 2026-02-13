/**
 * API rute za AI Promotions: dnevni promet, padovi, preporuke, import istorije, generisanje Excel-a.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sql = require('mssql');

const { loadAndValidateMapping } = require('../services/dbMapping');
const sqlServer = require('../services/sqlServer');
const promoHistoryParser = require('../services/promoHistoryParser');
const db = require('../services/database');
const elasticityEngine = require('../services/elasticityEngine');
const recommendationEngine = require('../services/recommendationEngine');
const excelGenerator = require('../services/excelGenerator');
const retailFetcher = require('../services/retailFetcher');
const retailExcelParser = require('../services/retailExcelParser');
const chatbotService = require('../services/chatbotService');

const retailConfigPath = path.join(__dirname, '..', 'retail.source.json');

// Učitaj config (bez obaveznog db.mapping za rute koje ne koriste SQL)
let appConfig = {};
try {
  appConfig = require('../config.json');
} catch (_) {}

const uploadDir = path.join(__dirname, '..', 'uploads');
const outputDir = path.join(__dirname, '..', 'output');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, 'promo_template_' + Date.now() + path.extname(file.originalname) || '.xlsx'),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Helper: dohvat dnevne prodaje iz SQL-a. Ako SQL nije konfigurisan ili padne, vraća prazan niz.
 */
async function getDailySalesSafe(fromDate, toDate) {
  try {
    loadAndValidateMapping();
    const rows = await sqlServer.getDailySales({ fromDate, toDate });
    return rows;
  } catch (e) {
    console.warn('SQL Server nije dostupan ili mapping nedostaje:', e.message);
    return [];
  }
}

// ---------- Dnevni promet (zadnjih 30 dana) ----------
router.get('/daily-turnover', async (req, res) => {
  try {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    const sales = await getDailySalesSafe(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const byDate = new Map();
    for (const row of sales) {
      const d = row.date;
      if (!byDate.has(d)) byDate.set(d, { date: d, quantity: 0, amount: 0 });
      const r = byDate.get(d);
      r.quantity += row.quantity || 0;
      r.amount += row.amount || 0;
    }
    const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ ok: true, data: daily, sqlAvailable: sales.length > 0 || (await getDailySalesSafe(null, null)).length >= 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Chatbot za dogovor oko akcija ----------
router.post('/chat', express.json(), async (req, res) => {
  try {
    const message = req.body && req.body.message;
    const reply = await chatbotService.chat(message || '');
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Top padovi (zadnjih 7 dana) ----------
router.get('/top-declines', async (req, res) => {
  try {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 14);
    const sales = await getDailySalesSafe(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const declining = recommendationEngine.detectDecliningArticles(sales, 7);
    res.json({ ok: true, data: declining.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Preporučene akcije ----------
router.get('/recommendations', async (req, res) => {
  try {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (appConfig.recommendationLookbackDays || 7));
    const sales = await getDailySalesSafe(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const recs = await recommendationEngine.generateRecommendations(sales, new Map(), appConfig);
    res.json({ ok: true, data: recs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Import istorijskih akcija ----------
router.post('/import-promo-history', async (req, res) => {
  try {
    const promoPath = appConfig.promoHistoryPath || './akcije';
    const year = appConfig.promoHistoryYear || 2025;
    const { events, errors } = promoHistoryParser.loadAllPromoHistory(promoPath, year);
    await db.clearPromotionEvents();
    await db.upsertPromotionEvents(events);
    res.json({ ok: true, imported: events.length, errors });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Pokretanje učenja elastičnosti (zahtijeva prodaju iz SQL-a) ----------
router.post('/run-elasticity-learning', async (req, res) => {
  try {
    const year = appConfig.promoHistoryYear || 2025;
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const dailySales = await getDailySalesSafe(from, to);
    const result = await elasticityEngine.runElasticityLearning(dailySales, appConfig);
    res.json({ ok: true, profilesCount: result.count, profiles: result.profiles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Upload template ----------
router.post('/upload-template', upload.single('template'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Nijedan fajl nije uploadovan.' });
  }
  res.json({ ok: true, path: req.file.path, filename: req.file.filename });
});

// ---------- Generisanje Excel akcija ----------
router.post('/generate-promo-excel', express.json(), async (req, res) => {
  try {
    const { templatePath } = req.body || {};
    let template = templatePath;
    if (!template) {
      const files = fs.readdirSync(uploadDir).filter((f) => f.toLowerCase().endsWith('.xlsx'));
      if (files.length) {
        const withTime = files.map((f) => ({
          f,
          m: fs.statSync(path.join(uploadDir, f)).mtime.getTime(),
        }));
        withTime.sort((a, b) => b.m - a.m);
        template = path.join(uploadDir, withTime[0].f);
      }
    }
    if (!template || !fs.existsSync(template)) {
      return res.status(400).json({ ok: false, error: 'Template nije pronađen. Prvo uploaduj template.' });
    }

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (appConfig.recommendationLookbackDays || 7));
    const sales = await getDailySalesSafe(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    const recommendations = await recommendationEngine.generateRecommendations(sales, new Map(), appConfig);

    const date = new Date();
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const outPath = path.join(outputDir, `Akcije ${dd}-${mm}-${yyyy}.xlsx`);

    const { outputPath, errors } = await excelGenerator.fillTemplateWithRecommendations(
      template,
      recommendations,
      new Map(),
      outPath
    );

    res.json({ ok: true, outputPath, filename: path.basename(outputPath), errors });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Download generisanog fajla ----------
router.get('/download/:filename', (req, res) => {
  const file = path.join(outputDir, req.params.filename);
  if (!fs.existsSync(file) || path.relative(outputDir, path.resolve(file)).startsWith('..')) {
    return res.status(404).json({ ok: false, error: 'Fajl nije pronađen.' });
  }
  res.download(file);
});

// ---------- Status mappinga (za UI) ----------
router.get('/db-mapping-status', (req, res) => {
  try {
    loadAndValidateMapping();
    res.json({ ok: true, configured: true });
  } catch (e) {
    res.json({ ok: true, configured: false, error: e.message });
  }
});

// ---------- Lista promotion events (broj) ----------
router.get('/promo-events-count', async (req, res) => {
  try {
    const events = await db.getPromotionEvents();
    res.json({ ok: true, count: events.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Retail: konfiguracija i preuzimanje Excel sa retail sajta ----------
const DEFAULT_RETAIL_USERNAME = 'ivan.djukanovic1@gmail.com';
const DEFAULT_RETAIL_PASSWORD = '2LPZDav3';

router.get('/retail-config', (req, res) => {
  try {
    let config = {
      username: DEFAULT_RETAIL_USERNAME,
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
    res.json({ ok: false, error: e.message });
  }
});

router.post('/retail-config', express.json(), (req, res) => {
  try {
    const { username, password } = req.body || {};
    const defaults = {
      loginUrl: 'https://portal.idea-mlink.me/#!/',
      reportUrl: 'https://portal.idea-mlink.me/#!/mysales',
      dateOption: 'yesterday',
      exportLinkText: 'Excel',
      downloadFolder: './data',
    };
    let existing = {};
    if (fs.existsSync(retailConfigPath)) {
      existing = JSON.parse(fs.readFileSync(retailConfigPath, 'utf8'));
    }
    const config = {
      _comment: existing._comment || 'Podešavanja za automatsko preuzimanje Excel prometa.',
      loginUrl: existing.loginUrl || defaults.loginUrl,
      reportUrl: existing.reportUrl || defaults.reportUrl,
      username: username != null ? String(username).trim() : (existing.username || ''),
      password: (password && password !== '••••••••') ? String(password) : (existing.password || ''),
      dateOption: existing.dateOption || defaults.dateOption,
      exportLinkText: existing.exportLinkText || defaults.exportLinkText,
      downloadFolder: existing.downloadFolder || defaults.downloadFolder,
    };
    fs.writeFileSync(retailConfigPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/retail-fetch', async (req, res) => {
  try {
    const daysInDb = await db.getRetailDaysCount();
    const isFirstMonth = daysInDb === 0;
    const mode = (req.body && req.body.mode) || (isFirstMonth ? 'month' : 'day');
    const date = req.body && req.body.date;

    const result = await retailFetcher.fetchRetailExcel({ mode, date });
    if (!result.ok) {
      return res.json({ ok: false, error: result.error });
    }

    let daily = retailExcelParser.parseRetailExcelToDaily(result.path);
    const byBrand = retailExcelParser.parseRetailExcelToDailyByBrand(result.path);
    const byRegion = retailExcelParser.parseRetailExcelToDailyByRegion(result.path);
    for (const b of byBrand) await db.upsertRetailByBrand(b.date, b.brand, b.amount, b.quantity);
    for (const r of byRegion) await db.upsertRetailByRegion(r.date, r.region, r.amount, r.quantity);
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

    for (const day of daily) {
      await db.upsertRetailDay(day.date, day.amount, day.quantity);
    }

    const now = new Date();
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());

    res.json({
      ok: true,
      filename: result.filename,
      mode,
      savedDays: daily.length,
      thisMonthTotal: summary.totalAmount,
      thisMonthDays: summary.dayCount,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e) });
  }
});

router.get('/retail-turnover-summary', async (req, res) => {
  try {
    const now = new Date();
    const summary = await db.getRetailMonthSummary(now.getMonth() + 1, now.getFullYear());
    res.json({
      ok: true,
      thisMonthTotal: summary.totalAmount,
      thisMonthQuantity: summary.totalQuantity,
      dayCount: summary.dayCount,
      days: summary.days,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Pomoć za SQL: test povezivanja (samo server, user, password) ----------
function makeConfig(server, database, user, password) {
  return {
    server: (server && String(server).trim()) || 'localhost',
    database: (database && String(database).trim()) || 'master',
    user: user && String(user).trim(),
    password: password != null ? String(password) : '',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      instanceName: '',
      connectTimeout: 15000,
      requestTimeout: 15000,
    },
  };
}

function safeError(e) {
  return (e && (e.message || e.toString)) ? String(e.message || e.toString()) : 'Nepoznata greška';
}

async function sqlTestHandler(req, res) {
  let pool;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const server = body.server;
    const user = body.user;
    const password = body.password;
    if (!user || !password) {
      return res.status(400).json({ ok: false, error: 'Unesi korisničko ime i lozinku.' });
    }
    const config = makeConfig(server, 'master', user, password);
    pool = await sql.connect(config);
    await pool.request().query('SELECT 1 AS test');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false, error: safeError(e) });
  } finally {
    if (pool) try { await pool.close(); } catch (_) {}
  }
}

async function sqlDatabasesHandler(req, res) {
  let pool;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { server, user, password } = body;
    if (!user || !password) {
      return res.status(400).json({ ok: false, error: 'Unesi korisničko ime i lozinku.' });
    }
    const config = makeConfig(server, 'master', user, password);
    pool = await sql.connect(config);
    const result = await pool.request().query("SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') ORDER BY name");
    const databases = (result.recordset || []).map((r) => r.name);
    return res.json({ ok: true, databases });
  } catch (e) {
    return res.status(200).json({ ok: false, error: safeError(e) });
  } finally {
    if (pool) try { await pool.close(); } catch (_) {}
  }
}

async function sqlTablesHandler(req, res) {
  let pool;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { server, user, password, database } = body;
    if (!user || !password || !database) {
      return res.status(400).json({ ok: false, error: 'Unesi korisničko ime, lozinku i odaberi bazu.' });
    }
    const config = makeConfig(server, database, user, password);
    pool = await sql.connect(config);
    const result = await pool.request().query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const tables = (result.recordset || []).map((r) => r.TABLE_NAME);
    return res.json({ ok: true, tables });
  } catch (e) {
    return res.status(200).json({ ok: false, error: safeError(e) });
  } finally {
    if (pool) try { await pool.close(); } catch (_) {}
  }
}

async function sqlColumnsHandler(req, res) {
  let pool;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { server, user, password, database, table } = body;
    if (!user || !password || !database || !table) {
      return res.status(400).json({ ok: false, error: 'Odaberi bazu i tabelu.' });
    }
    const config = makeConfig(server, database, user, password);
    pool = await sql.connect(config);
    const result = await pool.request()
      .input('table', sql.NVarChar, table)
      .query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table ORDER BY ORDINAL_POSITION"
      );
    const columns = (result.recordset || []).map((r) => r.COLUMN_NAME);
    return res.json({ ok: true, columns });
  } catch (e) {
    return res.status(200).json({ ok: false, error: safeError(e) });
  } finally {
    if (pool) try { await pool.close(); } catch (_) {}
  }
}

async function sqlSaveMappingHandler(req, res) {
  try {
    const { connection, sales } = req.body || {};
    if (!connection || !sales || !sales.table || !sales.dateColumn || !sales.articleCodeColumn || !sales.quantityColumn || !sales.amountColumn) {
      return res.status(400).json({ ok: false, error: 'Nedostaju obavezna polja: connection (server, database, user, password) i sales (table, dateColumn, articleCodeColumn, quantityColumn, amountColumn).' });
    }
    const mappingPath = path.join(__dirname, '..', 'db.mapping.json');
    const mapping = {
      _comment: 'Mapiraj nazive tabela i kolona iz tvog SQL Servera.',
      connection: {
        server: connection.server || 'localhost',
        database: connection.database,
        user: connection.user,
        password: connection.password,
        options: { encrypt: true, trustServerCertificate: true, instanceName: connection.instanceName || '' },
      },
      sales: {
        table: sales.table,
        dateColumn: sales.dateColumn,
        articleCodeColumn: sales.articleCodeColumn,
        articleNameColumn: sales.articleNameColumn || '',
        quantityColumn: sales.quantityColumn,
        amountColumn: sales.amountColumn,
        priceColumn: sales.priceColumn || '',
        objectColumn: sales.objectColumn || '',
        customerColumn: sales.customerColumn || '',
      },
    };
    fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

router.post('/sql-test', sqlTestHandler);
router.post('/sql-databases', sqlDatabasesHandler);
router.post('/sql-tables', sqlTablesHandler);
router.post('/sql-columns', sqlColumnsHandler);
router.post('/sql-save-mapping', sqlSaveMappingHandler);

// Izvoz handlera da server.js može registrovati rute direktno (izbjegava 404)
router.sqlHandlers = {
  sqlTest: sqlTestHandler,
  sqlDatabases: sqlDatabasesHandler,
  sqlTables: sqlTablesHandler,
  sqlColumns: sqlColumnsHandler,
  sqlSaveMapping: sqlSaveMappingHandler,
};

module.exports = router;
