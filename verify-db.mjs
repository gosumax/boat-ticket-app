import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = 'D:\\Проэкты\\МОре\\boat-ticket-app\\database.sqlite';
const db = new Database(DB_PATH);

console.log('db_file=', DB_PATH);
console.log('templates=', db.prepare('SELECT COUNT(1) c FROM schedule_templates').get());
console.log('items=', db.prepare('SELECT COUNT(1) c FROM schedule_template_items').get());
console.log('slots=', db.prepare('SELECT COUNT(1) c FROM generated_slots').get());
console.log('sample=');
console.log(db.prepare('SELECT id, schedule_template_id, trip_date, boat_id, time FROM generated_slots LIMIT 3').all());

db.close();
