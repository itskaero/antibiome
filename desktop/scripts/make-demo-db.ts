// Creates a database with an admin user and synthetic demo data (used for screenshots / evaluation).
import { openDatabase } from '../server/db';
import { createApi } from '../server/api';
import { seedDemo } from '../server/demo';

const [file, username = 'demo', password = 'demo-password'] = process.argv.slice(2);
const db = openDatabase(file);
const api = createApi(db);
await api.call('auth.setup', { username, displayName: 'Dr Demo Admin', password, unitName: 'PICU', beds: 14 });
await api.call('users.create', { username: 'nurse', displayName: 'Charge Nurse', role: 'clinician', password: 'nurse-password' });
console.log(`Seeded ${seedDemo(db)} admissions into ${file}`);
db.close();
