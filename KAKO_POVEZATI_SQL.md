# Kako povezati SQL Server

## 1. Šta ti treba

- SQL Server koji je **pokrenut** (na tvom računaru ili na serveru u mreži).
- **Ime baze** u kojoj je tabela prodaje.
- **Korisničko ime i lozinka** koja ima pristup toj bazi (npr. `sa` ili drugi SQL login).
- **Nazivi tabele i kolona** tačno kako pišu u bazi (velika/mala slova ako SQL Server to traži).

## 2. Otvori db.mapping.json

Otvori fajl **`db.mapping.json`** u root folderu aplikacije (npr. u Cursoru ili Notepad-u).

## 3. Podesi "connection"

U dijelu **`connection`** upiši podatke za svoj SQL Server:

| Polje        | Šta upisati |
|-------------|-------------|
| **server**  | Adresa SQL Servera: `localhost` ako je na ovom računaru, ili IP/server name (npr. `192.168.1.10` ili `SRV-SQL.company.local`). Ako koristiš instancu: npr. `localhost\SQLEXPRESS`. |
| **database** | Ime baze u kojoj je tabela prodaje (npr. `ProdajaDB`, `Trgovina`). |
| **user**     | SQL login (npr. `sa` ili drugo korisničko ime). |
| **password** | Lozinka za tog korisnika. |

Primjer ako je sve na ovom računaru, baza "Trgovina", login "sa":

```json
"connection": {
  "server": "localhost",
  "database": "Trgovina",
  "user": "sa",
  "password": "TvojaLozinka",
  "options": {
    "encrypt": true,
    "trustServerCertificate": true,
    "instanceName": ""
  }
}
```

Ako koristiš **named instance** (npr. SQLEXPRESS), u `server` stavi npr. `localhost\\SQLEXPRESS` ili `.\SQLEXPRESS`, a u `instanceName` može ostati `""` (prazno) ako si instance već stavio u `server`.

## 4. Podesi "sales" (tabela i kolone)

Ovo mora da odgovara **tvojoj** tabeli prodaje. Otvori bazu u SSMS-u i pogledaj tačne nazive tabele i kolona.

| Polje u mappingu   | Šta je | Primjer (tvoji nazivi) |
|-------------------|--------|-------------------------|
| **table**         | Tabela u kojoj je prodaja | `Prodaja`, `Sales`, `ProdajaStavke` |
| **dateColumn**    | Kolona sa datumom | `Datum`, `Date`, `DatumProdaje` |
| **articleCodeColumn** | Šifra / barkod artikla | `SifraArtikla`, `Barkod`, `ArtikalId` |
| **articleNameColumn** | Naziv artikla (opciono) | `NazivArtikla`, `Naziv` |
| **quantityColumn**| Količina | `Kolicina`, `Qty`, `KolicinaProdata` |
| **amountColumn**  | Iznos (ukupno) | `Iznos`, `Amount`, `Vrijednost` |
| **priceColumn**   | Cijena po komadu (opciono) | `Cijena`, `Price` |
| **objectColumn**  | Objekat / poslovnica (opciono) | `Objekat`, `Poslovnica` |
| **customerColumn**| Kupac (opciono) | `Kupac`, `CustomerId` |

**Obavezno** moraju biti ispunjeni: **table**, **dateColumn**, **articleCodeColumn**, **quantityColumn**, **amountColumn**. Ostalo može ostati prazno ako nemaš tu kolonu.

Primjer ako ti tabela zove `Prodaja` i kolone `Datum`, `SifraArtikla`, itd.:

```json
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
```

## 5. Sačuvaj i pokreni aplikaciju

- Sačuvaj **db.mapping.json**.
- Pokreni aplikaciju (dvostruki klik na **Pokreni aplikaciju.bat** ili `npm start`).
- Na stranici "AI Promocije" trebalo bi da piše **"Baza podataka: povezana"**. Ako piše greška, provjeri:
  - da li je SQL Server pokrenut,
  - server/database/user/password,
  - da li korisnik ima pravo čitanja na tu tabelu,
  - da nazivi u **sales** tačno odgovaraju bazi (bez greške u pisanju).

## 6. Ako ne koristiš SQL Server

Ako nemaš SQL Server ili ne želiš ga sada povezivati:
- aplikacija i dalje radi;
- "Dnevni promet" i "Artikli u padu" će biti prazni;
- možeš uvesti istoriju akcija (Excel), pokrenuti učenje (bez prodaje će biti manje profila), i generisati Excel akcija ako imaš preporuke iz profila.
