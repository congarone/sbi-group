# SBI Group — Cloud setup (besplatno)

Uputstvo za postavljanje aplikacije na cloud da možeš pristupiti podacima sa bilo kojeg uređaja.

## 1. Supabase (baza — besplatno)

1. Otvori [supabase.com](https://supabase.com) i napravi nalog
2. Kreiraj novi projekat (npr. "sbi-group")
3. Sačekaj da se projekat pokrene (~2 min)
4. U **Project Settings → API** nađi:
   - **Project URL** (npr. `https://xxxxx.supabase.co`)
   - **service_role key** (Secret key — ne dijeliti!)

5. U **SQL Editor** otvori `supabase-schema.sql` iz ovog projekta i pokreni ceo SQL (kopiraj i Execute)

## 2. Render (hosting — besplatno)

1. Otvori [render.com](https://render.com) i napravi nalog
2. **New → Web Service**
3. Poveži GitHub repo (ili uploaduj kod)
4. Podešavanja:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

5. U **Environment** dodaj varijable:
   - `SUPABASE_URL` = tvoj Project URL iz Supabase
   - `SUPABASE_SERVICE_KEY` = tvoj service_role key

6. Deploy — aplikacija će biti na `https://tvoj-app.onrender.com`

## 3. Migracija podataka (opciono)

Ako već imaš podatke u lokalnoj SQLite bazi:

1. Pokreni migraciju (skripta za kopiranje SQLite → Supabase):
   ```bash
   node scripts/migrate-to-supabase.js
   ```
   Ili ručno: exportuj podatke iz SQLite i importuj u Supabase preko SQL Editor.

2. Za retail podatke: preuzmi Excel-e i pokreni `node scripts/retail-parse-by-brand.js` na cloudu (ili lokalno sa SUPABASE_URL postavljenim).

## 4. Automatsko preuzimanje retail prometa (GitHub Actions)

Svaki dan u 7:00 aplikacija može sama preuzeti promet sa retail portala i upisati u Supabase.

1. U GitHub repou otvori **Settings → Secrets and variables → Actions**
2. Dodaj **Repository secrets**:
   - `SUPABASE_URL` — Project URL iz Supabase
   - `SUPABASE_SERVICE_KEY` — service_role key
   - `RETAIL_USERNAME` — email za login na retail portal
   - `RETAIL_PASSWORD` — lozinka za retail portal

3. Push kod na GitHub — workflow `.github/workflows/retail-daily-fetch.yml` će se pokretati svaki dan u 7:00
4. Ručno pokretanje: **Actions** tab → **Retail dnevni promet** → **Run workflow**

## 5. Lokalno testiranje sa Supabase


Da bi lokalno koristio Supabase umjesto SQLite:

```bash
set SUPABASE_URL=https://tvoj-projekat.supabase.co
set SUPABASE_SERVICE_KEY=tvoj-service-role-key
node server.js
```

Na Linux/Mac:
```bash
export SUPABASE_URL=https://tvoj-projekat.supabase.co
export SUPABASE_SERVICE_KEY=tvoj-service-role-key
node server.js
```

## Napomene

- **SUPABASE_URL i SUPABASE_SERVICE_KEY** — obavezni na Renderu. Bez njih aplikacija neće startovati.
- **db.mapping.json** — opciono na Renderu. Ako nemaš SQL Server u cloud-u, dnevni promet iz SQL-a i "Artikli u padu" će biti prazni. Retail promet koristi Supabase.
- **retail.source.json** — korisnik i šifra za retail portal ostaju na serveru. Na Renderu možeš dodati kao env varijable ako želiš.
- **Puppeteer** — automatsko preuzimanje retail Excel-a koristi Puppeteer. Na Render free tier to ne radi. Koristi **GitHub Actions** (v. sekcija 4) da se promet preuzima svaki dan i upisuje u Supabase.
- **Besplatni tier** — Render free instance "spava" nakon 15 min neaktivnosti. Prvi request može trajati 30–60 sekundi. Sačekaj ili osvježi stranicu.
