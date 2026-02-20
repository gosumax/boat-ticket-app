/**
 * Dispatcher Business Logic Tests (Vitest White-Box) - REAL BACKEND
 * Tests database operations using real db.js module
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

// Import test setup FIRST (sets DB_FILE and global beforeEach)
import { 
  initTestDb, 
  getSeedData,
  getDb, 
  closeDb 
} from './test-setup.js';

describe('Dispatcher Business Logic Tests (Real Backend)', () => {
  let db;
  let testData;
  
  beforeAll(async () => {
    db = await initTestDb();
  });
  
  afterAll(() => {
    closeDb();
  });
  
  // Get fresh seed data (seeded by global beforeEach in test-setup.js)
  beforeEach(() => {
    testData = getSeedData();
  });
  
  describe('Price Calculation', () => {
    it('should calculate correct price for adult only', () => {
      const adult = 2;
      const teen = 0;
      const child = 0;
      const priceAdult = 1500;
      const priceTeen = 1200;
      const priceChild = 800;
      
      const total = (adult * priceAdult) + (teen * priceTeen) + (child * priceChild);
      expect(total).toBe(3000);
    });
    
    it('should calculate correct price for mixed tickets', () => {
      const adult = 2;
      const teen = 1;
      const child = 1;
      const priceAdult = 1500;
      const priceTeen = 1200;
      const priceChild = 800;
      
      const total = (adult * priceAdult) + (teen * priceTeen) + (child * priceChild);
      // 2*1500 + 1*1200 + 1*800 = 5000
      expect(total).toBe(5000);
    });
  });
  
  describe('Capacity Validation', () => {
    it('should pass when enough seats available', () => {
      const seatsLeft = 10;
      const requested = 5;
      expect(seatsLeft >= requested).toBe(true);
    });
    
    it('should fail when not enough seats', () => {
      const seatsLeft = 3;
      const requested = 5;
      expect(seatsLeft >= requested).toBe(false);
    });
  });
  
  describe('Database Operations', () => {
    it('should insert and retrieve presale', () => {
      const result = db.prepare(`
        INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', 2, 3000);
      
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(result.lastInsertRowid);
      expect(presale.customer_name).toBe('Test');
      expect(presale.number_of_seats).toBe(2);
    });
    
    it('should update seats_left correctly', () => {
      const initialSeats = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1).seats_left;
      
      db.prepare('UPDATE generated_slots SET seats_left = seats_left - ? WHERE id = ?').run(3, testData.genSlotId1);
      
      const newSeats = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1).seats_left;
      expect(newSeats).toBe(initialSeats - 3);
    });
    
    it('should create tickets for presale', () => {
      const presaleResult = db.prepare(`
        INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', 3, 4500);
      
      const presaleId = presaleResult.lastInsertRowid;
      
      for (let i = 0; i < 3; i++) {
        db.prepare(`
          INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
          VALUES (?, ?, ?, 'ACTIVE', 1500)
        `).run(presaleId, testData.slotId1, `TKT-${presaleId}-${i + 1}`);
      }
      
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.length).toBe(3);
    });
    
    it('should update presale status to CANCELLED', () => {
      const result = db.prepare(`
        INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', 1, 1500);
      
      db.prepare('UPDATE presales SET status = ? WHERE id = ?').run('CANCELLED', result.lastInsertRowid);
      
      const presale = db.prepare('SELECT status FROM presales WHERE id = ?').get(result.lastInsertRowid);
      expect(presale.status).toBe('CANCELLED');
    });
    
    it('should create money_ledger entry', () => {
      const result = db.prepare(`
        INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', 1, 1500);
      
      db.prepare(`
        INSERT INTO money_ledger (presale_id, kind, type, amount, status)
        VALUES (?, 'SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CASH', 500, 'POSTED')
      `).run(result.lastInsertRowid);
      
      const ledger = db.prepare('SELECT * FROM money_ledger WHERE presale_id = ?').get(result.lastInsertRowid);
      expect(ledger.kind).toBe('SALE_PREPAYMENT_CASH');
      expect(ledger.amount).toBe(500);
    });
    
    it('should create sales_transactions_canonical entry', () => {
      const presaleResult = db.prepare(`
        INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', 1, 1500);
      
      const ticketResult = db.prepare(`
        INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
        VALUES (?, ?, ?, 'ACTIVE', 1500)
      `).run(presaleResult.lastInsertRowid, testData.slotId1, 'TKT-1-1');
      
      db.prepare(`
        INSERT INTO sales_transactions_canonical (ticket_id, presale_id, slot_id, boat_id, slot_uid, amount, status)
        VALUES (?, ?, ?, ?, ?, ?, 'VALID')
      `).run(ticketResult.lastInsertRowid, presaleResult.lastInsertRowid, testData.slotId1, testData.speedBoatId, `generated:${testData.genSlotId1}`, 1500);
      
      const canonical = db.prepare('SELECT * FROM sales_transactions_canonical WHERE ticket_id = ?').get(ticketResult.lastInsertRowid);
      expect(canonical.amount).toBe(1500);
      expect(canonical.status).toBe('VALID');
    });
  });
  
  describe('Transaction-like Operations', () => {
    it('should perform atomic seat update and presale creation', () => {
      const transaction = db.transaction((seats) => {
        // Check and update seats
        const slot = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1);
        if (slot.seats_left < seats) {
          throw new Error('NO_SEATS');
        }
        
        db.prepare('UPDATE generated_slots SET seats_left = seats_left - ? WHERE id = ?').run(seats, testData.genSlotId1);
        
        // Create presale
        const result = db.prepare(`
          INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
          VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', seats, 1500 * seats);
        
        return result.lastInsertRowid;
      });
      
      const presaleId = transaction(2);
      expect(presaleId).toBeGreaterThan(0);
      
      const seats = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1).seats_left;
      expect(seats).toBe(98); // 100 - 2
    });
    
    it('should rollback on capacity exceeded', () => {
      const transaction = db.transaction((seats) => {
        const slot = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1);
        if (slot.seats_left < seats) {
          throw new Error('NO_SEATS');
        }
        
        db.prepare('UPDATE generated_slots SET seats_left = seats_left - ? WHERE id = ?').run(seats, testData.genSlotId1);
        
        return db.prepare(`
          INSERT INTO presales (boat_slot_id, slot_uid, customer_name, customer_phone, number_of_seats, total_price, status)
          VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(testData.slotId1, `generated:${testData.genSlotId1}`, 'Test', '79991234567', seats, 1500 * seats).lastInsertRowid;
      });
      
      expect(() => transaction(150)).toThrow('NO_SEATS'); // 150 > 100 capacity
      
      // Verify rollback - seats should be unchanged
      const seats = db.prepare('SELECT seats_left FROM generated_slots WHERE id = ?').get(testData.genSlotId1).seats_left;
      expect(seats).toBe(100);
    });
  });
  
  describe('Slot UID Handling', () => {
    it('should format generated slot UID', () => {
      const uid = `generated:${testData.genSlotId1}`;
      expect(uid.startsWith('generated:')).toBe(true);
    });
    
    it('should parse slot UID correctly', () => {
      const uid = `generated:${testData.genSlotId1}`;
      const parts = uid.split(':');
      expect(parts[0]).toBe('generated');
      expect(parseInt(parts[1])).toBe(testData.genSlotId1);
    });
  });
  
  describe('Payment Status Determination', () => {
    it('should return UNPAID for zero prepayment', () => {
      const totalPrice = 1500;
      const prepayment = 0;
      const status = prepayment <= 0 ? 'UNPAID' : (prepayment >= totalPrice ? 'PAID' : 'PARTIALLY_PAID');
      expect(status).toBe('UNPAID');
    });
    
    it('should return PAID for full prepayment', () => {
      const totalPrice = 1500;
      const prepayment = 1500;
      const status = prepayment <= 0 ? 'UNPAID' : (prepayment >= totalPrice ? 'PAID' : 'PARTIALLY_PAID');
      expect(status).toBe('PAID');
    });
    
    it('should return PARTIALLY_PAID for partial prepayment', () => {
      const totalPrice = 1500;
      const prepayment = 500;
      const status = prepayment <= 0 ? 'UNPAID' : (prepayment >= totalPrice ? 'PAID' : 'PARTIALLY_PAID');
      expect(status).toBe('PARTIALLY_PAID');
    });
  });
});
