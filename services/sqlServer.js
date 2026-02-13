/**
 * Servis za povlačenje dnevnog prometa iz SQL Servera.
 * Koristi isključivo mapirane nazive iz db.mapping.json (nema hardcoded kolona).
 */

const sql = require('mssql');
const { loadAndValidateMapping } = require('./dbMapping');

/**
 * Povlači prodaju po artiklu po danima (daily granularity).
 * @param {Object} [options] { fromDate, toDate } - ISO stringovi
 * @returns {Promise<Array<{ date, articleCode, articleName, quantity, amount, price?, object?, customer? }>>}
 */
async function getDailySales(options = {}) {
  const mapping = loadAndValidateMapping();
  const { connection, sales } = mapping;

  const config = {
    user: connection.user,
    password: connection.password,
    server: connection.server,
    database: connection.database,
    options: {
      encrypt: connection.options?.encrypt ?? true,
      trustServerCertificate: connection.options?.trustServerCertificate ?? true,
      instanceName: connection.options?.instanceName || undefined,
    },
  };

  const dateCol = sales.dateColumn;
  const codeCol = sales.articleCodeColumn;
  const nameCol = sales.articleNameColumn || null;
  const qtyCol = sales.quantityColumn;
  const amountCol = sales.amountColumn;
  const priceCol = sales.priceColumn || null;
  const objectCol = sales.objectColumn || null;
  const customerCol = sales.customerColumn || null;

  const table = sales.table;
  const selectCols = [
    dateCol,
    codeCol,
    nameCol,
    qtyCol,
    amountCol,
    priceCol,
    objectCol,
    customerCol,
  ].filter(Boolean);

  await getPool(config);
  const conditions = [];
  if (options.fromDate) conditions.push(`[${dateCol}] >= @fromDate`);
  if (options.toDate) conditions.push(`[${dateCol}] <= @toDate`);
  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const query = `
    SELECT ${selectCols.map((c) => `[${c}]`).join(', ')}
    FROM [${table}]
    ${whereClause}
    ORDER BY [${dateCol}], [${codeCol}]
  `;
  const request = new sql.Request();
  if (options.fromDate) request.input('fromDate', sql.Date, options.fromDate);
  if (options.toDate) request.input('toDate', sql.Date, options.toDate);

  const result = await request.query(query);
  return (result.recordset || []).map((row) => {
    const dateVal = row[dateCol];
    const out = {
      date: dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : String(dateVal).slice(0, 10),
      articleCode: String(row[codeCol] ?? ''),
      articleName: nameCol ? String(row[nameCol] ?? '') : '',
      quantity: Number(row[qtyCol]) || 0,
      amount: Number(row[amountCol]) || 0,
    };
    if (priceCol && row[priceCol] != null) out.price = Number(row[priceCol]);
    if (objectCol && row[objectCol] != null) out.object = String(row[objectCol]);
    if (customerCol && row[customerCol] != null) out.customer = String(row[customerCol]);
    return out;
  });
}

let pool = null;

async function getPool(config) {
  if (!pool) {
    pool = (await sql.connect(config)) || sql;
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = { getDailySales, closePool, loadAndValidateMapping };
