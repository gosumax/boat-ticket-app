import db from './db.js';

console.log('boat_slots table structure:');
const boatSlotsColumns = db.prepare("PRAGMA table_info(boat_slots)").all();
console.log(boatSlotsColumns);

console.log('\nboats table structure:');
const boatsColumns = db.prepare("PRAGMA table_info(boats)").all();
console.log(boatsColumns);