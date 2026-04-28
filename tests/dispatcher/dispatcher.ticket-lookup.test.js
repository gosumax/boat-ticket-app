import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  initTestDb,
  getSeedData,
  generateTestToken,
  getDb,
  closeDb,
} from './test-setup.js';
import { app } from '../../server/index.js';

describe('Dispatcher Ticket Lookup API', () => {
  let db;
  let seed;
  let dispatcherToken;

  beforeAll(async () => {
    db = await initTestDb();
  });

  afterAll(() => {
    closeDb();
  });

  beforeEach(() => {
    seed = getSeedData();
    dispatcherToken = generateTestToken(seed.dispatcherId, 'test_dispatcher', 'dispatcher');
  });

  async function createDispatcherPresale(overrides = {}) {
    const payload = {
      slotUid: `generated:${seed.genSlotId1}`,
      customerName: 'Lookup Client',
      customerPhone: '79991112233',
      numberOfSeats: 2,
      tripDate: seed.today,
      ...overrides,
    };

    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    return res.body;
  }

  it('looks up by ticket code (supports compact scan without hyphen)', async () => {
    const created = await createDispatcherPresale();
    const presaleId = created?.presale?.id;
    expect(Number.isInteger(Number(presaleId))).toBe(true);

    const firstTicket = getDb()
      .prepare('SELECT id FROM tickets WHERE presale_id = ? ORDER BY id ASC LIMIT 1')
      .get(presaleId);
    expect(Number(firstTicket?.id)).toBeGreaterThan(0);

    getDb()
      .prepare('UPDATE tickets SET ticket_code = ? WHERE id = ?')
      .run('FZ-003', firstTicket.id);

    const lookupRes = await request(app)
      .get('/api/selling/dispatcher/ticket-lookup')
      .query({ query: 'fz003' })
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body?.ok).toBe(true);
    expect(lookupRes.body?.matched_by).toBe('ticket_code');
    expect(lookupRes.body?.match?.presale_id).toBe(presaleId);
    expect(lookupRes.body?.match?.ticket_code).toBe('FZ-003');
    expect(lookupRes.body?.match?.slot_uid).toBe(`generated:${seed.genSlotId1}`);
  });

  it('extracts buyer_ticket_code from scanned URL and resolves presale', async () => {
    const created = await createDispatcherPresale();
    const presaleId = created?.presale?.id;
    const buyerTicketCode = created?.buyer_ticket_code;

    expect(typeof buyerTicketCode).toBe('string');
    expect(buyerTicketCode.length).toBeGreaterThan(0);

    const scannedUrl = `https://example.local/ticket/open?buyer_ticket_code=${encodeURIComponent(buyerTicketCode)}`;
    const lookupRes = await request(app)
      .get('/api/selling/dispatcher/ticket-lookup')
      .query({ query: scannedUrl })
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body?.ok).toBe(true);
    expect(lookupRes.body?.matched_by).toBe('buyer_ticket_code');
    expect(lookupRes.body?.match?.presale_id).toBe(presaleId);
  });

  it('returns 404 when lookup value does not match any ticket or presale', async () => {
    const lookupRes = await request(app)
      .get('/api/selling/dispatcher/ticket-lookup')
      .query({ query: 'UNKNOWN-TICKET-99999' })
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(lookupRes.status).toBe(404);
    expect(lookupRes.body?.ok).toBe(false);
    expect(lookupRes.body?.error).toBe('TICKET_NOT_FOUND');
  });
});
