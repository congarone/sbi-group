/**
 * Debug: pokreće retail fetch korak po korak.
 * Pokreni: node scripts/retail-fetch-debug.js [datum] [--no-download]
 * Datum: YYYY-MM-DD ili DD.MM.YYYY (npr. 2026-02-02 ili 2.2.2026)
 * --no-download: stani nakon postavljanja datuma, ne skidaj Excel (za debug)
 */
const path = require('path');
const args = process.argv.slice(2);
const dateArg = args.find(a => !a.startsWith('--'));
const noDownload = args.includes('--no-download');
let targetDate = null;
if (dateArg) {
  const m = dateArg.match(/^(\d{4})-(\d{2})-(\d{2})$/) || dateArg.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) targetDate = m[0].includes('-') ? m[0] : `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
const retailFetcher = require(path.join(__dirname, '..', 'services', 'retailFetcher'));

async function run() {
  console.log('=== Korak 1: Učitavam konfiguraciju ===');
  let config;
  try {
    config = retailFetcher.loadConfig();
    console.log('OK: loginUrl=', config.loginUrl, 'reportUrl=', config.reportUrl);
  } catch (e) {
    console.log('GREŠKA:', e.message);
    return;
  }

  console.log('\n=== Korak 2: Pokrećem Puppeteer (vidljiv browser) ===');
  const puppeteer = require('puppeteer');
  const fs = require('fs');
  const downloadDir = path.resolve(path.join(__dirname, '..', 'data'), 'retail_downloads');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('OK: Browser pokrenut');

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('dialog', async (dialog) => {
      console.log('Native dijalog:', dialog.message());
      await dialog.accept();
    });
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    console.log('\n=== Korak 3: Idem na login stranicu ===');
    await page.goto(config.loginUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await delay(3000);
    console.log('OK: Stranica učitana');

    console.log('\n=== Korak 4: Unosim korisničko ime i šifru ===');
    const userSel = 'input[type="text"], input[name="username"], input[name="email"]';
    const passSel = 'input[type="password"]';
    const userEl = await page.$(userSel);
    const passEl = await page.$(passSel);
    if (userEl) { await userEl.type(config.username, { delay: 50 }); console.log('OK: Username unesen'); }
    else console.log('UPOZORENJE: Polje za username nije pronađeno');
    if (passEl) { await passEl.type(config.password, { delay: 50 }); console.log('OK: Šifra unesena'); }
    else console.log('UPOZORENJE: Polje za šifru nije pronađeno');
    await delay(500);

    console.log('\n=== Korak 5: Klik na prijavu ===');
    const submit = await page.$('input[type="submit"], button[type="submit"]');
    if (submit) { await submit.click(); console.log('OK: Klik na submit'); }
    else { await page.keyboard.press('Enter'); console.log('OK: Enter pritisnut'); }
    await delay(5000);
    console.log('Čekam 5 sek da se učita...');

    console.log('\n=== Korak 6: Idem na Moja Prodaja (mysales) ===');
    await page.goto(config.reportUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await delay(5000);
    console.log('OK: Stranica Moja Prodaja');

    console.log('\n=== Korak 7: Postavljam datum ===');
    const { dateFrom, dateTo } = retailFetcher.getDateRangeForMode(false, targetDate);
    const dateToDdMm = dateTo ? dateTo.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1') : '';
    console.log('Datum:', dateTo || 'jučer', '(DD.MM.YYYY:', dateToDdMm + ')');
    const dateInputs = await page.$$('input[type="text"], input[type="date"], input');
    const dateInputInfo = await page.evaluate(() => {
      const all = document.querySelectorAll('input');
      return Array.from(all).slice(0, 6).map((inp, i) => ({
        i, type: inp.type, name: inp.name, placeholder: inp.placeholder, value: inp.value, id: inp.id
      }));
    });
    console.log('Input polja:', JSON.stringify(dateInputInfo, null, 2));
    const dateFromDdMm = dateFrom ? dateFrom.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1') : dateToDdMm;
    const [targetYear, targetMonth, targetDay] = (dateTo || dateFrom || '').split('-').map((x, i) => i === 0 ? parseInt(x, 10) : parseInt(x, 10));
    const fromEl = await page.$('#dateFrom');
    const toEl = await page.$('#dateTo');
    let dateSet = false;
    if (fromEl && toEl) {
      await fromEl.click();
      await delay(1000);
      const pickerInfo = await page.evaluate(() => {
        const sel = '.uib-datepicker, .datepicker, [class*="datepicker"], ngb-datepicker, [class*="picker"], .dropdown-menu, [class*="calendar"], table.uib-weeks';
        const els = document.querySelectorAll(sel);
        return els.length + ' elements: ' + Array.from(els).slice(0, 5).map(e => e.className || e.tagName).join(' | ');
      });
      console.log('Date picker elementi:', pickerInfo);
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
        await delay(1500);
        await toEl.click();
        await delay(1000);
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
        dateSet = clickedDay2;
        await delay(1500);
      }
    }
    if (!dateSet) {
      dateSet = await page.evaluate(({ dateFromDdMm, dateToDdMm }) => {
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
        return false;
      }, { dateFromDdMm, dateToDdMm });
    }
    await delay(2000);
    console.log(dateSet ? 'OK: Datum postavljen' : 'UPOZORENJE: Datum možda nije postavljen');
    await page.evaluate(() => {
      const label = document.querySelector('label, h1, h2, .form-group');
      if (label) label.click();
      else document.body.click();
    });
    await delay(1500);
    const afterSet = await page.evaluate(() => {
      const f = document.getElementById('dateFrom');
      const t = document.getElementById('dateTo');
      return { dateFrom: f ? f.value : '', dateTo: t ? t.value : '' };
    });
    console.log('Na sajtu piše: dateFrom =', afterSet.dateFrom, '| dateTo =', afterSet.dateTo);
    const ocekivano = dateFromDdMm;
    const ok = afterSet.dateFrom === ocekivano && afterSet.dateTo === ocekivano;
    if (ok) console.log('>>> USPEH: Oba polja pokazuju', ocekivano, '<<<');
    else console.log('>>> GREŠKA: Očekivano', ocekivano, ', dobijeno', afterSet.dateFrom, '/', afterSet.dateTo, '<<<');

    await delay(1000);

    console.log('\n=== Korak 8: Klik na PRETRAGA ===');
    const searchClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      const p = buttons.find(el => /pretraga|search/i.test((el.textContent || '').trim()));
      if (p) { p.click(); return true; }
      return false;
    });
    console.log(searchClicked ? 'OK: PRETRAGA kliknuta' : 'GREŠKA: PRETRAGA nije pronađena');
    await delay(8000);
    console.log('Čekam 8 sek da se učitaju rezultati...');

    if (noDownload) {
      console.log('\n=== DEBUG MODE: Rezultati učitani. Ne skidam. Browser ostaje otvoren 60 sek. ===');
      await delay(60000);
      return;
    }

    console.log('\n=== Korak 8b: Scroll da se učitaju svi redovi (lazy load) ===');
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const el = document.querySelector('.ag-body-viewport, [class*="table"] [class*="body"], .table-container, [role="grid"]') || document.documentElement;
        el.scrollTop = el.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      });
      await delay(800);
    }
    console.log('OK: Scroll završen');
    await delay(3000);

    console.log('\n=== Korak 9: Tražim Export link ===');
    const pageContent = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button, span'));
      const withExport = all.filter(el => /export|eksport/i.test(el.textContent || ''));
      return { count: withExport.length, texts: withExport.slice(0, 10).map(e => (e.textContent || '').trim().slice(0, 50)) };
    });
    console.log('Elementi s "export/eksport":', pageContent.count, 'Primjeri:', pageContent.texts);

    const exportClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button, span[role="button"]'));
      const byText = all.find(el => /^export$|^eksport$/i.test((el.textContent || '').trim()));
      if (byText) { byText.click(); return 'exact'; }
      const any = all.find(el => /export|eksport/i.test(el.textContent || ''));
      if (any) { any.click(); return 'partial'; }
      return false;
    });
    console.log(exportClicked ? 'OK: Export kliknut (' + exportClicked + ')' : 'GREŠKA: Export nije pronađen');
    await delay(3000);

    console.log('\n=== Korak 10: Klik na "Eksport svih podataka u pretraživaču" (treća opcija) ===');
    const modalClicked = await page.evaluate(() => {
      const targetText = 'Eksport svih podataka u pretraživaču';
      const table = document.querySelector('.productExportOptionsTable, table.productExportOptionsTable');
      if (table) {
        const btns = Array.from(table.querySelectorAll('button'));
        const third = btns.find(b => (b.textContent || '').trim() === targetText);
        if (third) { third.click(); return 'exact'; }
        if (btns.length >= 3) { btns[2].click(); return 'third'; }
      }
      const target = Array.from(document.querySelectorAll('button')).find(el => /svih podataka u pretraživaču/i.test(el.textContent || ''));
      if (target) { target.click(); return 'text'; }
      const withExport = Array.from(document.querySelectorAll('button')).filter(el => /eksport|export/i.test(el.textContent || ''));
      if (withExport.length >= 3) { withExport[2].click(); return 'fallback'; }
      return false;
    });
    console.log(modalClicked ? 'OK: Treća opcija kliknuta' : 'UPOZORENJE: Modal opcija možda nije kliknuta');
    await delay(3000);

    console.log('\n=== Korak 10b: Čekam dijalog "Kreiranje fajla..." i klik na Potvrdi ===');
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('potrajati') || document.body.innerText.includes('Kreiranje fajla'),
        { timeout: 8000 }
      );
    } catch (_) { console.log('Dijalog možda već prikazan'); }
    await delay(500);

    let confirmClicked = false;
    try {
      confirmClicked = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          const t = (b.textContent || '').trim();
          if (t === 'Potvrdi' || t === 'Потврди' || /^potvrdi$/i.test(t)) {
            b.click();
            return true;
          }
        }
        return false;
      });
    } catch (e) {
      console.log('Greška pri kliku:', e.message);
    }
    console.log(confirmClicked ? 'OK: Potvrdi kliknut' : 'UPOZORENJE: Potvrdi nije pronađen');
    await delay(15000);
    console.log('Čekam 15 sek za kreiranje fajla i download...');

    console.log('\n=== Korak 11: Provjera downloada ===');
    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
    const byTime = files.map(f => ({ f, m: fs.statSync(path.join(downloadDir, f)).mtime.getTime() }));
    byTime.sort((a, b) => b.m - a.m);
    const latest = byTime[0];
    if (latest) {
      console.log('OK: Excel preuzet:', latest.f);
    } else {
      console.log('GREŠKA: Nema .xlsx fajlova u', downloadDir);
    }

    console.log('\n=== Završeno. Browser ostaje otvoren 5 sek. ===');
    await delay(5000);
  } finally {
    await browser.close();
  }
}

run().catch(e => {
  console.error('GREŠKA:', e.message);
  process.exit(1);
});
