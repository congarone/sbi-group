/**
 * Jednokratno: obriši sve retail dane i ostavi samo 10.2.2026. sa 5704.44 €
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'services', 'database'));

db.clearRetailDays();
db.upsertRetailDay('2026-02-10', 5704.44, 0);

const summary = db.getRetailMonthSummary(2, 2026);
console.log('Gotovo. Retail promet ovaj mjesec:', summary.totalAmount, '€ (' + summary.dayCount + ' dan).');
