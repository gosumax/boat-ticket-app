import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../utils/apiClient';
import ConfirmBoardingModal from './ConfirmBoardingModal';
import QuickSaleForm from './QuickSaleForm';
import { getSlotAvailable } from '../../utils/slotAvailability';
import { useOwnerData } from '../../contexts/OwnerDataContext';

/**
 * Local helper to generate ticket numbers (fallback if utils/ticketUtils is missing)
 */
function generateTicketNumber(index) {
  const base = Date.now().toString(36).slice(-6).toUpperCase();
  const idx = String(index + 1).padStart(2, '0');
  return `${base}-${idx}`;
}

/**
 * Helper: build ticket types deterministically by index.
 */
function buildTicketTypesFromTickets(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  let adult = 0;
  let teen = 0;
  let child = 0;

  for (const t of list) {
    const tt = String(t?.ticket_type || '').toLowerCase();
    if (tt === 'teen') teen += 1;
    else if (tt === 'child') child += 1;
    else adult += 1;
  }

  // fallback if missing ticket_type
  if (adult === 0 && teen === 0 && child === 0 && list.length > 0) {
    adult = list.length;
  }

  return { adult, teen, child };
}

function safeToInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function formatCurrencyRub(value) {
  const n = safeToInt(value, 0);
  return n.toLocaleString('ru-RU');
}


function getPaymentInfoText(presale) {
  const method = String(presale?.payment_method || '').toUpperCase();
  const cash = safeToInt(presale?.payment_cash_amount, 0);
  const card = safeToInt(presale?.payment_card_amount, 0);

  if (method === 'CASH') {
    const amt = cash > 0 ? cash : safeToInt(presale?.total_price, 0);
    return `Оплачен: Наличка ${formatCurrencyRub(amt)} ₽`;
  }
  if (method === 'CARD') {
    const amt = card > 0 ? card : safeToInt(presale?.total_price, 0);
    return `Оплачен: Карта ${formatCurrencyRub(amt)} ₽`;
  }
  if (method === 'MIXED') {
    const a = cash;
    const b = card;
    if (a > 0 || b > 0) {
      return `Оплачен: Комбо Наличка ${formatCurrencyRub(a)} ₽ + Карта ${formatCurrencyRub(b)} ₽`;
    }
    return 'Оплачен: Комбо';
  }
  return '';
}


function formatPhone(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  return p || '—';
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function buildPassengerLabel(ticket) {
  const name = (ticket?.passenger_name || ticket?.name || '').trim();
  const age = ticket?.age_category;
  const ageLabel =
    age === 'child' ? 'дет' :
    age === 'teen' ? 'подр' :
    age === 'adult' ? 'взр' :
    '';
  const base = name || 'Пассажир';
  return ageLabel ? `${base} (${ageLabel})` : base;
}

function getAgeCategoryLabel(ageCategory) {
  const age = String(ageCategory || '').toLowerCase();
  if (age === 'adult') return 'Взрослый';
  if (age === 'teen') return 'Подростковый';
  if (age === 'child') return 'Детский';
  return '—';
}

function getTicketPrice(ticket, trip) {
  const direct = ticket?.price ?? ticket?.amount ?? ticket?.ticket_price;
  const n = Number(direct);
  if (Number.isFinite(n) && n > 0) return Math.round(n);

  const age = String(ticket?.age_category || '').toLowerCase();
  const pAdult = Number(trip?.price_adult ?? trip?.price ?? 0);
  const pTeen = Number(trip?.price_teen ?? trip?.price ?? 0);
  const pChild = Number(trip?.price_child ?? trip?.price ?? 0);

  if (age === 'teen' && Number.isFinite(pTeen) && pTeen > 0) return Math.round(pTeen);
  if (age === 'child' && Number.isFinite(pChild) && pChild > 0) return Math.round(pChild);
  if (age === 'adult' && Number.isFinite(pAdult) && pAdult > 0) return Math.round(pAdult);

  // last resort: try common fields from backend
  const fallback = Number(ticket?.total_price || 0);
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback);
  return 0;
}

function getPresaleTicketsArray(presaleId, ticketsMap) {
  const entry = ticketsMap?.[presaleId];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry.tickets)) return entry.tickets;
  return [];
}

function enrichTicketWithNumber(ticket, index) {
  if (!ticket) return ticket;
  const existing = ticket.ticket_number || ticket.number;
  if (existing) return ticket;
  return {
    ...ticket,
    ticket_number: generateTicketNumber(index),
  };
}

function normalizeTicketsForPresale(ticketsRaw) {
  const arr = Array.isArray(ticketsRaw) ? ticketsRaw : [];
  return arr.map((t, idx) => enrichTicketWithNumber(t, idx));
}

function getTicketStatus(ticket) {
  return String(ticket?.status || 'ACTIVE');
}

const ALLOWED_PRESALE_STATUSES_FOR_TICKET_OPS = ['ACTIVE', 'PAID'];

const PassengerList = ({ trip, onBack, onClose, refreshAllSlots, shiftClosed }) => {
  const { refreshOwnerData } = useOwnerData();
  const [presales, setPresales] = useState([]);
  const [tickets, setTickets] = useState({});
  const [loading, setLoading] = useState(false);
  const [expandedPresales, setExpandedPresales] = useState({});
  const activeTab = 'active'; // fixed: show only active presales inside рейс
  const [error, setError] = useState(null);

  const [seatsLeft, setSeatsLeft] = useState(() => getSlotAvailable(trip));

  const slotKey = String(trip?.slot_uid ?? trip?.id ?? '');

  useEffect(() => {
    setSeatsLeft(getSlotAvailable(trip));
  }, [trip?.slot_uid, trip?.id, trip?.seats_left, trip?.seatsLeft, trip?.free_seats, trip?.freeSeats]);

  const refreshSeatsLeft = useCallback(async () => {
    try {
      if (!slotKey) return;
      const resp = await apiClient.getAllDispatcherSlots();
      const slots = resp?.data || resp?.slots || resp || [];
      const arr = Array.isArray(slots) ? slots : [];
      const found = arr.find((s) => String(s?.slot_uid ?? s?.id ?? '') === String(slotKey));
      const v = Number(found?.seats_left ?? found?.seatsLeft ?? found?.free_seats ?? found?.freeSeats);
      if (Number.isFinite(v)) setSeatsLeft(v);
    } catch {
      // silent
    }
  }, [slotKey]);


  const reloadInFlightRef = useRef(false);
  const lastReloadAtRef = useRef(0);


  // Transfer modal
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState(null);
  const [transferOptions, setTransferOptions] = useState([]);
  const [transferSelectedSlotUid, setTransferSelectedSlotUid] = useState('');
  const [transferCtx, setTransferCtx] = useState(null);

  // State for boarding confirmation modal
  const [confirmBoardingOpen, setConfirmBoardingOpen] = useState(false);
  const [pendingPresaleGroup, setPendingPresaleGroup] = useState(null);
  const [pendingPassengerId, setPendingPassengerId] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  // Payment method modal for accepting payment (cash / card)
  const [paymentMethodModalOpen, setPaymentMethodModalOpen] = useState(false);
  const [paymentMethodSelected, setPaymentMethodSelected] = useState(null); // 'cash' | 'card' | 'mixed'

  const [mixedCashAmount, setMixedCashAmount] = useState('');
  const [mixedCardAmount, setMixedCardAmount] = useState('');
  const [mixedAmountError, setMixedAmountError] = useState(null);
 // 'cash' | 'card'

  // State for ticket operations
  const [pendingTicketOperation, setPendingTicketOperation] = useState(null); // { ticketId, action }
  const [pendingPresaleOperation, setPendingPresaleOperation] = useState(null); // 'transfer' | 'delete' | 'accept_payment'

  // Quick sale
  const [showQuickSale, setShowQuickSale] = useState(false);

  const enrichTicketsForPresale = useCallback((presale, list) => {
    const ticketsList = normalizeTicketsForPresale(list);
    return ticketsList.map((t, idx) => ({
      ...t,
      ticket_number: t.ticket_number || generateTicketNumber(idx),
      passenger_name: t.passenger_name || t.customer_name || presale?.customer_name || '',
      customer_phone: t.customer_phone || presale?.customer_phone || '',
    }));
  }, []);

  const reloadPresalesAndTickets = useCallback(async () => {
    if (!slotKey) return;

    const now = Date.now();
    if (reloadInFlightRef.current) return;
    if (now - lastReloadAtRef.current < 400) return; // anti-spam

    reloadInFlightRef.current = true;
    lastReloadAtRef.current = now;

    setLoading(true);
    setError(null);

    try {
      const slotUid = slotKey;
      const list = await apiClient.getPresalesForSlot(slotUid);

      const presalesArr = Array.isArray(list) ? list : (list?.presales || []);
      setPresales(presalesArr);

      const ticketsMap = {};
      for (const p of presalesArr) {
        try {
          const t = await apiClient.getPresaleTickets(p.id);
          const tRaw = Array.isArray(t) ? t : (t?.tickets || []);
          ticketsMap[p.id] = {
            tickets: enrichTicketsForPresale(p, tRaw),
            has_missing_tickets: !!t?.has_missing_tickets,
            expected_seats: t?.expected_seats ?? p?.number_of_seats ?? (Array.isArray(tRaw) ? tRaw.length : 0),
          };
        } catch (e) {
          ticketsMap[p.id] = { tickets: [], has_missing_tickets: true, expected_seats: p?.number_of_seats ?? 0 };
        }
      }
      setTickets(ticketsMap);
      await refreshSeatsLeft();
    } catch (error) {
      console.error('Error loading presales:', error);
      setPresales([]);
      setTickets({});
      setError(error?.message || 'Ошибка загрузки данных');
    } finally {
      setLoading(false);
      reloadInFlightRef.current = false;
    }
  }, [slotKey, enrichTicketsForPresale, refreshSeatsLeft]);

  useEffect(() => {
    lastReloadAtRef.current = 0;
        reloadPresalesAndTickets();
        refreshSeatsLeft();
  }, [reloadPresalesAndTickets]);

  const togglePresaleExpanded = (presaleId) => {
    setExpandedPresales(prev => ({ ...prev, [presaleId]: !prev[presaleId] }));
  };

  const openTransferModal = (ctx) => {
    setTransferCtx(ctx);
    setTransferError(null);
    setTransferSelectedSlotUid('');
    setTransferModalOpen(true);
    loadTransferOptions(ctx);
  };

  
  const getSlotUid = (s) => {
    if (!s) return '';
    const direct = s.slot_uid || s.slotUid;
    if (direct) return String(direct);
    const source = s.source_type || s.sourceType;
    const id = s.id ?? s.slot_id ?? s.slotId;
    if (source && (id !== undefined && id !== null)) return `${String(source)}:${String(id)}`;
    if (id !== undefined && id !== null) return `generated:${String(id)}`;
    return '';
  };

const loadTransferOptions = async (ctx) => {
    setTransferLoading(true);

    try {
      // Use existing /api/selling/slots endpoint and build dropdown options on the client
      const resp = await apiClient.getAllDispatcherSlots();
      const slots = resp?.data || resp?.slots || resp || [];

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const formatLocalDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const todayStr = formatLocalDate(now);
      const currentTimeHHMM = now.toTimeString().slice(0, 5);

      const requiredSeats = Number(ctx?.requiredSeats || 1);
      const currentSlotUid = String(ctx?.currentSlotUid || '');

      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      const tomorrowStr = formatLocalDate(tomorrow);

      const options = (Array.isArray(slots) ? slots : [])
        .filter((s) => {
          if (!s) return false;
          if (Number(s.is_active) !== 1) return false;

          const slotUid = String(s.slot_uid || '');
          if (!slotUid) return false;
          if (currentSlotUid && slotUid === currentSlotUid) return false;

          const seatsLeft = Number(s.seats_left ?? s.seats_available ?? 0);
          if (seatsLeft < requiredSeats) return false;

          // time/date filter: don't show рейсы in the past
          const tripDate = s.trip_date ? String(s.trip_date) : null;
          const time = String(s.time || '');

          if (!time) return false;

          if (!tripDate) {
            // manual рейсы are treated as "today"
            return time >= currentTimeHHMM;
          }

          if (tripDate < todayStr) return false;
          if (tripDate === todayStr && time < currentTimeHHMM) return false;

          return true;
        })
        .sort((a, b) => {
          const ad = a.trip_date ? String(a.trip_date) : todayStr;
          const bd = b.trip_date ? String(b.trip_date) : todayStr;
          if (ad !== bd) return ad.localeCompare(bd);
          return String(a.time || '').localeCompare(String(b.time || ''));
        })
        .map((s) => {
          const tripDate = s.trip_date ? String(s.trip_date) : null;
          const time = String(s.time || '');
          const boatName = String(s.boat_name || '');
          const seatsLeft = Number(s.seats_left ?? s.seats_available ?? 0);

          let dayLabel = 'Сегодня';
          if (tripDate) {
            if (tripDate === todayStr) dayLabel = 'Сегодня';
            else if (tripDate === tomorrowStr) dayLabel = 'Завтра';
            else {
              const parts = tripDate.split('-');
              if (parts.length === 3) dayLabel = `${parts[2]}.${parts[1]}`;
              else dayLabel = tripDate;
            }
          }

          return {
            slot_uid: String(s.slot_uid),
            trip_date: tripDate,
            time,
            boat_name: boatName,
            boat_type: s.boat_type,
            duration_minutes: s.duration_minutes,
            seats_left: seatsLeft,
            label: `${dayLabel} ${time} • ${boatName} • свободно ${seatsLeft}`
          };
        });

      setTransferOptions(options);
    } catch (e) {
      setTransferError(e?.message || 'Ошибка загрузки рейсов');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!transferCtx) return;
    if (!transferSelectedSlotUid) {
      setTransferError('Выбери рейс');
      return;
    }

    setTransferLoading(true);
    setTransferError(null);

    try {
      const ctx = transferCtx;
      let response;

      if (ctx.mode === 'PRESALE') {
        response = await apiClient.transferPresaleToSlot(ctx.presaleId, transferSelectedSlotUid);
      } else if (ctx.mode === 'TICKET') {
        response = await apiClient.transferTicketToSlot(ctx.ticketId, transferSelectedSlotUid);
      }

      setTransferModalOpen(false);
      setTransferCtx(null);

      // reload lists
      lastReloadAtRef.current = 0;
      reloadPresalesAndTickets();
      refreshSeatsLeft();
      if (refreshAllSlots) refreshAllSlots();

      // notify dispatcher lists to update cards immediately
      try {
        window.dispatchEvent(new CustomEvent('dispatcher:slots-changed'));
        window.dispatchEvent(new CustomEvent('dispatcher:refresh'));
      } catch (e) {}

      // notify owner dashboard to refresh data
      try {
        refreshOwnerData();
      } catch (e) {}

      // Refresh pending-by-day for affected days if available in response
      try {
        const affectedDays = response?.affected_days;
        console.log('[PassengerList] Transfer response affected_days:', affectedDays);
        console.log('[PassengerList] Full transfer response:', response);
        
        if (affectedDays && (affectedDays.old_day || affectedDays.new_day)) {
          // Normalize ISO dates to day keys (today/tomorrow/day2)
          // IMPORTANT: Use local date formatting, NOT toISOString() which converts to UTC!
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const formatLocalDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          
          const todayStr = formatLocalDate(now);
          const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = formatLocalDate(tomorrow);
          const day2 = new Date(now); day2.setDate(day2.getDate() + 2);
          const day2Str = formatLocalDate(day2);
          
          console.log('[PassengerList] Date mapping:', { todayStr, tomorrowStr, day2Str, old_day: affectedDays.old_day, new_day: affectedDays.new_day });
          
          const dateToKeyMap = { [todayStr]: 'today', [tomorrowStr]: 'tomorrow', [day2Str]: 'day2' };
          
          const daysToRefresh = [];
          if (affectedDays.old_day) {
            const normalizedOld = dateToKeyMap[affectedDays.old_day] || affectedDays.old_day;
            daysToRefresh.push(normalizedOld);
          }
          if (affectedDays.new_day) {
            const normalizedNew = dateToKeyMap[affectedDays.new_day] || affectedDays.new_day;
            daysToRefresh.push(normalizedNew);
          }
          
          // Filter only valid day keys that pending-by-day endpoint accepts
          const validDays = daysToRefresh.filter(d => ['today', 'tomorrow', 'day2'].includes(d));
          
          console.log('[PassengerList] Normalized days to refresh:', validDays, 'from:', daysToRefresh);
          
          if (validDays.length > 0) {
            // Dispatch event with delay to ensure DB transaction is fully committed
            setTimeout(() => {
              console.log('[PassengerList] Dispatching owner:refresh-pending with valid days:', validDays);
              window.dispatchEvent(new CustomEvent('owner:refresh-pending', { detail: { days: validDays } }));
              // Also trigger general owner data refresh
              window.dispatchEvent(new CustomEvent('owner:refresh-data'));
            }, 100);
          }
        }
      } catch (e) {
        console.error('[PassengerList] Error dispatching refresh event:', e);
      }
    } catch (e) {
      setTransferError(e?.message || 'Ошибка переноса');
    } finally {
      setTransferLoading(false);
    }
  };

  const handleOpenTransferForPresale = (presale) => {
    const currentSlotUid = trip?.slot_uid || trip?.id;
    const presaleTickets = getPresaleTicketsArray(presale.id, tickets);

    // Only active seats can be transferred
    const activeSeatsCount = presaleTickets.filter(t => (t?.status || 'ACTIVE') === 'ACTIVE').length;
    const fallbackSeats = Number(presale.number_of_seats || 0) || presaleTickets.length || 0;
    const requiredSeats = Math.max(1, activeSeatsCount || fallbackSeats);

    openTransferModal({
      mode: 'PRESALE',
      presaleId: presale.id,
      currentSlotUid,
      requiredSeats
    });
  };

  const handleAcceptPaymentClick = (presale) => {
    // Accept payment for the entire presale (requires choosing cash/card first)
    if (presale.status !== 'ACTIVE') {
      setPendingPresaleGroup(null);
      setPendingPassengerId(null);
      setPendingTicketOperation(null);
      setConfirmError('Билет недоступен для действия');
      setConfirmBoardingOpen(true);
      return;
    }

    setPendingPresaleGroup(presale);
    setPendingPassengerId(presale.id);
    setPendingPresaleOperation('accept_payment');
    setConfirmError(null);

    // Open payment method picker first (mobile-first)
    setPaymentMethodSelected(null);
          setMixedCashAmount('');
          setMixedCardAmount('');
          setMixedAmountError(null);
    setMixedCashAmount('');
    setMixedCardAmount('');
    setMixedAmountError(null);
    setPaymentMethodModalOpen(true);
  };

  const handleDeletePresaleClick = (presale) => {
    if (presale.status !== 'ACTIVE') {
      setPendingPresaleGroup(null);
      setPendingPassengerId(null);
      setPendingTicketOperation(null);
      setConfirmError('Билет недоступен для действия');
      setConfirmBoardingOpen(true);
      return;
    }
    setPendingPresaleGroup(presale);
    setPendingPassengerId(presale.id);
    setPendingPresaleOperation('delete');
    setConfirmBoardingOpen(true);
    setConfirmError(null);
  };

  const handleTransferPresaleClick = (presale) => {
    if (presale.status !== 'ACTIVE') {
      setPendingPresaleGroup(null);
      setPendingPassengerId(null);
      setPendingTicketOperation(null);
      setConfirmError('Билет недоступен для действия');
      setConfirmBoardingOpen(true);
      return;
    }
    setPendingPresaleGroup(presale);
    setPendingPassengerId(presale.id);
    setPendingPresaleOperation('transfer');
    setConfirmBoardingOpen(true);
    setConfirmError(null);
  };

  const handleTicketOperation = async (ticketId, action) => {
    setConfirmLoading(true);
    setConfirmError(null);

    let presaleForTicket = null;
    let presaleIdForTicket = null;

    // Find presale containing ticket
    for (const [psId, ticketData] of Object.entries(tickets)) {
      const ticketList = ticketData?.tickets || ticketData;
      if (Array.isArray(ticketList) && ticketList.some(t => t?.id == ticketId)) {
        const presale = presales.find(p => p.id == psId);
        if (presale && !ALLOWED_PRESALE_STATUSES_FOR_TICKET_OPS.includes(presale.status)) {
          setConfirmError('Билет недоступен для действия');
          setConfirmLoading(false);
          return;
        }
        presaleForTicket = presale;
        presaleIdForTicket = Number(psId);
        break;
      }
    }

    if (presaleForTicket && !ALLOWED_PRESALE_STATUSES_FOR_TICKET_OPS.includes(presaleForTicket.status)) {
      setConfirmError('Билет недоступен для действия');
      setConfirmLoading(false);
      return;
    }

    // If deleting the LAST ACTIVE ticket of a presale that has prepayment,
    // require dispatcher decision: refund prepay vs send to seasonal fund.
    // NOTE: for partial deletion (2 -> 1), modal must NOT appear and prepay stays on order.
    if (action === 'delete' && presaleForTicket && presaleIdForTicket != null) {
      const prepay = safeToInt(presaleForTicket?.prepayment_amount, 0);
      if (prepay > 0) {
        const presaleTickets = getPresaleTicketsArray(presaleIdForTicket, tickets);
        const activeCnt = presaleTickets.filter(t => getTicketStatus(t) === 'ACTIVE').length;

        if (activeCnt <= 1) {
          // close generic confirm modal and open prepay decision modal
          setConfirmBoardingOpen(false);
          setPendingTicketOperation(null);
          setConfirmLoading(false);
          setPrepayDecisionError(null);
          setPrepayDecisionCtx({ presaleId: presaleIdForTicket, ticketId, prepayAmount: prepay });
          setPrepayDecisionOpen(true);
          return;
        }
      }
    }

    try {
      let updatedTicket;
      if (action === 'use') {
        updatedTicket = await apiClient.markTicketAsUsed(ticketId);
      } else if (action === 'refund') {
        updatedTicket = await apiClient.refundTicket(ticketId);
      } else if (action === 'transfer') {
        // transfer is handled via Transfer Modal (requires destination slot)
        throw new Error('Перенос требует выбора рейса');
      } else if (action === 'delete') {
        updatedTicket = await apiClient.deleteTicket(ticketId);
      }

      // Immediately reload tickets for this presale so UI updates without page refresh
      if (presaleIdForTicket != null) {
        try {
          const fresh = await apiClient.getPresaleTickets(presaleIdForTicket);
          const freshTicketsRaw = Array.isArray(fresh) ? fresh : (fresh?.tickets || []);
          const freshTickets = enrichTicketsForPresale(presaleForTicket, freshTicketsRaw);
          setTickets(prev => {
            const next = { ...prev };
            const prevMeta = next[presaleIdForTicket] || {};
            next[presaleIdForTicket] = {
              ...prevMeta,
              tickets: freshTickets,
              has_missing_tickets: false,
              expected_seats: prevMeta.expected_seats ?? presaleForTicket?.number_of_seats ?? freshTickets.length
            };
            return next;
          });
        } catch (e) {
          // If reloading fails, fall back to optimistic local update
          if (updatedTicket && updatedTicket.id) {
            setTickets(prev => {
              const next = { ...prev };
              const entry = next[presaleIdForTicket];
              const list = entry?.tickets || entry;
              if (Array.isArray(list)) {
                const isRemove = ['refund', 'delete', 'transfer'].includes(action);
                const newList = isRemove
                  ? list.filter(t => t.id !== ticketId)
                  : list.map(t => (t.id === ticketId ? { ...t, ...updatedTicket } : t));
                if (entry && entry.tickets) {
                  next[presaleIdForTicket] = { ...entry, tickets: newList };
                } else {
                  next[presaleIdForTicket] = newList;
                }
              }
              return next;
            });
          }
        }
      }

      setConfirmBoardingOpen(false);
      setPendingTicketOperation(null);
      setConfirmLoading(false);

      // Refresh slots list (seats_left) if needed
      if (refreshAllSlots) refreshAllSlots();

      // refresh current рейс view immediately (header "Свободно" + presales)
      try {
        lastReloadAtRef.current = 0;
        reloadPresalesAndTickets();
        refreshSeatsLeft();
      } catch (e) {}

      // notify dispatcher lists to update cards immediately
      try {
        window.dispatchEvent(new CustomEvent('dispatcher:slots-changed'));
        window.dispatchEvent(new CustomEvent('dispatcher:refresh'));
        // notify owner dashboard to refresh data
        refreshOwnerData();
      } catch (e) {}
    } catch (error) {
      console.error('Error performing ticket operation:', error);
      setConfirmError(error?.message || 'Ошибка операции');
      setConfirmLoading(false);
    }
  };

  const handleTicketActionClick = (ticketId, action) => {
    // Find presale by ticket (to validate status)
    let presaleForTicket = null;
    for (const [psId, ticketData] of Object.entries(tickets)) {
      const ticketList = ticketData?.tickets || ticketData;
      if (Array.isArray(ticketList) && ticketList.some(t => t?.id == ticketId)) {
        presaleForTicket = presales.find(p => p.id == psId);
        break;
      }
    }

    if (presaleForTicket && !ALLOWED_PRESALE_STATUSES_FOR_TICKET_OPS.includes(presaleForTicket.status)) {
      setConfirmError('Билет недоступен для действия');
      setConfirmBoardingOpen(true);
      return;
    }

      // Transfer requires choosing destination trip/slot first
      if (action === 'transfer') {
        const currentSlotUid = trip?.slot_uid || trip?.id;
        openTransferModal({ mode: 'TICKET', ticketId, currentSlotUid, requiredSeats: 1 });
        return;
      }

  setPendingTicketOperation({ ticketId, action });
    setConfirmBoardingOpen(true);
    setConfirmError(null);
  };

  const handleConfirmBoarding = async (decision) => {
    if (pendingTicketOperation) {
      // Handle ticket operation
      const { ticketId, action } = pendingTicketOperation;
      await handleTicketOperation(ticketId, action);
    } else {
      // Handle presale operation
      const idToUse = pendingPassengerId || pendingPresaleGroup?.id;
      if (!idToUse) return;

      // Check if the presale is still active
      const presaleToOperate = presales.find(p => p.id == idToUse);
      if (presaleToOperate && presaleToOperate.status !== 'ACTIVE') {
        setConfirmError('Билет недоступен для действия');
        setConfirmLoading(false);
        return;
      }

      setConfirmLoading(true);
      setConfirmError(null);

      try {
        if (pendingPresaleOperation === 'transfer') {
          await apiClient.cancelTripPending(idToUse);
          setPresales(prev => prev.filter(p => p.id !== Number(idToUse)));
          setTickets(prev => {
            const next = { ...prev };
            delete next[idToUse];
            return next;
          });
        } else if (pendingPresaleOperation === 'delete') {
          const prepay = safeToInt(presaleToOperate?.prepayment_amount, 0);

          // If presale has prepayment, dispatcher must choose what to do (refund vs fund)
          if (prepay > 0) {
            const d = String(decision || '').toUpperCase();
            if (d !== 'REFUND' && d !== 'FUND') {
              setConfirmError('Выбери: вернуть предоплату или отправить в сезонный фонд');
              setConfirmLoading(false);
              return;
            }
            const updatedPresale = await apiClient.deletePresale(idToUse, { decision: d });
            setPresales(prevPresales =>
              prevPresales.filter(presale => presale.id !== updatedPresale.id)
            );
            setTickets(prev => {
              const next = { ...prev };
              delete next[updatedPresale.id];
              return next;
            });
          } else {
            const updatedPresale = await apiClient.deletePresale(idToUse);
            setPresales(prevPresales =>
              prevPresales.filter(presale => presale.id !== updatedPresale.id)
            );
            setTickets(prev => {
              const next = { ...prev };
              delete next[updatedPresale.id];
              return next;
            });
          }
        } else if (pendingPresaleOperation === 'accept_payment') {
          if (!paymentMethodSelected) {
            setConfirmError('Выбери способ оплаты: наличка / карта / комбо');
            setConfirmLoading(false);
            return;
          }

          const payload = { payment_method: paymentMethodSelected };
if (paymentMethodSelected === 'mixed') {
  const cash = Number(String(mixedCashAmount || '').replace(/\s+/g, '').replace(',', '.'));
  const card = Number(String(mixedCardAmount || '').replace(/\s+/g, '').replace(',', '.'));

  if (!Number.isFinite(cash) || !Number.isFinite(card) || cash <= 0 || card <= 0) {
    setMixedAmountError('Укажи суммы для налички и карты');
    setConfirmError('Укажи суммы для налички и карты');
    setConfirmLoading(false);
    return;
  }

  payload.cash_amount = Math.round(cash);
  payload.card_amount = Math.round(card);
}

const updatedPresale = await apiClient.acceptPayment(idToUse, payload);

          // Backends may return either the presale object itself or a wrapper like { presale: {...} }.
          const nextPresale = updatedPresale?.presale ?? updatedPresale;

          // Optimistic update when we have a presale object with id.
          if (nextPresale && nextPresale.id != null) {
            setPresales(prev =>
              prev.map(p => (p.id === Number(nextPresale.id) ? { ...p, ...nextPresale } : p))
            );
          }
        }

        setConfirmBoardingOpen(false);
        setPendingPresaleOperation(null);
        setPendingPresaleGroup(null);
        setPendingPassengerId(null);
        setConfirmLoading(false);
        setPaymentMethodSelected(null);

        // Refresh slots list (seats_left) if needed
        if (refreshAllSlots) refreshAllSlots();

        // refresh current рейс view immediately (header "Свободно" + presales)
        try {
          lastReloadAtRef.current = 0;
          reloadPresalesAndTickets();
          refreshSeatsLeft();
        } catch (e) {}

        // notify dispatcher lists to update cards immediately
        try {
          window.dispatchEvent(new CustomEvent('dispatcher:slots-changed'));
          window.dispatchEvent(new CustomEvent('dispatcher:refresh'));
          // notify owner dashboard to refresh data
          refreshOwnerData();
        } catch (e) {}
      } catch (error) {
        console.error('Error performing presale operation:', error);
        setConfirmError(error?.message || 'Ошибка операции');
        setConfirmLoading(false);
      }
    }
  };

  const filteredPresales = presales.filter(p => {
    const s = String(p.status || 'ACTIVE');
    if (activeTab === 'active') return s !== 'CANCELLED_TRIP_PENDING' && s !== 'CANCELLED' && s !== 'REFUNDED';
    return s === 'CANCELLED_TRIP_PENDING' || s === 'CANCELLED' || s === 'REFUNDED';
  });

  const renderPresaleHeader = (presale) => {
    const presaleTickets = getPresaleTicketsArray(presale.id, tickets);
    const activeTicketsCount = presaleTickets.filter(t => getTicketStatus(t) === 'ACTIVE').length;
    const expectedSeats = safeToInt(presale.number_of_seats, presaleTickets.length);
    const status = String(presale.status || 'ACTIVE');

    const totalPrice = safeToInt(presale.total_price, 0);
    const prepay = safeToInt(presale.prepayment_amount, 0);
    const remaining = Math.max(0, totalPrice - prepay);

    const isActive = status === 'ACTIVE' && remaining > 0;
    const payPct = totalPrice > 0 ? Math.min(100, Math.round((prepay / totalPrice) * 100)) : 0;

    const payLabel = remaining > 0 ? 'Ожидает оплаты' : 'Оплачено';
    const payPill = remaining > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';

    return (
      <div className="bg-neutral-950/40 rounded-2xl  border border-neutral-800 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-800/50 flex items-center justify-center text-neutral-200">
            <span className="text-lg">👤</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-[18px] leading-snug truncate">
                  {presale.customer_name || 'Клиент'}
                </div>
                <div className="mt-0.5 text-sm text-neutral-300 truncate">
                  {formatPhone(presale.customer_phone)}
                </div>
              </div>

              <div className="shrink-0 flex flex-col items-end gap-1">
                <div className="text-xs text-neutral-400">{payPct}%</div>
                <div className="h-2 w-16 bg-neutral-800/50 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${payPct}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs text-neutral-400">{remaining > 0 ? 'Предоплата' : 'Оплачено'}</div>
                <div className="text-sm font-semibold">{formatCurrencyRub(prepay)} ₽</div>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs text-neutral-400">Остаток</div>
                <div className="text-sm font-semibold">{formatCurrencyRub(remaining)} ₽</div>
              </div>
            </div>

            <div className="mt-3 text-sm text-neutral-200 flex flex-wrap gap-x-3 gap-y-1">
              <span>Билетов: <span className="font-semibold">{expectedSeats}</span></span>
              <span className="text-neutral-700">•</span>
              <span>Активно: <span className="font-semibold">{activeTicketsCount}</span></span>
              <span className="text-neutral-700">•</span>
              <span>Сумма: <span className="font-semibold">{formatCurrencyRub(totalPrice)} ₽</span></span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-semibold ${payPill}`}>
                <span>🟠</span>
                <span>{payLabel}</span>
              </div>

              {remaining <= 0 && getPaymentInfoText(presale) && (
                <div className="text-xs text-neutral-400 ml-1">
                  {getPaymentInfoText(presale)}
                </div>
              )}

              {!isActive && (
                <div className="text-xs text-neutral-500">
                  Статус: {status}
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                disabled={!isActive || shiftClosed}
                className={`w-full px-4 py-3 rounded-2xl font-semibold ${
                  !isActive || shiftClosed ? 'bg-gray-200 text-neutral-500' : 'bg-blue-600 text-white'
                }`}
                onClick={() => handleAcceptPaymentClick(presale)}
              >
                Принять оплату
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={!isActive || shiftClosed}
                  className={`px-3 py-3 rounded-2xl font-semibold ${
                    !isActive || shiftClosed ? 'bg-gray-200 text-neutral-500' : 'bg-red-600 text-white'
                  }`}
                  onClick={() => handleDeletePresaleClick(presale)}
                >
                  Удалить билет
                </button>

                <button
                  disabled={!isActive || shiftClosed}
                  className={`px-3 py-3 rounded-2xl font-semibold ${
                    !isActive || shiftClosed ? 'bg-gray-200 text-neutral-500' : 'bg-purple-600 text-white'
                  }`}
                  onClick={() => handleOpenTransferForPresale(presale)}
                >
                  Перенести билет
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <button
            className="text-sm font-semibold text-neutral-200 flex items-center gap-2"
            onClick={() => togglePresaleExpanded(presale.id)}
          >
            <span>Пассажиры ({presaleTickets.length})</span>
            <span className="text-neutral-500">{expandedPresales[presale.id] ? '▲' : '▼'}</span>
          </button>
          {/* Список пассажиров рендерится ниже через renderTickets(presale) */}
        </div>
      </div>
    );
  };

  const renderTickets = (presale) => {
    const entry = tickets[presale.id];
    const list = Array.isArray(entry) ? entry : (entry?.tickets || []);
    const status = String(presale.status || 'ACTIVE');
    const allowTicketOps = ALLOWED_PRESALE_STATUSES_FOR_TICKET_OPS.includes(status);
    const activeCount = Array.isArray(list) ? list.filter(t => getTicketStatus(t) === 'ACTIVE').length : 0;
    // UI правило: если в билете 1 человек — не показываем список пассажиров (и блок кнопок на уровне пассажира)
    if (activeCount <= 1) return null;

    const totalPrice = safeToInt(presale.total_price, 0);
    const prepay = safeToInt(presale.prepayment_amount, 0);
    const remaining = Math.max(0, totalPrice - prepay);
    const presalePaid = remaining <= 0;

    if (!expandedPresales[presale.id]) return null;

    if (!list || list.length === 0) {
      return (
        <div className="mt-3 bg-neutral-950/40 border border-neutral-800 rounded-2xl p-4 text-sm text-neutral-300">
          Пассажиров нет
        </div>
      );
    }

    return (
      <div className="mt-3 space-y-2">
        {presalePaid && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
            Оплачено — перенос и удаление пассажиров недоступны
          </div>
        )}
        {list.map((ticket, idx) => {
          const tStatus = getTicketStatus(ticket);
          const isActive = tStatus === 'ACTIVE';

          return (
            <div
              key={ticket?.id ?? idx}
              className={`bg-neutral-950/40 rounded-2xl  border border-neutral-800 p-3 ${!isActive ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold truncate">
                    {buildPassengerLabel(ticket)}
                  </div>
                  <div className="mt-1 text-sm text-neutral-300 flex flex-wrap gap-x-3 gap-y-1">
                    <span>№ {ticket?.ticket_number || ticket?.number || (ticket?.id ?? idx)}</span>
                    <span className="text-neutral-700">•</span>
                    <span>{tStatus}</span>
                    <span className="text-neutral-700">•</span>
                    <span>{getAgeCategoryLabel(ticket?.age_category)}</span>
                    <span className="text-neutral-700">•</span>
                    <span className="font-semibold">{formatCurrencyRub(getTicketPrice(ticket, trip))} ₽</span>
                  </div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  disabled={presalePaid || !allowTicketOps || shiftClosed || !isActive}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold ${
                    presalePaid || !allowTicketOps || shiftClosed || !isActive ? 'bg-gray-200 text-neutral-500' : 'bg-amber-500 text-white'
                  }`}
                  onClick={() => handleTicketActionClick(ticket.id, 'transfer')}
                >
                  Перенести
                </button>

                <button
                  disabled={presalePaid || !allowTicketOps || shiftClosed || !isActive}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold ${
                    presalePaid || !allowTicketOps || shiftClosed || !isActive ? 'bg-gray-200 text-neutral-500' : 'bg-red-600 text-white'
                  }`}
                  onClick={() => handleTicketActionClick(ticket.id, 'delete')}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (!trip) return null;

  
  // Single source of truth for header counters: seats_left from dispatcher slots API
  const available = Number.isFinite(seatsLeft) ? Math.max(0, seatsLeft) : Math.max(0, Number(getSlotAvailable(trip)) || 0);


  return (
    <div className="h-full min-h-[98vh]">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-neutral-950 border-b border-neutral-900">
        <div className="max-w-[650px] mx-auto p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-[22px] leading-snug truncate">{trip.boat_name || 'Рейс'}</div>
              <div className="mt-1 text-sm text-neutral-300 flex flex-wrap gap-x-3 gap-y-1">
                <span>🕒 {trip.time || '—'}</span>
                <span className="text-neutral-700">•</span>
                <span>📅 {trip.trip_date || '—'}</span>
                <span className="text-neutral-700">•</span>
                <span>Свободно: <span className="font-semibold">{available}</span></span>
              </div>
            </div>

            <button
              className="shrink-0 px-4 py-2 rounded-2xl bg-neutral-800/50 text-neutral-100 font-semibold"
              onClick={() => (onBack || onClose)?.()}
            >
              Назад
            </button>
          </div>

          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3 text-sm">
              {error}
            </div>
          )}

          <div className="mt-3">
            <button
              disabled={shiftClosed}
              className={`w-full px-4 py-3 rounded-2xl font-semibold ${
                shiftClosed ? 'bg-gray-200 text-neutral-500' : 'bg-emerald-600 text-white'
              }`}
              onClick={() => setShowQuickSale(true)}
            >
              Продать билет
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[960px] mx-auto px-4 pb-6 pt-4">
        {loading ? (
          <div className="text-center text-neutral-400">Загрузка...</div>
        ) : (
          <div className="space-y-3">
            {filteredPresales.length === 0 ? (
              <div className="bg-neutral-950/40 border border-neutral-800 rounded-2xl p-4 text-center text-neutral-300">
                Нет билетов
              </div>
            ) : (
              filteredPresales.map((presale) => (
                <div key={presale.id}>
                  {renderPresaleHeader(presale)}
                  {renderTickets(presale)}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {showQuickSale && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full bg-neutral-950/40 rounded-t-2xl p-4 -lg max-h-[90vh] overflow-y-auto">
            <QuickSaleForm
              trip={trip}
              onBack={() => setShowQuickSale(false)}
              onSaleSuccess={() => {
                setShowQuickSale(false);
                lastReloadAtRef.current = 0;
        reloadPresalesAndTickets();
        refreshSeatsLeft();
              }}
              refreshAllSlots={refreshAllSlots}
            />
          </div>
        </div>
      )}

      {transferModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full bg-neutral-950/40 rounded-t-2xl p-4 -lg">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">Перенос</div>
              <button
                className="px-3 py-2 rounded-xl bg-neutral-800/50 text-neutral-200"
                onClick={() => {
                  setTransferModalOpen(false);
                  setTransferCtx(null);
                  setTransferError(null);
                  setTransferSelectedSlotUid('');
                }}
              >
                ✕
              </button>
            </div>

            <div className="mt-3">
              <label className="block text-sm text-neutral-300 mb-1">Выбери рейс</label>
              <select
                className="w-full p-3 rounded-2xl border border-neutral-800 bg-neutral-950/40 text-neutral-100"
                value={transferSelectedSlotUid}
                onChange={(e) => setTransferSelectedSlotUid(e.target.value)}
              >
                <option value="">— Выбрать —</option>
                {transferOptions.map((opt) => (
                  <option key={opt.slot_uid} value={opt.slot_uid}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {transferError && (
              <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3 text-sm">
                {transferError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="px-4 py-3 rounded-2xl bg-neutral-800/50 text-neutral-100 font-semibold"
                onClick={() => {
                  setTransferModalOpen(false);
                  setTransferCtx(null);
                  setTransferError(null);
                  setTransferSelectedSlotUid('');
                }}
              >
                Отмена
              </button>

              <button
                disabled={transferLoading}
                className={`px-4 py-3 rounded-2xl font-semibold ${transferLoading ? 'bg-gray-200 text-neutral-500' : 'bg-blue-600 text-white'}`}
                onClick={handleConfirmTransfer}
              >
                {transferLoading ? '...' : 'Подтвердить перенос'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickSale && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full bg-neutral-950/40 rounded-t-2xl p-4 -lg max-h-[95vh] overflow-auto">
            <QuickSaleForm
              trip={trip}
              onBack={() => setShowQuickSale(false)}
              refreshAllSlots={refreshAllSlots}
              onSaleSuccess={() => {
                setShowQuickSale(false);
                lastReloadAtRef.current = 0;
        reloadPresalesAndTickets();
        refreshSeatsLeft();
              }}
            />
          </div>
        </div>
      )}

      {paymentMethodModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full bg-neutral-950/40 rounded-t-2xl p-4 -lg">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">Способ оплаты</div>
              <button
                className="px-3 py-2 rounded-xl bg-neutral-800/50 text-neutral-200"
                onClick={() => {
                  setPaymentMethodModalOpen(false);
                  setPaymentMethodSelected(null);
                  setMixedCashAmount('');
                  setMixedCardAmount('');
                  setMixedAmountError(null);
                  setPendingPresaleOperation(null);
                  setPendingPresaleGroup(null);
                  setPendingPassengerId(null);
                  setConfirmError(null);
                }}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 text-sm text-neutral-300">
              Выбери, как оплатили этот билет. Это нужно для контроля кассы у овнера.
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <button
                className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl bg-neutral-950/40 border border-neutral-800 "
                onClick={() => {
                  setPaymentMethodSelected('cash');
                  setPaymentMethodModalOpen(false);
                  setConfirmBoardingOpen(true);
                  setConfirmError(null);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">💵</span>
                  <div className="text-left">
                    <div className="font-bold">Наличные</div>
                    <div className="text-sm text-neutral-400">Оплата в кассу</div>
                  </div>
                </div>
                <span className="text-neutral-500">›</span>
              </button>

              <button
                className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl bg-neutral-950/40 border border-neutral-800 "
                onClick={() => {
                  setPaymentMethodSelected('card');
                  setPaymentMethodModalOpen(false);
                  setConfirmBoardingOpen(true);
                  setConfirmError(null);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">💳</span>
                  <div className="text-left">
                    <div className="font-bold">Безнал</div>
                    <div className="text-sm text-neutral-400">Карта / перевод</div>
                  </div>
                </div>
                <span className="text-neutral-500">›</span>
              </button>


              <button
                className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-2xl bg-neutral-950/40 border border-neutral-800 "
                onClick={() => {
                  setPaymentMethodSelected('mixed');
                  setMixedAmountError(null);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">🧾</span>
                  <div className="text-left">
                    <div className="font-bold">Комбо</div>
                    <div className="text-sm text-neutral-400">Часть наличка / часть карта</div>
                  </div>
                </div>
                <span className="text-neutral-500">›</span>
              </button>

              {paymentMethodSelected === 'mixed' && (
                <div className="mt-3 p-3 rounded-2xl bg-neutral-950/40 border border-neutral-800">
                  <div className="text-sm font-semibold mb-2">Введи суммы</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950/40"
                      inputMode="numeric"
                      placeholder="Наличка"
                      value={mixedCashAmount}
                      onChange={(e) => setMixedCashAmount(e.target.value)}
                    />
                    <input
                      className="w-full px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950/40"
                      inputMode="numeric"
                      placeholder="Карта"
                      value={mixedCardAmount}
                      onChange={(e) => setMixedCardAmount(e.target.value)}
                    />
                  </div>

                  {mixedAmountError && (
                    <div className="text-sm text-red-600 mt-2">{mixedAmountError}</div>
                  )}

                  <button
                    className="mt-3 w-full px-4 py-3 rounded-2xl bg-purple-600 text-white font-bold"
                    onClick={() => {
                      setPaymentMethodModalOpen(false);
                      setConfirmBoardingOpen(true);
                      setConfirmError(null);
                    }}
                  >
                    Продолжить
                  </button>
                </div>
              )}

            </div>

            <div className="mt-4 text-xs text-neutral-500">
              {paymentMethodSelected ? `Выбрано: ${paymentMethodSelected}` : ''}
            </div>
          </div>
        </div>
      )}

      {(() => {
        const idToUse = pendingPassengerId || pendingPresaleGroup?.id;
        const presaleToOperate = idToUse ? presales.find(p => p.id == idToUse) : null;
        const prepay = safeToInt(presaleToOperate?.prepayment_amount, 0);
        const mode = (!pendingTicketOperation && pendingPresaleOperation === 'delete' && prepay > 0)
          ? 'prepay_decision'
          : 'boarding';

        return (
          <ConfirmBoardingModal
        open={confirmBoardingOpen}
        onConfirm={handleConfirmBoarding}
        onClose={() => {
          setConfirmBoardingOpen(false);
          setConfirmError(null);
          setPendingTicketOperation(null); // Reset ticket operation
          setPaymentMethodSelected(null);
        }}
        loading={confirmLoading}
        error={confirmError}
        mode={mode}
        prepayAmount={prepay}
          />
        );
      })()}
    </div>
  );
}

export default PassengerList;