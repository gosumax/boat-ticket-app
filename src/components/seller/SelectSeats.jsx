import { useEffect, useState } from 'react';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';
import {
  SellerHeroPanel,
  SellerInset,
  SellerSurface,
  sellerButtonClass,
  sellerChipClass,
  sellerFieldLabelClass,
  sellerInputClass,
  sellerSegmentClass,
} from './sellerUi';

function CounterCard({
  label,
  value,
  minusTestId,
  valueTestId,
  plusTestId,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 text-center shadow-[0_16px_28px_-24px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-4 inline-flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onDecrement}
          data-testid={minusTestId}
          disabled={!canDecrement}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-2xl font-semibold text-slate-900 ring-1 ring-slate-200 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span data-testid={valueTestId} className="w-10 text-center text-3xl font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">
          {value}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          data-testid={plusTestId}
          disabled={!canIncrement}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-2xl font-semibold text-white shadow-[0_18px_30px_-22px_rgba(15,23,42,0.75)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PriceRow({ label, value, tone = 'default' }) {
  const accentClass =
    tone === 'accent'
      ? 'text-sky-950 bg-sky-50 ring-sky-200'
      : 'text-slate-900 bg-slate-50 ring-slate-200';

  return (
    <div className={`flex items-center justify-between rounded-2xl px-3 py-3 ring-1 ${accentClass}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function FieldError({ children }) {
  if (!children) return null;

  return <p className="mt-2 text-sm text-rose-600">{children}</p>;
}

const QUICK_NAMES = ['Алексей', 'Дмитрий', 'Иван', 'Анна', 'Мария', 'Елена'];
const PREPAYMENT_PRESETS = [500, 1000, 2000];

const SelectSeats = ({
  trip,
  onConfirm,
  onBack,
  numberOfSeats,
  setNumberOfSeats,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  prepaymentStr,
  setPrepaymentStr,
  prepaymentMethod,
  setPrepaymentMethod,
  prepaymentCashStr,
  setPrepaymentCashStr,
  prepaymentCardStr,
  setPrepaymentCardStr,
  prepaymentMethodError,
  setPrepaymentMethodError,
  validateCustomerInputs,
  apiUrl,
  lastError,
  isSubmitting,
}) => {
  const [seats, setSeats] = useState(numberOfSeats || 1);
  const [ticketBreakdown, setTicketBreakdown] = useState({ adult: 0, teen: 0, child: 0 });
  const [localCustomerName, setLocalCustomerName] = useState(customerName || '');
  const [localCustomerPhone, setLocalCustomerPhone] = useState(customerPhone || '');
  const [localPrepaymentStr, setLocalPrepaymentStr] = useState(prepaymentStr || '');
  const [errors, setErrors] = useState({});
  const [prepaymentError, setPrepaymentError] = useState('');
  const [touched, setTouched] = useState({
    customerName: false,
    customerPhone: false,
  });
  const isBananaTrip = trip?.boat_type === 'banana';
  const maxSeats = getSlotAvailable(trip);
  const selectedSeatsTotal =
    (ticketBreakdown.adult ?? 0) + (ticketBreakdown.teen ?? 0) + (ticketBreakdown.child ?? 0);

  useEffect(() => {
    setSeats(numberOfSeats || 1);
  }, [numberOfSeats]);

  useEffect(() => {
    const total = (ticketBreakdown.adult ?? 0) + (ticketBreakdown.teen ?? 0) + (ticketBreakdown.child ?? 0);
    setSeats(total);
    if (setNumberOfSeats) {
      setNumberOfSeats(total);
    }
  }, [ticketBreakdown, setNumberOfSeats]);

  useEffect(() => {
    if (!isBananaTrip) return;
    if ((ticketBreakdown?.teen ?? 0) === 0) return;
    setTicketBreakdown((prev) => ({ ...prev, teen: 0 }));
  }, [isBananaTrip, ticketBreakdown?.teen]);

  useEffect(() => {
    setLocalCustomerName(customerName || '');
  }, [customerName]);

  useEffect(() => {
    setLocalCustomerPhone(customerPhone || '');
  }, [customerPhone]);

  useEffect(() => {
    setLocalPrepaymentStr(prepaymentStr || '');
  }, [prepaymentStr]);

  const incrementTicket = (type) => {
    if (!type) return;
    const total = (ticketBreakdown.adult ?? 0) + (ticketBreakdown.teen ?? 0) + (ticketBreakdown.child ?? 0);
    if (trip?.boat_type === 'banana' && type === 'teen') return;
    if (total < maxSeats) {
      setTicketBreakdown((prev) => ({
        ...prev,
        [type]: (prev[type] ?? 0) + 1,
      }));
    }
  };

  const decrementTicket = (type) => {
    if (!type) return;
    setTicketBreakdown((prev) => {
      const cur = prev[type] ?? 0;
      if (cur > 0) return { ...prev, [type]: cur - 1 };
      return prev;
    });
  };

  const handleNameChange = (event) => {
    const value = event.target.value;
    setLocalCustomerName(value);
    if (setCustomerName) {
      setCustomerName(value);
    }
    if (touched.customerName && errors.customerName) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.customerName;
        return next;
      });
    }
  };

  const handlePhoneChange = (event) => {
    const value = event.target.value;
    setLocalCustomerPhone(value);
    if (setCustomerPhone) {
      setCustomerPhone(value);
    }
    if (touched.customerPhone && errors.customerPhone) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.customerPhone;
        return next;
      });
    }
  };

  const resetPrepaymentMethodState = () => {
    if (setPrepaymentMethod) setPrepaymentMethod(null);
    if (setPrepaymentMethodError) setPrepaymentMethodError('');
    if (setPrepaymentCashStr) setPrepaymentCashStr('');
    if (setPrepaymentCardStr) setPrepaymentCardStr('');
  };

  const handlePrepaymentChange = (event) => {
    const value = event.target.value;
    setLocalPrepaymentStr(value);
    if (setPrepaymentStr) {
      setPrepaymentStr(value);
    }
    setPrepaymentError('');
    resetPrepaymentMethodState();
  };

  const handleQuickName = (value) => {
    setLocalCustomerName(value);
    if (setCustomerName) setCustomerName(value);
  };

  const handleQuickPrepayment = (value) => {
    const next = String(value);
    setLocalPrepaymentStr(next);
    if (setPrepaymentStr) setPrepaymentStr(next);
    resetPrepaymentMethodState();
  };

  const handleConfirm = () => {
    if (window.__debugPushAction) {
      window.__debugPushAction({
        type: 'PRESALE_CLICK',
        payload: {
          slotUid: trip?.slot_uid,
          numberOfSeats: seats,
          customerName: localCustomerName,
          customerPhone: localCustomerPhone,
        },
        ts: new Date().toISOString(),
      });
    }

    try {
      setTouched({
        customerName: true,
        customerPhone: true,
      });

      const validationErrors = validateCustomerInputs ? validateCustomerInputs() : {};
      setErrors(validationErrors);

      if (Object.keys(validationErrors).length > 0) {
        if (window.__debugPushAction) {
          window.__debugPushAction({
            type: 'API_ERROR',
            payload: {
              status: 0,
              code: 'VALIDATION_BLOCKED',
              message: 'Form validation failed',
              debug: validationErrors,
            },
            ts: new Date().toISOString(),
          });
        }
        return;
      }

      if (typeof onConfirm === 'function') {
        if (onConfirm.length >= 3) {
          onConfirm(seats, ticketBreakdown, totalPrice);
        } else {
          onConfirm({
            seats,
            ticketBreakdown,
            totalPrice,
            numberOfSeats: seats,
            tickets: ticketBreakdown,
          });
        }
      }
    } catch (error) {
      if (window.__debugPushAction) {
        window.__debugPushAction({
          type: 'API_ERROR',
          payload: {
            status: 0,
            code: 'FRONTEND_PRE_REQUEST',
            message: error.message,
            stack: error.stack,
          },
          ts: new Date().toISOString(),
        });
      }
      console.error('Error in handleConfirm:', error);
    }
  };

  const totalPrice = trip
    ? ticketBreakdown.adult * (trip.price_adult || trip.price) +
      ticketBreakdown.teen * (trip.price_teen || trip.price) +
      ticketBreakdown.child * (trip.price_child || trip.price)
    : 0;

  const prepaymentAmount = parseFloat(localPrepaymentStr) || 0;
  const remainingAmount = Math.max(0, totalPrice - prepaymentAmount);
  const isPrepaymentValid = prepaymentAmount <= totalPrice && prepaymentAmount >= 0;

  const isFormValid = (() => {
    const hasName = localCustomerName && localCustomerName.trim().length >= 2;
    const phoneDigits = localCustomerPhone.replace(/\D/g, '');
    const hasValidPhone = phoneDigits.length === 11;
    const hasValidSeats = seats >= 1;
    const hasValidTicketBreakdown = !isBananaTrip || ticketBreakdown.teen === 0;

    return hasName && hasValidPhone && hasValidSeats && isPrepaymentValid && hasValidTicketBreakdown;
  })();

  useEffect(() => {
    if (prepaymentAmount > totalPrice && totalPrice > 0) {
      setPrepaymentError('Предоплата не может быть больше суммы заказа');
    } else if (prepaymentAmount < 0) {
      setPrepaymentError('Предоплата не может быть отрицательной');
    } else {
      setPrepaymentError('');
    }
  }, [prepaymentAmount, totalPrice]);

  return (
    <div className="space-y-3" data-testid="seller-select-seats-screen">
      <SellerSurface>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Клиент, места и оплата</h2>
        </div>

        <div className="mt-4 grid gap-3">
          <SellerInset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Рейс</div>
                <div className="mt-1 text-lg font-semibold leading-6 tracking-[-0.01em] text-slate-950">
                  {trip?.boat_name || '—'}
                </div>
              </div>
              <span className="rounded-2xl bg-slate-950 px-3 py-1.5 text-lg font-semibold leading-none text-white shadow-[0_16px_28px_-20px_rgba(15,23,42,0.85)]">
                {trip?.time || '—'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
              {trip?.trip_date ? (
                <span className="rounded-full bg-slate-950/5 px-3 py-1 font-semibold text-slate-800 ring-1 ring-slate-200">
                  {trip.trip_date}
                </span>
              ) : null}
              {trip?.duration ? (
                <span className="rounded-full bg-white px-3 py-1 font-medium ring-1 ring-slate-200">Длительность: {trip.duration}</span>
              ) : null}
              <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200">
                Свободно: {maxSeats}
              </span>
            </div>

            {trip?.boat_type === 'banana' ? (
              <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                Банан: только взрослый и детский билет, подростковая категория здесь недоступна.
              </div>
            ) : null}
          </SellerInset>
        </div>
      </SellerSurface>

      <SellerSurface>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Количество мест</h3>
          </div>
          <span
            data-testid="seller-seats-total-count"
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-slate-950 px-3 text-lg font-semibold text-white shadow-[0_16px_28px_-20px_rgba(15,23,42,0.8)]"
          >
            {selectedSeatsTotal}
          </span>
        </div>

        <div className={`mt-4 grid gap-3 ${isBananaTrip ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <CounterCard
            label="Взрослый"
            value={ticketBreakdown.adult}
            minusTestId="seller-seats-adult-minus"
            valueTestId="seller-seats-adult-value"
            plusTestId="seller-seats-adult-plus"
            onDecrement={() => decrementTicket('adult')}
            onIncrement={() => incrementTicket('adult')}
            canDecrement={ticketBreakdown.adult > 0}
            canIncrement={ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child < maxSeats}
          />

          {!isBananaTrip ? (
            <CounterCard
              label="Подросток"
              value={ticketBreakdown.teen}
              minusTestId="seller-seats-teen-minus"
              valueTestId="seller-seats-teen-value"
              plusTestId="seller-seats-teen-plus"
              onDecrement={() => decrementTicket('teen')}
              onIncrement={() => incrementTicket('teen')}
              canDecrement={ticketBreakdown.teen > 0}
              canIncrement={ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child < maxSeats}
            />
          ) : null}

          <CounterCard
            label="Детский"
            value={ticketBreakdown.child}
            minusTestId="seller-seats-child-minus"
            valueTestId="seller-seats-child-value"
            plusTestId="seller-seats-child-plus"
            onDecrement={() => decrementTicket('child')}
            onIncrement={() => incrementTicket('child')}
            canDecrement={ticketBreakdown.child > 0}
            canIncrement={ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child < maxSeats}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <SellerInset>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">Стоимость билетов</div>
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">за 1 место</span>
            </div>
            <div className="mt-3 space-y-2">
              <PriceRow label="Взрослый" value={formatRUB(trip?.price_adult || trip?.price)} />
              {!isBananaTrip ? <PriceRow label="Подросток" value={formatRUB(trip?.price_teen || trip?.price)} /> : null}
              <PriceRow label="Детский" value={formatRUB(trip?.price_child || trip?.price)} />
            </div>
          </SellerInset>

          <SellerHeroPanel className="py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">Итог по местам</div>
            <div className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.04em] text-white">{formatRUB(totalPrice)}</div>
            <p className="mt-3 text-sm leading-5 text-slate-200">Максимум доступно: {maxSeats} мест. После выбора итог пересчитывается автоматически.</p>
          </SellerHeroPanel>
        </div>
      </SellerSurface>

      <SellerSurface>
        <h3 className="text-lg font-semibold text-slate-900">Информация о клиенте</h3>

        <div className="mt-4">
          <label className={sellerFieldLabelClass} htmlFor="customerName">
            Имя клиента
          </label>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleQuickName(name)}
                className={sellerChipClass({ active: localCustomerName === name, tone: 'accent' })}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            id="customerName"
            type="text"
            data-testid="seller-customer-name-input"
            value={localCustomerName}
            onChange={handleNameChange}
            onBlur={() => setTouched((prev) => ({ ...prev, customerName: true }))}
            className={sellerInputClass()}
            placeholder="Введите имя"
          />
          <FieldError>{touched.customerName && errors.customerName ? errors.customerName : ''}</FieldError>
        </div>

        <div className="mt-4">
          <label className={sellerFieldLabelClass} htmlFor="customerPhone">
            Телефон клиента
          </label>
          <input
            id="customerPhone"
            type="tel"
            data-testid="seller-customer-phone-input"
            value={localCustomerPhone}
            onChange={handlePhoneChange}
            onBlur={() => setTouched((prev) => ({ ...prev, customerPhone: true }))}
            className={sellerInputClass()}
            placeholder="+7 9xx xxx-xx-xx"
          />
          <FieldError>{touched.customerPhone && errors.customerPhone ? errors.customerPhone : ''}</FieldError>
        </div>

        <div className="mt-4">
          <label className={sellerFieldLabelClass} htmlFor="prepayment">
            Предоплата (₽)
          </label>
          <div className="mb-3 flex flex-wrap gap-2">
            {PREPAYMENT_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => handleQuickPrepayment(value)}
                className={sellerChipClass({ active: Number(localPrepaymentStr || 0) === value, tone: 'warning' })}
              >
                {value} ₽
              </button>
            ))}
          </div>
          <input
            id="prepayment"
            type="number"
            data-testid="seller-prepayment-input"
            value={localPrepaymentStr}
            onChange={handlePrepaymentChange}
            className={sellerInputClass('no-spin')}
            placeholder="0"
            min="0"
          />
          <FieldError>{prepaymentError}</FieldError>

          {Number(localPrepaymentStr || 0) > 0 ? (
            <div className="mt-4">
              <div className={sellerFieldLabelClass}>Способ оплаты предоплаты</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  data-testid="seller-prepayment-method-cash"
                  onClick={() => {
                    if (setPrepaymentMethod) setPrepaymentMethod('cash');
                    if (setPrepaymentMethodError) setPrepaymentMethodError('');
                    if (setPrepaymentCashStr) setPrepaymentCashStr('');
                    if (setPrepaymentCardStr) setPrepaymentCardStr('');
                  }}
                  className={sellerSegmentClass(prepaymentMethod === 'cash')}
                >
                  Нал
                </button>
                <button
                  type="button"
                  data-testid="seller-prepayment-method-card"
                  onClick={() => {
                    if (setPrepaymentMethod) setPrepaymentMethod('card');
                    if (setPrepaymentMethodError) setPrepaymentMethodError('');
                    if (setPrepaymentCashStr) setPrepaymentCashStr('');
                    if (setPrepaymentCardStr) setPrepaymentCardStr('');
                  }}
                  className={sellerSegmentClass(prepaymentMethod === 'card')}
                >
                  Карта
                </button>
                <button
                  type="button"
                  data-testid="seller-prepayment-method-mixed"
                  onClick={() => {
                    if (setPrepaymentMethod) setPrepaymentMethod('mixed');
                    if (setPrepaymentMethodError) setPrepaymentMethodError('');
                    const prepayment = Math.round(Number(localPrepaymentStr || 0));
                    const cash = Math.max(1, Math.floor(prepayment / 2));
                    const card = Math.max(1, prepayment - cash);
                    if (setPrepaymentCashStr) setPrepaymentCashStr(String(cash));
                    if (setPrepaymentCardStr) setPrepaymentCardStr(String(card));
                  }}
                  className={sellerSegmentClass(prepaymentMethod === 'mixed')}
                >
                  Комбо
                </button>
              </div>

              {prepaymentMethod === 'mixed' ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    data-testid="seller-prepayment-mixed-cash"
                    value={prepaymentCashStr || ''}
                    onChange={(event) => setPrepaymentCashStr && setPrepaymentCashStr(event.target.value)}
                    placeholder="Нал"
                    className={sellerInputClass('no-spin')}
                  />
                  <input
                    type="number"
                    data-testid="seller-prepayment-mixed-card"
                    value={prepaymentCardStr || ''}
                    onChange={(event) => setPrepaymentCardStr && setPrepaymentCardStr(event.target.value)}
                    placeholder="Карта"
                    className={sellerInputClass('no-spin')}
                  />
                </div>
              ) : null}

              <FieldError>{prepaymentMethodError}</FieldError>
            </div>
          ) : null}
        </div>
      </SellerSurface>

      <SellerHeroPanel>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">Итог заказа</div>
            <div data-testid="seller-order-total" className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.04em] text-white">
              {formatRUB(totalPrice)}
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">Перед созданием</span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/10 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100">Предоплата</div>
            <div className="mt-1 text-xl font-semibold text-white">{formatRUB(prepaymentAmount)}</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100">Остаток к оплате</div>
            <div className="mt-1 text-xl font-semibold text-white">{formatRUB(remainingAmount)}</div>
          </div>
        </div>

        {lastError ? (
          <div className="mt-4 rounded-2xl bg-rose-100 px-3 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
            {lastError}
          </div>
        ) : null}
      </SellerHeroPanel>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          type="button"
          data-testid="seller-seats-back"
          className={sellerButtonClass({ variant: 'secondary', size: 'lg' })}
        >
          Назад
        </button>

        <button
          onClick={handleConfirm}
          type="button"
          data-testid="seller-seats-create-presale"
          disabled={!isFormValid || isSubmitting}
          className={sellerButtonClass({
            variant: 'primary',
            size: 'lg',
            disabled: !isFormValid || isSubmitting,
          })}
        >
          Создать предзаказ
        </button>
      </div>
    </div>
  );
};

export default SelectSeats;
