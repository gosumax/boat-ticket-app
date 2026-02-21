const fs = require('fs');
const path = require('path');

const content = `// seat-sync-seller-vs-dispatcher.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';
const SALT_ROUNDS = 10;

let app, db;
let sellerToken, dispatcherToken;
let sellerId, dispatcherId;
let boatId, templateId, genSlotId;
let today;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  today = getTodayLocal(db);
  
  const hashedPassword = await bcrypt.hash('password123', SALT_ROUNDS);
  
  const sellerRes = db.prepare('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)').run('seller_sync_test', hashedPassword, 'seller');
  sellerId = sellerRes.lastInsertRowid;
  sellerToken = jwt.sign({ id: sellerId, username: 'seller_sync_test', role: 'seller' }, JWT_SECRET, { expiresIn: '24h' });
  
  const dispatcherRes = db.prepare('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)').run('dispatcher_sync_test', hashedPassword, 'dispatcher');
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'dispatcher_sync_test', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  const boatRes = db.prepare('INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen) VALUES (?, ?, 1, 1000, 500, 750)').run('BoatWalk', 'walk');
  boatId = boatRes.lastInsertRowid;
  
  const templateRes = db.prepare('INSERT INTO schedule_templates (weekday, time, product_type, boat_id, capacity, price_adult, price_child, price_teen, duration_minutes, is_active) VALUES (1, ?, ?, ?, 12, 1000, 500, 750, 60, 1)').run('10:00', 'walk', boatId);
  templateId = templateRes.lastInsertRowid;
  
  const boatSlotRes = db.prepare('INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, trip_date) VALUES (?, ?, 1000, 12, 12, 1000, 500, 750, 60, 1, ?)').run(boatId, '10:00', today);
  const boatSlotId = boatSlotRes.lastInsertRowid;
  
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const genSlotRes = db.prepare('INSERT INTO generated_slots (id, schedule_template_id, boat_id, time, trip_date, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active) VALUES (195, ?, ?, ?, ?, 12, 12, 1000, 500, 750, 60, 1)').run(templateId, boatId, '10:00', tomorrow);
  genSlotId = genSlotRes.lastInsertRowid;
  
  const presale1Res = db.prepare('INSERT INTO presales (boat_slot_id, slot_uid, seller_id, customer_name, customer_phone, number_of_seats, total_price, prepayment_amount, status, business_day) VALUES (?, ?, ?, ?, ?, 9, 9000, 9000, ?, ?)').run(boatSlotId, 'generated:195', sellerId, 'Customer Active', '79991112233', 'ACTIVE', today);
  const presale1Id = presale1Res.lastInsertRowid;
  
  for (let i = 0; i < 9; i++) {
    db.prepare('INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price) VALUES (?, ?, ?, ?, 1000)').run(presale1Id, boatSlotId, 'TKT-ACTIVE-' + (i + 1), 'ACTIVE');
  }
  
  const presale2Res = db.prepare('INSERT INTO presales (boat_slot_id, slot_uid, seller_id, customer_name, customer_phone, number_of_seats, total_price, prepayment_amount, status, business_day) VALUES (?, ?, ?, ?, ?, 6, 6000, 0, ?, ?)').run(boatSlotId, 'generated:195', sellerId, 'Customer Cancelled', '79994445566', 'CANCELLED', today);
  const presale2Id = presale2Res.lastInsertRowid;
  
  for (let i = 0; i < 6; i++) {
    db.prepare('INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price) VALUES (?, ?, ?, ?, 1000)').run(presale2Id, boatSlotId, 'TKT-REFUNDED-' + (i + 1), 'REFUNDED');
  }
  
  console.log('[SETUP] Created genSlotId:', genSlotId, 'trip_date:', tomorrow);
});

describe('SELLER vs DISPATCHER SEAT SYNC', () => {
  it('seller and dispatcher report identical occupied seat count', async () => {
    const expectedOccupied = 9;
    const expectedFree = 3;
    
    const sellerRes = await request(app)
      .get('/api/selling/boats/walk/slots')
      .set('Authorization', 'Bearer ' + sellerToken);
    
    console.log('[SELLER] Status:', sellerRes.status);
    expect(sellerRes.status).toBe(200);
    
    const dispatcherRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', 'Bearer ' + dispatcherToken);
    
    console.log('[DISPATCHER] Status:', dispatcherRes.status);
    expect(dispatcherRes.status).toBe(200);
    
    const sellerSlots = sellerRes.body?.slots || sellerRes.body || [];
    const dispatcherSlots = Array.isArray(dispatcherRes.body) ? dispatcherRes.body : [];
    
    const sellerSlot = sellerSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195');
    const dispatcherSlot = dispatcherSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195');
    
    if (!sellerSlot && sellerSlots.length > 0) {
      console.log('[SELLER] First slot:', JSON.stringify(sellerSlots[0], null, 2));
    }
    
    expect(sellerSlot).toBeDefined();
    expect(dispatcherSlot).toBeDefined();
    
    const sellerCapacity = sellerSlot.capacity || 12;
    const sellerAvailable = sellerSlot.available_seats ?? sellerSlot.seats_left ?? 0;
    const sellerOccupied = sellerCapacity - sellerAvailable;
    
    const dispatcherCapacity = dispatcherSlot.capacity || 12;
    const dispatcherAvailable = dispatcherSlot.seats_left ?? 0;
    const dispatcherOccupied = dispatcherCapacity - dispatcherAvailable;
    
    console.log('[SELLER] occupied:', sellerOccupied, 'available:', sellerAvailable);
    console.log('[DISPATCHER] occupied:', dispatcherOccupied, 'available:', dispatcherAvailable);
    
    expect(sellerOccupied).toBe(dispatcherOccupied);
    expect(sellerOccupied).toBe(expectedOccupied);
    expect(dispatcherOccupied).toBe(expectedOccupied);
    expect(sellerAvailable).toBe(expectedFree);
    
    console.log('[PASS] Seat counts synchronized');
  });
  
  it('excludes REFUNDED tickets from count', async () => {
    const dispatcherRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', 'Bearer ' + dispatcherToken);
    
    expect(dispatcherRes.status).toBe(200);
    
    const slots = Array.isArray(dispatcherRes.body) ? dispatcherRes.body : [];
    const slot = slots.find(s => s.id === 195);
    
    expect(slot).toBeDefined();
    
    const capacity = slot.capacity || 12;
    const available = slot.seats_left ?? 0;
    const occupied = capacity - available;
    
    expect(occupied).toBe(9);
    expect(occupied).toBeLessThan(15);
    
    console.log('[PASS] REFUNDED tickets excluded');
  });
});
`;

const targetPath = path.join(__dirname, 'tests', 'dispatcher', 'seat-sync-seller-vs-dispatcher.test.js');
fs.writeFileSync(targetPath, content, 'utf8');
console.log('Written to:', targetPath);
console.log('Content length:', content.length);
