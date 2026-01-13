// src/utils/apiClient.js
import { addNetworkLog } from './bugReporter';

const API_BASE = '/api';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

class ApiClient {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async request(url, options = {}) {
    const method = options.method || 'GET';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    const token = this.token || (typeof localStorage !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('jwt')) : null);
    if (token) headers.Authorization = `Bearer ${token}`;

    // If body is an object, auto-JSON it
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
    }

    const start = Date.now();
    let res;
    let rawText = '';
    let parsed = null;

    try {
      res = await fetch(API_BASE + url, {
        credentials: 'include',
        ...options,
        method,
        headers,
        body,
      });

      rawText = await res.text();
      parsed = safeJsonParse(rawText);

      addNetworkLog({
        url,
        method,
        status: res.status,
        ok: res.ok,
        requestBody: options.body,
        responseBody: parsed ?? rawText,
        ms: Date.now() - start,
      });

      if (!res.ok) {
        const message =
          (parsed && (parsed.error || parsed.message)) ||
          rawText ||
          `HTTP ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        err.response = parsed ?? rawText;
        throw err;
      }

      return parsed ?? rawText;
    } catch (e) {
      addNetworkLog({
        url,
        method,
        status: res?.status ?? 0,
        ok: false,
        requestBody: options.body,
        responseBody: parsed ?? rawText ?? String(e),
        ms: Date.now() - start,
        error: String(e?.message || e),
      });
      throw e;
    }
  }

  // ---------------- AUTH ----------------
  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    if (data?.token) this.setToken(data.token);
    return data;
  }

  async logout() {
    try { await this.request('/auth/logout', { method: 'POST' }); } catch {}
    this.clearToken();
  }

  // ---------------- SELLING (TRIPS/SLOTS) ----------------
  // Dispatcher + seller use the same slot list logic on the backend.
  // The dispatcher endpoint returns all slots (including completed for filters).
  getTrips() {
    return this.request('/selling/dispatcher/slots');
  }

  getSlots() {
    return this.request('/selling/slots');
  }

  // Boats for sales
  getBoats() {
    return this.request('/selling/boats');
  }

  getBoatSlotsByType(type) {
    return this.request(`/selling/boats/${encodeURIComponent(type)}/slots`);
  }

  // Dispatcher slot management
  getAllDispatcherSlots() {
    return this.request('/selling/dispatcher/slots');
  }

  getAllDispatcherBoats() {
    return this.request('/selling/dispatcher/boats');
  }

  createDispatcherSlot(payload) {
    return this.request('/selling/dispatcher/slots', {
      method: 'POST',
      body: payload,
    });
  }

  updateDispatcherSlot(id, payload) {
    return this.request(`/selling/dispatcher/slots/${id}`, {
      method: 'PATCH',
      body: payload,
    });
  }

  deactivateDispatcherSlot(id, payload) {
    // backend expects { active: 0|1 }
    return this.request(`/selling/dispatcher/slots/${id}/active`, {
      method: 'PATCH',
      body: payload,
    });
  }

  deleteDispatcherSlot(id) {
    return this.request(`/selling/dispatcher/slots/${id}`, { method: 'DELETE' });
  }

  removeTripsForDeletedBoats() {
    // optional endpoint in some builds; safe wrapper
    return this.request('/selling/dispatcher/remove-trips-for-deleted-boats', { method: 'POST' });
  }

  // ---------------- PRESALES ----------------
  createPresale(payload) {
    return this.request('/selling/presales', { method: 'POST', body: payload });
  }

  getPresales() {
    return this.request('/selling/presales');
  }

  // UI helper: presales for конкретного рейса (manual/generated)
  async getPresalesForSlot(slotUidOrId) {
    const all = await this.getPresales();
    const list = Array.isArray(all) ? all : (all?.presales || []);

    const raw = slotUidOrId == null ? '' : String(slotUidOrId);
    const isManualUid = raw.startsWith('manual:');
    const isGeneratedUid = raw.startsWith('generated:');

    let manualId = null;
    if (isManualUid) {
      const n = Number(raw.split(':')[1]);
      manualId = Number.isFinite(n) ? n : null;
    }

    return list.filter((p) => {
      const pSlotUid = String(p?.slot_uid || '');
      const pBoatSlotId = Number(p?.boat_slot_id ?? p?.boatSlotId ?? NaN);

      if (isGeneratedUid) return pSlotUid === raw;
      if (isManualUid) return pSlotUid === raw || (manualId != null && pBoatSlotId === manualId);

      // legacy: numeric id
      const n = Number(raw);
      if (Number.isFinite(n)) return pBoatSlotId === n || pSlotUid === `generated:${n}` || pSlotUid === `manual:${n}`;
      return false;
    });
  }

  getPresalesCancelledTripPending() {
    return this.request('/selling/presales/cancelled-trip-pending');
  }

  getPresale(id) {
    return this.request(`/selling/presales/${id}`);
  }

  // main actions
  acceptPayment(id, payload) {
    // correct route (avoid the legacy /selling/presales/:id/paid duplication)
    return this.request(`/selling/presales/${id}/accept-payment`, { method: 'PATCH', body: payload });
  }

  // Mark presale as "cancelled trip pending" (перенос в отменённые)
  cancelTripPending(id) {
    return this.request(`/selling/presales/${id}/cancel-trip-pending`, { method: 'PATCH' });
  }

  // Transfer whole presale to another рейс
  transferPresaleToSlot(presaleId, toSlotUid) {
    return this.request(`/selling/presales/${presaleId}/transfer`, { method: 'PATCH', body: { to_slot_uid: toSlotUid } });
  }

  markPresalePayment(id, payload) {
    return this.request(`/selling/presales/${id}/payment`, { method: 'PATCH', body: payload });
  }

  cancelPresale(id, payload) {
    return this.request(`/selling/presales/${id}/cancel`, { method: 'PATCH', body: payload });
  }

  movePresale(id, payload) {
    return this.request(`/selling/presales/${id}/move`, { method: 'PATCH', body: payload });
  }

  updatePresaleSeats(id, payload) {
    return this.request(`/selling/presales/${id}/seats`, { method: 'PATCH', body: payload });
  }

  markPresaleUsed(id, payload) {
    return this.request(`/selling/presales/${id}/used`, { method: 'PATCH', body: payload });
  }

  refundPresale(id, payload) {
    return this.request(`/selling/presales/${id}/refund`, { method: 'PATCH', body: payload });
  }

  deletePresale(id, payload) {
    return this.request(`/selling/presales/${id}/delete`, { method: 'PATCH', body: payload });
  }

  getPresaleTickets(presaleId) {
    return this.request(`/selling/presales/${presaleId}/tickets`);
  }

  getSlotTickets(slotId) {
    return this.request(`/selling/slots/${slotId}/tickets`);
  }

  // ---------------- TICKETS ----------------
  markTicketUsed(ticketId, payload) {
    return this.request(`/selling/tickets/${ticketId}/used`, { method: 'PATCH', body: payload });
  }

  refundTicket(ticketId, payload) {
    return this.request(`/selling/tickets/${ticketId}/refund`, { method: 'PATCH', body: payload });
  }

  deleteTicket(ticketId, payload) {
    return this.request(`/selling/tickets/${ticketId}/delete`, { method: 'PATCH', body: payload });
  }

  transferTicket(ticketId, payload) {
    // backend supports POST or PATCH; use PATCH
    return this.request(`/selling/tickets/${ticketId}/transfer`, { method: 'PATCH', body: payload });
  }

  // Back-compat aliases used by some UI files
  markTicketAsUsed(ticketId, payload) {
    return this.markTicketUsed(ticketId, payload);
  }

  transferTicketToSlot(ticketId, toSlotUid) {
    return this.transferTicket(ticketId, { to_slot_uid: toSlotUid });
  }

  // Active рейсы for transfer dropdown
  getAllActiveSlots() {
    return this.getTransferOptions();
  }

  getTransferOptions() {
    return this.request('/selling/transfer-options');
  }

  // ---------------- SCHEDULE TEMPLATES (generated trips) ----------------
  // These endpoints are implemented in schedule-template-items.mjs and mounted at /api/selling.
  getScheduleTemplates() {
    return this.request('/selling/schedule-templates');
  }

  createScheduleTemplate(payload) {
    return this.request('/selling/schedule-templates', { method: 'POST', body: payload });
  }

  updateScheduleTemplate(id, payload) {
    return this.request(`/selling/schedule-templates/${id}`, { method: 'PATCH', body: payload });
  }

  deleteScheduleTemplate(id) {
    return this.request(`/selling/schedule-templates/${id}`, { method: 'DELETE' });
  }

  // Schedule template items (новый UI использует общий список items, без templateId)
  // Поддерживаем оба формата, чтобы ничего не ломать.
  getScheduleTemplateItems(templateId) {
    if (templateId != null) {
      return this.request(`/selling/schedule-templates/${templateId}/items`);
    }
    return this.request('/selling/schedule-template-items');
  }

  createScheduleTemplateItem(templateIdOrPayload, maybePayload) {
    if (typeof templateIdOrPayload === 'number' || (typeof templateIdOrPayload === 'string' && templateIdOrPayload !== '')) {
      const templateId = templateIdOrPayload;
      const payload = maybePayload;
      return this.request(`/selling/schedule-templates/${templateId}/items`, { method: 'POST', body: payload });
    }
    const payload = templateIdOrPayload;
    return this.request('/selling/schedule-template-items', { method: 'POST', body: payload });
  }

  updateScheduleTemplateItem(itemId, payload) {
    return this.request(`/selling/schedule-template-items/${itemId}`, { method: 'PATCH', body: payload });
  }

  deleteScheduleTemplateItem(itemId, deleteFutureTrips) {
    const q = deleteFutureTrips ? '?delete_future_trips=1' : '';
    return this.request(`/selling/schedule-template-items/${itemId}${q}`, { method: 'DELETE' });
  }

  generateSchedule(payload) {
    return this.request('/selling/schedule-template-items/generate', { method: 'POST', body: payload });
  }

  // Alias name used in some UI files
  generateSlotsFromTemplateItems(payload) {
    return this.generateSchedule(payload);
  }

  // ---------------- OWNER ----------------
  getOwnerDashboard() {
    return this.request('/owner/dashboard');
  }
}

export default new ApiClient();