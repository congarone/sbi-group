/**
 * Automatski login na retail sajt, postavljanje datuma (jučer/danas, mjesec, godina) i preuzimanje Excel-a.
 * Konfiguracija: retail.source.json (loginUrl, reportUrl, username, password, dateOption).
 */

const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '..', 'retail.source.json');

const DEFAULT_LOGIN_URL = 'https://portal.idea-mlink.me/#!/';
const DEFAULT_REPORT_URL = 'https://portal.idea-mlink.me/#!/mysales';
const DEFAULT_USERNAME = 'ivan.djukanovic1@gmail.com';
const DEFAULT_PASSWORD = '2LPZDav3';

function loadConfig() {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (_) {}
  }
  const username = (cfg.username && cfg.username.trim()) || DEFAULT_USERNAME;
  const password = (cfg.password && cfg.password.trim()) || DEFAULT_PASSWORD;
  return {
    loginUrl: (cfg.loginUrl && cfg.loginUrl.trim()) || DEFAULT_LOGIN_URL,
    reportUrl: (cfg.reportUrl && cfg.reportUrl.trim()) || DEFAULT_REPORT_URL,
    username,
    password,
    dateOption: cfg.dateOption || 'yesterday',
    exportLinkText: cfg.exportLinkText || 'Excel',
    downloadFolder: cfg.downloadFolder || './data',
  };
}

/** Vraća { day, month, year, dateStr } za jučer ili danas. */
function getTargetDate(dateOption) {
  const d = new Date();
  if (dateOption === 'yesterday') {
    d.setDate(d.getDate() - 1);
  }
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { day, month, year, dateStr };
}

/** Normalizuje datum u YYYY-MM-DD. Prima YYYY-MM-DD ili DD.MM.YYYY / D.M.YYYY. */
function normalizeDateStr(val) {
  if (!val || typeof val !== 'string') return null;
  const s = val.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const ddmmyyyy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/** Za "prvi mjesec": od 1. tog mjeseca do jučer. Inače samo jučer. Ako dateStr, koristi taj datum. */
function getDateRangeForMode(isFirstMonth, dateStr) {
  const norm = normalizeDateStr(dateStr);
  if (norm) {
    return { dateFrom: norm, dateTo: norm, mode: 'day' };
  }
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  if (isFirstMonth) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const fromStr = first.toISOString().slice(0, 10);
    return { dateFrom: fromStr, dateTo: yStr, mode: 'month' };
  }
  return { dateFrom: yStr, dateTo: yStr, mode: 'day' };
}

/** Pretvara YYYY-MM-DD u DD.MM.YYYY (za portale koji koriste taj format). */
function toDdMmYyyy(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Postavlja raspon datuma na stranici: od-do. Pokušava type="date" (YYYY-MM-DD) i text s DD.MM.YYYY.
 */
async function setDateRangeOnPage(page, dateFrom, dateTo) {
  const dateFromDdMm = toDdMmYyyy(dateFrom);
  const dateToDdMm = toDdMmYyyy(dateTo);
  const parts = dateTo.split('-');
  const targetDay = parseInt(parts[2], 10);
  const fromEl = await page.$('#dateFrom');
  const toEl = await page.$('#dateTo');
  if (fromEl && toEl) {
    await fromEl.click();
    await new Promise((r) => setTimeout(r, 1000));
    const clickedDay = await page.evaluate(({ day }) => {
      const cells = document.querySelectorAll('table td, .uib-datepicker td, .datepicker td, td, .day, [role="gridcell"]');
      const dayStr = String(day);
      const dayPadded = dayStr.padStart(2, '0');
      for (const el of cells) {
        const t = (el.textContent || '').trim();
        if ((t === dayStr || t === dayPadded) && el.offsetParent && !el.classList.contains('disabled') && !el.classList.contains('text-muted')) {
          el.click();
          return true;
        }
      }
      return false;
    }, { day: targetDay });
    if (clickedDay) {
      await new Promise((r) => setTimeout(r, 1500));
      await toEl.click();
      await new Promise((r) => setTimeout(r, 1000));
      const clickedDay2 = await page.evaluate(({ day }) => {
        const cells = document.querySelectorAll('table td, .uib-datepicker td, .datepicker td, td, .day, [role="gridcell"]');
        const dayStr = String(day);
        const dayPadded = dayStr.padStart(2, '0');
        for (const el of cells) {
          const t = (el.textContent || '').trim();
          if ((t === dayStr || t === dayPadded) && el.offsetParent && !el.classList.contains('disabled') && !el.classList.contains('text-muted')) {
            el.click();
            return true;
          }
        }
        return false;
      }, { day: targetDay });
      if (clickedDay2) {
        await new Promise((r) => setTimeout(r, 1500));
        await page.evaluate(() => {
          const label = document.querySelector('label, h1, h2, .form-group');
          if (label) label.click();
          else document.body.click();
        });
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      }
    }
  }
  const done = await page.evaluate(({ dateFromDdMm, dateToDdMm }) => {
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl && toEl) {
      fromEl.focus();
      fromEl.value = dateFromDdMm;
      fromEl.dispatchEvent(new Event('input', { bubbles: true }));
      fromEl.dispatchEvent(new Event('change', { bubbles: true }));
      fromEl.dispatchEvent(new Event('blur', { bubbles: true }));
      toEl.focus();
      toEl.value = dateToDdMm;
      toEl.dispatchEvent(new Event('input', { bubbles: true }));
      toEl.dispatchEvent(new Event('change', { bubbles: true }));
      toEl.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }
    const inputs = document.querySelectorAll('input[placeholder="od"], input[placeholder="do"], input[name*="date"], input[placeholder*="datum"]');
    if (inputs.length >= 2) {
      inputs[0].value = dateFromDdMm;
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      inputs[1].value = dateToDdMm;
      inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (inputs.length === 1) {
      inputs[0].value = dateToDdMm;
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, { dateFromDdMm, dateToDdMm });
  if (done) {
    await page.evaluate(() => {
      const label = document.querySelector('label, h1, h2, .form-group');
      if (label) label.click();
      else document.body.click();
    });
    await new Promise((r) => setTimeout(r, 2000));
  }
  return done;
}

/**
 * Na stranici postavlja datum: jedan input type="date", ili tri selecta (dan, mjesec, godina).
 */
async function setDateOnPage(page, dateOption) {
  const { day, month, year, dateStr } = getTargetDate(dateOption);

  const set = await page.evaluate(({ dateStr, day, month, year }) => {
    let done = false;
    const d = dateStr;
    const dNum = String(day);
    const mNum = String(month);
    const yNum = String(year);

    const dateInput = document.querySelector('input[type="date"], input[type="text"][name*="date"], input[name*="datum"]');
    if (dateInput) {
      dateInput.focus();
      dateInput.value = d;
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      done = true;
    }

    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const name = (sel.name || sel.id || '').toLowerCase();
      const opts = Array.from(sel.options);
      if (name.includes('dan') || name.includes('day') || (opts.length <= 31 && opts.some(o => o.value === dNum))) {
        sel.value = dNum;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        done = true;
      } else if (name.includes('mjesec') || name.includes('month') || name.includes('mjesec') || (opts.length <= 12 && opts.some(o => o.value === mNum))) {
        sel.value = mNum;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        done = true;
      } else if (name.includes('godin') || name.includes('year') || (opts.length >= 2 && opts.some(o => o.value === yNum))) {
        sel.value = yNum;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        done = true;
      }
    }
    return done;
  }, { dateStr, day, month, year });

  return set;
}

/**
 * Pokreće browser, login, postavlja datum (ili raspon), preuzima Excel.
 * options: { mode: 'month' | 'day' } — month = od 1. do jučer, day = samo jučer.
 * Vraća { ok, path, error, dateFrom, dateTo }.
 */
async function fetchRetailExcel(options = {}) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    return { ok: false, error: 'Puppeteer nije instaliran. U terminalu pokreni: npm install puppeteer' };
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const loginUrl = config.loginUrl.trim();
  const base = loginUrl.replace(/#!.*$/, '').replace(/\/$/, '');
  const reportUrl = (config.reportUrl && config.reportUrl.trim()) || `${base}/#!/mysales`;
  const username = config.username;
  const password = config.password;
  const isFirstMonth = options.mode === 'month';
  const { dateFrom, dateTo } = getDateRangeForMode(isFirstMonth, options.date);
  const downloadDir = path.resolve(path.join(__dirname, '..', config.downloadFolder || 'data'), 'retail_downloads');

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

    await delay(2000);

    const userSel = 'input[type="text"], input[name="username"], input[name="user"], input[name="email"], input[id="username"], input[id="user"]';
    const passSel = 'input[type="password"], input[name="password"], input[name="pwd"], input[id="password"]';
    const submitSel = 'input[type="submit"], button[type="submit"]';

    const userEl = await page.$(userSel);
    const passEl = await page.$(passSel);
    if (userEl) await userEl.type(username, { delay: 50 });
    if (passEl) await passEl.type(password, { delay: 50 });
    await delay(500);
    const submit = await page.$(submitSel);
    if (submit) await submit.click();
    else await page.keyboard.press('Enter');

    await delay(4000);

    if (reportUrl !== loginUrl) {
      await page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await delay(3000);
    }

    const dateSet = (options.date || isFirstMonth)
      ? await setDateRangeOnPage(page, dateFrom, dateTo)
      : await setDateOnPage(page, 'yesterday');
    await delay(1500);

    // 1. Klik na PRETRAGA (Search)
    const searchClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'));
      const pretraga = buttons.find(el => /pretraga|search/i.test((el.textContent || '').trim()));
      if (pretraga) { pretraga.click(); return true; }
      return false;
    });
    if (!searchClicked) {
      await delay(500);
    }
    await delay(8000);

    // Scroll da se učitaju SVI redovi (lazy loading) prije Exporta — "Eksport svih podataka u pretraživaču" izvozi samo ono što je učitano
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => {
        const el = document.querySelector('.ag-body-viewport, .table-container, [class*="table"] [class*="body"], [role="grid"]');
        if (el) { el.scrollTop = el.scrollHeight; el.scrollBy(0, 800); }
        window.scrollTo(0, document.body.scrollHeight);
      }).catch(() => {});
      await delay(500);
    }
    await delay(4000);

    // 2. Klik na Export (crveni link ili ikona)
    const exportClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button, span[role="button"], [class*="export"], [class*="Export"]'));
      const byText = all.find(el => /^export$|^eksport$/i.test((el.textContent || '').trim()));
      if (byText) { byText.click(); return true; }
      const any = all.find(el => /export|eksport/i.test(el.textContent || ''));
      if (any) { any.click(); return true; }
      const byAria = document.querySelector('[aria-label*="xport"], [title*="xport"]');
      if (byAria) { byAria.click(); return true; }
      return false;
    });
    if (!exportClicked) {
      return { ok: false, error: 'Link „Export” nije pronađen. Učini pretragu pa ručno klikni Export.' };
    }
    await delay(2000);

    // 3. U modalu: treća opcija — "Eksport svih podataka u pretraživaču" (sve podatke u pretraživaču)
    const modalOptionClicked = await page.evaluate(() => {
      const targetText = 'Eksport svih podataka u pretraživaču';
      const table = document.querySelector('.productExportOptionsTable, table.productExportOptionsTable');
      if (table) {
        const btns = Array.from(table.querySelectorAll('button'));
        const third = btns.find(b => (b.textContent || '').trim() === targetText);
        if (third) { third.click(); return true; }
        if (btns.length >= 3) { btns[2].click(); return true; }
      }
      const all = Array.from(document.querySelectorAll('.modal button, [role="dialog"] button'));
      const target = all.find(el => (el.textContent || '').trim().includes('svih podataka u pretraživaču'));
      if (target) { target.click(); return true; }
      const withExport = all.filter(el => /eksport|export/i.test(el.textContent || ''));
      if (withExport.length >= 3) { withExport[2].click(); return true; }
      return false;
    });
    if (!modalOptionClicked) {
      await delay(1000);
      const fallback = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button'));
        const target = all.find(el => /svih podataka u pretraživaču/i.test(el.textContent || ''));
        if (target) { target.click(); return true; }
        const withExport = all.filter(el => /eksport|export/i.test(el.textContent || ''));
        if (withExport.length >= 3) { withExport[2].click(); return true; }
        return false;
      });
      if (!fallback) {
        return { ok: false, error: 'U export modalu nije pronađena treća opcija (Eksport svih podataka u pretraživaču).' };
      }
    }
    await delay(5000);

    // 4. Klik na "Potvrdi" u dijalogu (kreiranje fajla može potrajati...)
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('potrajati') || document.body.innerText.includes('Kreiranje fajla'),
        { timeout: 10000 }
      );
    } catch (_) {}
    await delay(1000);

    let confirmClicked = false;
    try {
      confirmClicked = await page.evaluate(() => {
        const all = document.querySelectorAll('button');
        for (const b of all) {
          const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
          if (t === 'Potvrdi' || t === 'Потврди' || /^potvrdi$/i.test(t)) {
            b.focus();
            b.click();
            return true;
          }
        }
        const modal = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(m => (m.textContent || '').includes('potrajati'));
        if (modal) {
          const btn = modal.querySelector('button');
          if (btn) { btn.click(); return true; }
        }
        return false;
      });
    } catch (_) {}

    await delay(15000);

    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
    const byTime = files.map(f => ({
      f,
      m: fs.statSync(path.join(downloadDir, f)).mtime.getTime(),
    }));
    byTime.sort((a, b) => b.m - a.m);
    let chosen = byTime[0];
    if (options.date && byTime.length > 0) {
      const ddmm = toDdMmYyyy(options.date);
      const match = byTime.find(({ f }) => f.includes(ddmm));
      if (match) chosen = match;
    }
    if (chosen) {
      const filePath = path.join(downloadDir, chosen.f);
      const dest = path.join(path.dirname(downloadDir), 'retail_promet.xlsx');
      fs.copyFileSync(filePath, dest);
      return { ok: true, path: options.date ? filePath : dest, filename: chosen.f, dateFrom, dateTo };
    }

    return { ok: false, error: 'Excel nije preuzet. Postavi reportUrl na stranicu gdje biraš datum i preuzimaš; provjeri da li postoji link/dugme za Excel.' };
  } finally {
    await browser.close();
  }
}

module.exports = { fetchRetailExcel, loadConfig, getTargetDate, getDateRangeForMode };
