# AI Promotions — Interni sistem za preporuke akcija

Sistem automatski predlaže promocije na osnovu **istorijskih akcija iz 2025** i **dnevnog prometa iz SQL Servera**. Ne koristi samo heuristiku: uči kako svaki artikal reaguje na akciju (elastičnost) i na osnovu toga preporučuje rabat, trajanje i očekivani uplift.

---

## Šta sistem radi

1. **SQL Server** — povlači prodaju po artiklu po danima (količina, iznos, cijena, objekat/kupac) prema tvom mapiranju.
2. **Import istorije** — rekurzivno učitava sve Excel akcije iz foldera (npr. `akcije/` po mjesecima/nedeljama), detektuje kolone (šifra, naziv, rabat, period) i puni bazu `promotion_events`.
3. **Učenje elastičnosti** — za svaki artikal računa uplift (prodaja tokom akcije / prodaja 14 dana prije), prosjek, stabilnost i klasu (LOW, MEDIUM, HIGH, EXTREME). Rezultat: tabela `product_promo_profile`.
4. **Preporuke** — na osnovu zadnjih 7 dana prodaje (padovi) i elastičnosti predlaže akcije (rabat, trajanje, očekivani dodatni promet).
5. **Excel generator** — na osnovu tvog templatea popunjava redove predloženim akcijama, validira (akcijska &lt; redovna, nema duplikata) i snima `Akcije DD-MM-YYYY.xlsx`.

---

## Kako mapirati SQL (db.mapping.json)

Fajl **`db.mapping.json`** mora biti u root-u projekta. U njemu mapiraš **svoju** tabelu prodaje i kolone — sistem ne koristi hardcoded nazive.

### Primjer strukture

```json
{
  "connection": {
    "server": "localhost",
    "database": "ImeTvojeBaze",
    "user": "sa",
    "password": "TvojaLozinka",
    "options": {
      "encrypt": true,
      "trustServerCertificate": true,
      "instanceName": ""
    }
  },
  "sales": {
    "table": "Prodaja",
    "dateColumn": "Datum",
    "articleCodeColumn": "SifraArtikla",
    "articleNameColumn": "NazivArtikla",
    "quantityColumn": "Kolicina",
    "amountColumn": "Iznos",
    "priceColumn": "Cijena",
    "objectColumn": "Objekat",
    "customerColumn": "Kupac"
  }
}
```

### Obavezna polja

- **connection**: `server`, `database`, `user`, `password`
- **sales**: `table`, `dateColumn`, `articleCodeColumn`, `quantityColumn`, `amountColumn`

Ostale kolone (`articleNameColumn`, `priceColumn`, `objectColumn`, `customerColumn`) su opcione. Ako nešto obavezno nedostaje, aplikacija će pri startu (ili pri prvom pozivu ka SQL-u) javiti **jasnu grešku** sa listom nedostajućih polja.

---

## Kako uploadovati template

1. **Pripremi Excel template** (.xlsx) u istom formatu kao tvoji letci (npr. kolone: R.br., Naziv proizvoda, Bar kod, Osnovna cijena, Rabat, Akcijski rabat, Neto cijena, Akcijska MPC, Period…). Sistem **ne mijenja format** — samo popunjava redove.
2. Na stranici **AI Promotions** u sekciji "Generator Excel akcija":
   - Klikni **Odaberi fajl** i izaberi svoj .xlsx template.
   - Klikni **Upload template**.
3. Klikni **GENERATE PROMO EXCEL**. Sistem će:
   - uzeti posljednji uploadovani template,
   - popuniti redove preporučenim akcijama (šifra, naziv, rabat, akcijska cijena),
   - provjeriti da je akcijska cijena manja od redovne i da nema duplikata,
   - snimiti fajl kao **Akcije DD-MM-YYYY.xlsx** u folder `output/` i ponuditi link za preuzimanje.

Template mora imati barem kolone koje sistem može prepoznati po nazivima (npr. "Naziv proizvoda", "Bar kod", "Rabat", "Akcijska MPC" itd.). Lista aliasa je u kodu u `services/excelGenerator.js` (TEMPLATE_COLUMN_ALIASES).

---

## Pokretanje

```bash
npm install
npm start
```

Otvori u browseru: **http://localhost:3000**

### Redoslijed na stranici

1. **Import istorije akcija** — učitaj sve Excel fajlove iz foldera `akcije` (ili putanja iz `config.json` → `promoHistoryPath`).
2. **Pokreni učenje elastičnosti** — zahtijeva prodaju iz SQL Servera za 2025. Ako SQL nije spojen, učenje neće imati dovoljno podataka.
3. **Dnevni promet / Top padovi / Preporuke** — osvježavaju se iz SQL-a i naučenih profila.
4. **Upload template** → **GENERATE PROMO EXCEL** — preuzmi generisani fajl iz `output/`.

---

## Config (config.json)

- **promoHistoryPath** — putanja do foldera sa Excel akcijama (default: `./akcije`). Rekurzivno se skeniraju svi .xlsx (preskaču se fajlovi koji počinju sa `~$`).
- **promoHistoryYear** — godina za parsiranje perioda (default: 2025).
- **baselineDaysBeforePromo** — koliko dana prije akcije uzimamo kao baseline za uplift (default: 14).
- **recommendationLookbackDays** — koliko dana unazad gledamo za padove i preporuke (default: 7).
- **elasticityThresholds** — granice za LOW / MEDIUM / HIGH / EXTREME (opciono).

---

## Struktura projekta

- **server.js** — Express, servira API i `public/`
- **routes/api.js** — sve API rute (promet, padovi, preporuke, import, učenje, upload templatea, generisanje Excel-a)
- **services/dbMapping.js** — učitavanje i validacija `db.mapping.json`
- **services/sqlServer.js** — povlačenje dnevnog prometa iz SQL Servera (samo mapirane kolone)
- **services/promoHistoryParser.js** — rekurzivno učitavanje .xlsx, fleksibilno mapiranje kolona (šifra, naziv, rabat, period)
- **services/database.js** — SQLite: `promotion_events`, `product_promo_profile`
- **services/elasticityEngine.js** — računanje uplifta i elastičnosti po artiklu
- **services/recommendationEngine.js** — detekcija padova, preporuka rabata i trajanja, očekivani dodatni promet
- **services/excelGenerator.js** — čitanje templatea, popunjavanje redova, validacija, snimanje `Akcije DD-MM-YYYY.xlsx`
- **public/index.html** — UI "AI Promotions" (dnevni promet, padovi, preporuke, dugmad, upload)
- **data/promo.db** — SQLite baza (kreira se automatski)
- **uploads/** — uploadovani templatei
- **output/** — generisani Excel fajlovi

---

## Napomene

- Ako SQL Server nije dostupan ili `db.mapping.json` nije ispravan, dnevni promet i top padovi će biti prazni, ali import istorije i preporuke (na osnovu već naučenih profila) i dalje rade.
- Elastičnost se uči **samo** iz parova (istorija akcija + prodaja u tom periodu). Artikli bez istorije u preporukama koriste kategorijski prosjek.
- Template za Excel treba da ima prvi red (ili jedan od prvih) sa nazivima kolona koje sistem prepoznaje (v. TEMPLATE_COLUMN_ALIASES u `excelGenerator.js`).
