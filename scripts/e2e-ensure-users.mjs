import bcrypt from 'bcrypt';
import db from '../server/db.js';

const SALT_ROUNDS = 10;

const users = [
  {
    username: process.env.E2E_DISPATCHER_USERNAME || 'dispatcher',
    password: process.env.E2E_DISPATCHER_PASSWORD || '123456',
    role: 'dispatcher',
  },
  {
    username: process.env.E2E_SELLER_USERNAME || 'seller',
    password: process.env.E2E_SELLER_PASSWORD || '123456',
    role: 'seller',
  },
  {
    username: process.env.E2E_OWNER_USERNAME || 'owner',
    password: process.env.E2E_OWNER_PASSWORD || 'owner123',
    role: 'owner',
  },
];

const upsertUser = db.transaction((u) => {
  const hash = bcrypt.hashSync(String(u.password), SALT_ROUNDS);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
  if (existing?.id) {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, role = ?, is_active = 1
      WHERE id = ?
    `).run(hash, u.role, existing.id);
    return { action: 'updated', id: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, ?, 1)
  `).run(u.username, hash, u.role);
  return { action: 'created', id: Number(result.lastInsertRowid) };
});

for (const user of users) {
  const result = upsertUser(user);
  console.log(`[E2E_USERS] ${result.action}: ${user.username} (${user.role}) id=${result.id}`);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localYmdAdd(days = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

const today = localYmdAdd(0);
const tomorrow = localYmdAdd(1);
const day2 = localYmdAdd(2);

const timesByType = {
  speed: process.env.E2E_SLOT_TIME_SPEED || process.env.E2E_SLOT_TIME || '23:20',
  cruise: process.env.E2E_SLOT_TIME_CRUISE || '23:30',
  banana: process.env.E2E_SLOT_TIME_BANANA || '23:40',
};

const slotMatrix = [
  { day: today, type: 'speed' },
  { day: tomorrow, type: 'speed' },
  { day: day2, type: 'speed' },
  { day: today, type: 'cruise' },
  { day: tomorrow, type: 'cruise' },
  { day: day2, type: 'cruise' },
  { day: today, type: 'banana' },
  { day: tomorrow, type: 'banana' },
  { day: day2, type: 'banana' },
];

const priceByType = {
  speed: { adult: 2000, child: 500, teen: 1000 },
  cruise: { adult: 1800, child: 400, teen: 900 },
  banana: { adult: 2200, child: 700, teen: 0 },
};

function ensureBoat(type) {
  const existing = db.prepare(`
    SELECT id, type
    FROM boats
    WHERE is_active = 1 AND type = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(type);
  if (existing?.id) return { id: Number(existing.id), type: String(existing.type || type) };

  const prices = priceByType[type] || priceByType.speed;
  const ins = db.prepare(`
    INSERT INTO boats (name, is_active, type, price_adult, price_child, price_teen)
    VALUES (?, 1, ?, ?, ?, ?)
  `).run(`E2E ${type}`, type, prices.adult, prices.child, prices.teen);

  const created = { id: Number(ins.lastInsertRowid), type };
  console.log(`[E2E_SLOTS] created boat id=${created.id} type=${type}`);
  return created;
}

function ensureTemplateItem(boatId, type, departureTime) {
  const existing = db.prepare(`
    SELECT id
    FROM schedule_template_items
    WHERE boat_id = ? AND departure_time = ? AND is_active = 1
    ORDER BY id ASC
    LIMIT 1
  `).get(boatId, departureTime);
  if (existing?.id) return Number(existing.id);

  const prices = priceByType[type] || priceByType.speed;
  const ins = db.prepare(`
    INSERT INTO schedule_template_items
      (name, boat_id, boat_type, type, departure_time, duration_minutes, capacity, price_adult, price_child, price_teen, weekdays_mask, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(`E2E Auto ${type}`, boatId, type, type, departureTime, 60, 12, prices.adult, prices.child, prices.teen, 127);
  return Number(ins.lastInsertRowid);
}

function ensureGeneratedSlot({ day, type }) {
  const departureTime = timesByType[type] || '23:20';
  const prices = priceByType[type] || priceByType.speed;
  const boat = ensureBoat(type);
  const templateId = ensureTemplateItem(boat.id, type, departureTime);

  let slot = db.prepare(`
    SELECT id, capacity
    FROM generated_slots
    WHERE trip_date = ? AND time = ? AND boat_id = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(day, departureTime, boat.id);

  if (!slot?.id) {
    const slotRes = db.prepare(`
      INSERT INTO generated_slots
        (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(templateId, day, boat.id, departureTime, 12, 12, 60, prices.adult, prices.child, prices.teen);
    slot = { id: Number(slotRes.lastInsertRowid), capacity: 12 };
    console.log(`[E2E_SLOTS] created generated slot id=${slot.id} day=${day} type=${type} time=${departureTime}`);
  }

  const slotUid = `generated:${slot.id}`;
  db.prepare('DELETE FROM tickets WHERE presale_id IN (SELECT id FROM presales WHERE slot_uid = ?)').run(slotUid);
  db.prepare('DELETE FROM presales WHERE slot_uid = ?').run(slotUid);

  const cap = Number(slot.capacity || 12) > 0 ? Number(slot.capacity) : 12;
  db.prepare(`
    UPDATE generated_slots
    SET is_active = 1,
        seats_left = CASE WHEN capacity > 0 THEN capacity ELSE ? END,
        price_adult = ?,
        price_child = ?,
        price_teen = ?,
        duration_minutes = 60
    WHERE id = ?
  `).run(cap, prices.adult, prices.child, prices.teen, slot.id);

  console.log(`[E2E_SLOTS] prepared clean slot uid=${slotUid} date=${day} type=${type} time=${departureTime}`);
  return { slotUid, day, type, time: departureTime };
}

const prepared = slotMatrix.map(ensureGeneratedSlot);
console.log(`[E2E_SLOTS] prepared total slots=${prepared.length}`);
