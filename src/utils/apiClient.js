// src/utils/apiClient.js
import { addNetworkLog } from './bugReporter';
import {
  getLocalStorageSafe,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from './safeWebStorage.js';

const API_BASE = '/api';

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function unwrapTelegramRouteOperationResult(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const summary = response.operation_result_summary;
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
      return summary;
    }
  }
  return response;
}

class ApiClient {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
    const storage = getLocalStorageSafe();
    setStorageItemSafe(storage, 'token', token);
  }

  clearToken() {
    this.token = null;
    const storage = getLocalStorageSafe();
    removeStorageItemSafe(storage, 'token');
    removeStorageItemSafe(storage, 'authToken');
    removeStorageItemSafe(storage, 'jwt');
  }

  async request(url, options = {}) {
    const method = options.method || 'GET';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    const storage = getLocalStorageSafe();
    const token =
      this.token ||
      getStorageItemSafe(storage, 'token') ||
      getStorageItemSafe(storage, 'authToken') ||
      getStorageItemSafe(storage, 'jwt');
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
          (parsed &&
            (
              parsed.error ||
              parsed.message ||
              parsed.rejection_reason ||
              parsed.rejectionReason
            )) ||
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

  getCurrentUser() {
    return this.request('/auth/me');
  }

  // Generic legacy getter used by some screens.
  get(url) {
    const normalizedUrl = url === '/users' ? '/admin/users' : url;
    return this.request(normalizedUrl);
  }

  // ---------------- ADMIN ----------------
  getSellers() {
    return this.request('/admin/users?role=seller');
  }

  createUser(payload) {
    return this.request('/admin/users', { method: 'POST', body: payload });
  }

  updateUser(id, payload) {
    return this.request(`/admin/users/${id}`, { method: 'PATCH', body: payload });
  }

  deleteUser(id) {
    return this.request(`/admin/users/${id}`, { method: 'DELETE' });
  }

  resetPassword(id, password) {
    return this.request(`/admin/users/${id}/reset-password`, { method: 'POST', body: { password } });
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
  getBoats(showArchived = false) {
    const q = showArchived ? '?showArchived=true' : '';
    return this.request(`/admin/boats${q}`);
  }

  getBoatSlotsByType(type) {
    return this.request(`/selling/boats/${encodeURIComponent(type)}/slots`);
  }

  getBoatSlots(boatId) {
    return this.request(`/admin/boats/${boatId}/slots`);
  }

  createBoat(payload) {
    return this.request('/admin/boats', { method: 'POST', body: payload });
  }

  async updateBoat(id, payload) {
    const res = await this.request(`/admin/boats/${id}`, { method: 'PUT', body: payload });
    return res?.boat || res;
  }

  toggleBoatActive(id, isActive) {
    return this.request(`/admin/boats/${id}/active`, {
      method: 'PATCH',
      body: { is_active: isActive ? 1 : 0 },
    });
  }

  deleteBoat(id) {
    return this.request(`/admin/boats/${id}`, { method: 'DELETE' });
  }

  createBoatSlot(boatId, payload) {
    return this.request(`/admin/boats/${boatId}/slots`, { method: 'POST', body: payload });
  }

  toggleBoatSlotActive(slotId, isActive) {
    return this.request(`/selling/dispatcher/slots/${slotId}/active`, {
      method: 'PATCH',
      body: { active: isActive ? 1 : 0 },
    });
  }

  getWorkingZone() {
    return this.request('/admin/settings/working-zone');
  }

  saveWorkingZone(payload) {
    return this.request('/admin/settings/working-zone', { method: 'PUT', body: payload });
  }

  async clearAllTrips() {
    const response = await this.request('/selling/trips-for-deleted-boats', { method: 'DELETE' });
    if (response && !response.deleted) {
      return {
        ...response,
        deleted: {
          generated_slots: Number(response.deleted_generated || 0),
          boat_slots: Number(response.deleted_manual || 0),
        },
      };
    }
    return response;
  }

  // Dispatcher slot management
  getAllDispatcherSlots() {
    return this.request('/selling/dispatcher/slots');
  }

  lookupDispatcherTicket(query) {
    const normalizedQuery = String(query ?? '').trim();
    return this.request(`/selling/dispatcher/ticket-lookup?query=${encodeURIComponent(normalizedQuery)}`);
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
    return this.request('/selling/trips-for-deleted-boats', { method: 'DELETE' });
  }

  // ---------------- PRESALES ----------------
  createPresale(payload) {
    return this.request('/selling/presales', { method: 'POST', body: payload });
  }

  getPresales() {
    return this.request('/selling/presales');
  }

  getSellerDashboard() {
    return this.request('/selling/seller-dashboard');
  }

  getSellerDashboardWeekly() {
    return this.request('/selling/seller-dashboard/weekly');
  }

  getSellerDashboardSeason() {
    return this.request('/selling/seller-dashboard/season');
  }

  // UI helper: presales for конкретного рейса (manual/generated)
  async getPresalesForSlot(slotUidOrId) {
    const raw = slotUidOrId == null ? '' : String(slotUidOrId);
    const params = new URLSearchParams();
    if (raw) {
      params.set('slot_uid', raw);
      if (raw.startsWith('manual:')) {
        const manualId = Number(raw.split(':')[1]);
        if (Number.isFinite(manualId)) params.set('boat_slot_id', String(manualId));
      } else if (!raw.startsWith('generated:')) {
        const numericId = Number(raw);
        if (Number.isFinite(numericId)) params.set('boat_slot_id', String(numericId));
      }
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const all = await this.request(`/selling/presales${query}`);
    const list = Array.isArray(all) ? all : (all?.presales || []);

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
    return this.request(`/selling/slots/${encodeURIComponent(slotId)}/tickets`);
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
    const q = deleteFutureTrips ? '?deleteFutureTrips=true' : '';
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

  getOwnerSellersList() {
    return this.request('/owner/sellers/list');
  }

  // ---------------- TELEGRAM OWNER MANUAL FALLBACK ----------------
  getOwnerTelegramManualFallbackQueue({ limit, queueState } = {}) {
    const params = new URLSearchParams();
    const normalizedLimit = Number(limit);
    if (Number.isInteger(normalizedLimit) && normalizedLimit > 0) {
      params.set('limit', String(normalizedLimit));
    }
    if (queueState) {
      params.set('queue_state', String(queueState));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/telegram/owner/manual-fallback/queue${query}`);
  }

  getOwnerTelegramManualFallbackRequestStatesActive({ limit } = {}) {
    const normalizedLimit = Number(limit);
    const query =
      Number.isInteger(normalizedLimit) && normalizedLimit > 0
        ? `?limit=${normalizedLimit}`
        : '';
    return this.request(`/telegram/owner/manual-fallback/request-states/active${query}`);
  }

  getOwnerTelegramManualFallbackRequestState(bookingRequestId) {
    return this.request(
      `/telegram/owner/manual-fallback/request-states/${encodeURIComponent(bookingRequestId)}`
    );
  }

  recordOwnerTelegramManualFallbackAction({
    bookingRequestId,
    actionType,
    idempotencyKey,
    actionPayload = {},
  }) {
    return this.request(
      `/telegram/owner/manual-fallback/queue/${encodeURIComponent(bookingRequestId)}/actions`,
      {
        method: 'POST',
        body: {
          action_type: actionType,
          idempotency_key: idempotencyKey,
          action_payload: actionPayload,
        },
      }
    );
  }

  // ---------------- TELEGRAM LIVE SMOKE PILOT ----------------
  async getTelegramLiveSmokePilotChecklist({ pilotRunReference } = {}) {
    const params = new URLSearchParams();
    if (pilotRunReference) {
      params.set('pilot_run_reference', String(pilotRunReference));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/smoke-pilot/checklist${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async captureTelegramLiveSmokePilotResults({
    pilotRunReference,
    scenarioResults = [],
  } = {}) {
    const response = await this.request('/telegram/smoke-pilot/report', {
      method: 'POST',
      body: {
        pilot_run_reference: pilotRunReference,
        scenario_results: Array.isArray(scenarioResults) ? scenarioResults : [],
      },
    });
    return unwrapTelegramRouteOperationResult(response);
  }

  // ---------------- TELEGRAM SELLER QUEUE ----------------
  getSellerTelegramWorkQueue({ limit } = {}) {
    const normalizedLimit = Number(limit);
    const query = Number.isInteger(normalizedLimit) && normalizedLimit > 0
      ? `?limit=${normalizedLimit}`
      : '';
    return this.request(`/telegram/seller/work-queue${query}`);
  }

  recordSellerTelegramWorkQueueAction({
    bookingRequestId,
    actionType,
    idempotencyKey,
    actionPayload = {},
  }) {
    return this.request(`/telegram/seller/work-queue/${encodeURIComponent(bookingRequestId)}/actions`, {
      method: 'POST',
      body: {
        action_type: actionType,
        idempotency_key: idempotencyKey,
        action_payload: actionPayload,
      },
    });
  }

  // ---------------- TELEGRAM ADMIN CONTENT MANAGEMENT ----------------
  async getTelegramAdminServiceMessageTemplates({ templateType, enabled } = {}) {
    const params = new URLSearchParams();
    if (templateType) {
      params.set('template_type', String(templateType));
    }
    if (enabled === true || enabled === false) {
      params.set('enabled', enabled ? 'true' : 'false');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/service-message-templates${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminServiceMessageTemplate(templateReference) {
    const response = await this.request(
      `/telegram/admin/service-message-templates/${encodeURIComponent(templateReference)}`
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async updateTelegramAdminServiceMessageTemplate(templateReference, payload) {
    const response = await this.request(
      `/telegram/admin/service-message-templates/${encodeURIComponent(templateReference)}`,
      {
        method: 'PATCH',
        body: payload,
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async setTelegramAdminServiceMessageTemplateEnabled(
    templateReference,
    { enabled, expectedVersion = null } = {}
  ) {
    const action = enabled ? 'enable' : 'disable';
    const body = {};
    if (expectedVersion !== null && expectedVersion !== undefined) {
      body.expected_version = expectedVersion;
    }
    const response = await this.request(
      `/telegram/admin/service-message-templates/${encodeURIComponent(templateReference)}/${action}`,
      {
        method: 'POST',
        body,
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminManagedContent({ contentGroups } = {}) {
    const params = new URLSearchParams();
    const groups = Array.isArray(contentGroups)
      ? contentGroups.filter(Boolean)
      : contentGroups
        ? [contentGroups]
        : [];
    for (const group of groups) {
      params.append('content_group', String(group));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/managed-content${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminManagedContentItem(contentReference) {
    const response = await this.request(
      `/telegram/admin/managed-content/${encodeURIComponent(contentReference)}`
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async updateTelegramAdminManagedContentItem(contentReference, payload) {
    const response = await this.request(
      `/telegram/admin/managed-content/${encodeURIComponent(contentReference)}`,
      {
        method: 'PATCH',
        body: payload,
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async setTelegramAdminManagedContentEnabled(
    contentReference,
    { enabled, expectedVersion = null } = {}
  ) {
    const action = enabled ? 'enable' : 'disable';
    const body = {};
    if (expectedVersion !== null && expectedVersion !== undefined) {
      body.expected_version = expectedVersion;
    }
    const response = await this.request(
      `/telegram/admin/managed-content/${encodeURIComponent(contentReference)}/${action}`,
      {
        method: 'POST',
        body,
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminFaq({ contentGrouping } = {}) {
    const params = new URLSearchParams();
    const groups = Array.isArray(contentGrouping)
      ? contentGrouping.filter(Boolean)
      : contentGrouping
        ? [contentGrouping]
        : [];
    for (const group of groups) {
      params.append('content_grouping', String(group));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/faq${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminUsefulContentFeed({ contentGrouping } = {}) {
    const params = new URLSearchParams();
    const groups = Array.isArray(contentGrouping)
      ? contentGrouping.filter(Boolean)
      : contentGrouping
        ? [contentGrouping]
        : [];
    for (const group of groups) {
      params.append('content_grouping', String(group));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/useful-content${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  // ---------------- TELEGRAM ADMIN SOURCE/QR MANAGEMENT ----------------
  async getTelegramAdminSourceRegistryItems({ sourceFamily, enabled } = {}) {
    const params = new URLSearchParams();
    if (sourceFamily) {
      params.set('source_family', String(sourceFamily));
    }
    if (enabled === true || enabled === false) {
      params.set('enabled', enabled ? 'true' : 'false');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/source-registry${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceRegistryItem(sourceReference) {
    const response = await this.request(
      `/telegram/admin/source-registry/${encodeURIComponent(sourceReference)}`
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async createTelegramAdminSourceRegistryItem(payload) {
    const response = await this.request('/telegram/admin/source-registry', {
      method: 'POST',
      body: payload,
    });
    return unwrapTelegramRouteOperationResult(response);
  }

  async updateTelegramAdminSourceRegistryItem(sourceReference, payload) {
    const response = await this.request(
      `/telegram/admin/source-registry/${encodeURIComponent(sourceReference)}`,
      {
        method: 'PATCH',
        body: payload,
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async setTelegramAdminSourceRegistryItemEnabled(sourceReference, { enabled } = {}) {
    const action = enabled ? 'enable' : 'disable';
    const response = await this.request(
      `/telegram/admin/source-registry/${encodeURIComponent(sourceReference)}/${action}`,
      {
        method: 'POST',
      }
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceQrExportPayload(sourceReference) {
    const response = await this.request(
      `/telegram/admin/source-registry/${encodeURIComponent(sourceReference)}/qr-export-payload`
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceQrExportPayloads() {
    const response = await this.request('/telegram/admin/source-registry/qr-export-payloads');
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceAnalyticsSummaries({ enabled } = {}) {
    const params = new URLSearchParams();
    if (enabled === true || enabled === false) {
      params.set('enabled', enabled ? 'true' : 'false');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request(`/telegram/admin/source-analytics${query}`);
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceAnalyticsReport(sourceReference) {
    const response = await this.request(
      `/telegram/admin/source-analytics/${encodeURIComponent(sourceReference)}`
    );
    return unwrapTelegramRouteOperationResult(response);
  }

  async getTelegramAdminSourceAnalyticsFunnelSummary() {
    const response = await this.request('/telegram/admin/source-analytics/funnel-summary');
    return unwrapTelegramRouteOperationResult(response);
  }
}

export default new ApiClient();
