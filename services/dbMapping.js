/**
 * Učitava i validira db.mapping.json.
 * Sistem NE smije pretpostavljati nazive tabela/kolona - sve dolazi iz mappinga.
 * Javlja jasnu grešku ako nešto obavezno nedostaje.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_SALES_KEYS = [
  'table',
  'dateColumn',
  'articleCodeColumn',
  'quantityColumn',
  'amountColumn',
];

/**
 * @returns {{ connection: object, sales: object }}
 * @throws Error ako mapping nije validan
 */
function loadAndValidateMapping() {
  const mappingPath = path.join(__dirname, '..', 'db.mapping.json');
  if (!fs.existsSync(mappingPath)) {
    throw new Error(
      'db.mapping.json nije pronađen. Kreiraj fajl u root-u projekta prema README-u.'
    );
  }

  let mapping;
  try {
    const raw = fs.readFileSync(mappingPath, 'utf8');
    mapping = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      'db.mapping.json nije ispravan JSON: ' + (e.message || String(e))
    );
  }

  if (!mapping.sales || typeof mapping.sales !== 'object') {
    throw new Error(
      'db.mapping.json mora sadržavati sekciju "sales" sa mapiranjem tabele prodaje.'
    );
  }

  const missing = REQUIRED_SALES_KEYS.filter(
    (k) => !mapping.sales[k] || String(mapping.sales[k]).trim() === ''
  );
  if (missing.length > 0) {
    throw new Error(
      'U db.mapping.json u sekciji "sales" nedostaju obavezna polja: ' +
        missing.join(', ') +
        '. Dodaj: table, dateColumn, articleCodeColumn, quantityColumn, amountColumn.'
    );
  }

  if (!mapping.connection || typeof mapping.connection !== 'object') {
    throw new Error(
      'db.mapping.json mora sadržavati sekciju "connection" za SQL Server (server, database, user, password).'
    );
  }

  const reqConn = ['server', 'database', 'user', 'password'];
  const missingConn = reqConn.filter(
    (k) => !mapping.connection[k] || String(mapping.connection[k]).trim() === ''
  );
  if (missingConn.length > 0) {
    throw new Error(
      'U db.mapping.json u "connection" nedostaju: ' + missingConn.join(', ')
    );
  }

  return mapping;
}

module.exports = { loadAndValidateMapping, REQUIRED_SALES_KEYS };
