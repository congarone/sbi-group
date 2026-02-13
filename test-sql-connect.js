/**
 * Test SQL konekcije na 192.168.100.8 (isti server kao Hubie).
 * Pokreni na ovom računaru: dupli klik na Testiraj SQL konekciju.bat
 * ili u terminalu: node test-sql-connect.js
 */
const sql = require('mssql');

const config = {
  server: '192.168.100.8',
  database: 'master',
  user: 'ivan',
  password: 'ivan',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 20000,
    requestTimeout: 10000,
  },
  pool: { max: 1, min: 0 },
};

async function test() {
  console.log('Povezujem se na 192.168.100.8 (HUBIE server), user ivan...\n');
  try {
    const pool = await sql.connect(config);
    const r = await pool.request().query('SELECT @@VERSION AS version');
    console.log('OK: Povezivanje uspjesno!\n');
    if (r.recordset && r.recordset[0]) {
      console.log('SQL Server:', String(r.recordset[0].version).slice(0, 80) + '...');
    }
    await pool.close();
    process.exit(0);
  } catch (e) {
    console.error('Greska:', e.message || e);
    if (e.message && e.message.includes('1433')) {
      console.log('\nSavjet: Provjeri da li je SQL Server na 192.168.100.8 pokrenut i da prima veze na portu 1433.');
      console.log('Na serveru: SQL Server Configuration Manager -> SQL Server Network Configuration -> TCP/IP Enabled.');
    }
    process.exit(1);
  }
}

test();
