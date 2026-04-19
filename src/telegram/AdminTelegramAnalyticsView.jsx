import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient.js';
import {
  buildTelegramAnalyticsScreenModel,
  formatTelegramAnalyticsPercent,
  loadTelegramAnalyticsSnapshot,
  reduceTelegramAnalyticsViewState,
  resolveTelegramAnalyticsErrorMessage,
  TELEGRAM_ANALYTICS_VIEW_STATES,
} from './admin-telegram-analytics-model.js';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function readPreferredSourceReference(search) {
  const params = new URLSearchParams(search || '');
  return normalizeString(params.get('source'));
}

function toDisplayNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function familyLabel(value) {
  if (value === 'seller_source') return 'Продавец';
  if (value === 'owner_source') return 'Владелец/ручной';
  if (value === 'point_promo_source') return 'Точка/промо';
  if (value === 'generic_source') return 'Общий';
  return value || 'Неизвестно';
}

function viewStateLabel(state) {
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.LOADING) return 'Загрузка';
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_LOADING) return 'Загрузка деталей';
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_WARNING) return 'Предупреждение';
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.READY) return 'Готово';
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.ERROR) return 'Ошибка';
  return 'Ожидание';
}

function viewStateBadgeClass(state) {
  if (
    state === TELEGRAM_ANALYTICS_VIEW_STATES.LOADING ||
    state === TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_LOADING
  ) {
    return 'rounded-full border border-amber-500/50 bg-amber-900/30 px-2.5 py-1 text-[11px] font-semibold text-amber-100';
  }
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_WARNING) {
    return 'rounded-full border border-orange-500/50 bg-orange-900/30 px-2.5 py-1 text-[11px] font-semibold text-orange-100';
  }
  if (state === TELEGRAM_ANALYTICS_VIEW_STATES.ERROR) {
    return 'rounded-full border border-rose-500/50 bg-rose-900/30 px-2.5 py-1 text-[11px] font-semibold text-rose-100';
  }
  return 'rounded-full border border-emerald-500/50 bg-emerald-900/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100';
}

function sourceItemClass(isActive) {
  return isActive
    ? 'w-full rounded-xl border border-cyan-500/70 bg-cyan-900/30 px-3 py-2 text-left text-sm text-cyan-50'
    : 'w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900';
}

export default function AdminTelegramAnalyticsView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [viewState, dispatchViewState] = useReducer(
    reduceTelegramAnalyticsViewState,
    TELEGRAM_ANALYTICS_VIEW_STATES.IDLE
  );
  const [loadingError, setLoadingError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [funnelSummary, setFunnelSummary] = useState({});
  const [sourceAnalyticsList, setSourceAnalyticsList] = useState({ items: [] });
  const [selectedSourceReference, setSelectedSourceReference] = useState(null);
  const [sourceDetailReport, setSourceDetailReport] = useState(null);
  const preferredSourceReference = useMemo(
    () => readPreferredSourceReference(location.search),
    [location.search]
  );

  const refreshAll = useCallback(
    async (preferredReference = null) => {
      dispatchViewState({ type: 'start_load' });
      setLoadingError('');
      setDetailError('');

      try {
        const snapshot = await loadTelegramAnalyticsSnapshot({
          apiClient,
          preferredSourceReference:
            preferredReference || selectedSourceReference || preferredSourceReference,
        });
        setFunnelSummary(snapshot.funnelSummary || {});
        setSourceAnalyticsList(snapshot.sourceAnalyticsList || { items: [] });
        setSelectedSourceReference(snapshot.selectedSourceReference || null);
        setSourceDetailReport(snapshot.sourceDetailReport || null);

        dispatchViewState({ type: 'load_success' });
        if (snapshot.sourceDetailError) {
          setDetailError(snapshot.sourceDetailError);
          dispatchViewState({ type: 'detail_error' });
        }
      } catch (error) {
        const message = resolveTelegramAnalyticsErrorMessage(
          error,
          'Не удалось загрузить данные аналитики Telegram'
        );
        setLoadingError(message);
        dispatchViewState({ type: 'load_error' });
      }
    },
    [preferredSourceReference, selectedSourceReference]
  );

  useEffect(() => {
    if (viewState === TELEGRAM_ANALYTICS_VIEW_STATES.IDLE) {
      refreshAll(preferredSourceReference);
    }
  }, [viewState, refreshAll, preferredSourceReference]);

  const loadSourceDetail = useCallback(async (sourceReference) => {
    const normalizedSourceReference = normalizeString(sourceReference);
    if (!normalizedSourceReference) {
      setSourceDetailReport(null);
      setDetailError('');
      dispatchViewState({ type: 'detail_success' });
      return;
    }

    dispatchViewState({ type: 'start_detail' });
    setDetailError('');
    try {
      const detailSummary = await apiClient.getTelegramAdminSourceAnalyticsReport(
        normalizedSourceReference
      );
      const report = detailSummary?.source_performance_report || null;
      if (!report) {
        setSourceDetailReport(null);
        setDetailError('Детали источника недоступны для этого идентификатора.');
        dispatchViewState({ type: 'detail_error' });
        return;
      }
      setSourceDetailReport(report);
      dispatchViewState({ type: 'detail_success' });
    } catch (error) {
      setSourceDetailReport(null);
      setDetailError(
        resolveTelegramAnalyticsErrorMessage(
          error,
          'Детали источника недоступны для этого идентификатора.'
        )
      );
      dispatchViewState({ type: 'detail_error' });
    }
  }, []);

  const onSelectSource = useCallback(
    async (sourceReference) => {
      const normalizedSourceReference = normalizeString(sourceReference);
      if (!normalizedSourceReference || normalizedSourceReference === selectedSourceReference) {
        return;
      }
      setSelectedSourceReference(normalizedSourceReference);
      await loadSourceDetail(normalizedSourceReference);
    },
    [loadSourceDetail, selectedSourceReference]
  );

  const model = useMemo(
    () =>
      buildTelegramAnalyticsScreenModel({
        funnelSummary,
        sourceAnalyticsList,
        selectedSourceReference,
        sourceDetailReport,
        sourceDetailError: detailError,
      }),
    [
      funnelSummary,
      sourceAnalyticsList,
      selectedSourceReference,
      sourceDetailReport,
      detailError,
    ]
  );

  const selectedSourceReport = model.selectedSourceReport;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="telegram-analytics-screen">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Аналитика источников Telegram</h1>
            <p className="mt-1 text-xs text-slate-400">
              Поток супер-администратора для сводки воронки, производительности источников и диагностики потерь.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/admin/telegram-sources')}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              Источники и QR
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/telegram-content')}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              Telegram CMS
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              Назад в админ-панель
            </button>
            <button
              type="button"
              onClick={() => refreshAll(model.selectedSourceReference)}
              className="rounded-xl border border-cyan-500/50 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/45"
            >
              Обновить
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Источники</div>
            <div className="mt-1 text-xl font-semibold">
              {toDisplayNumber(model.summary.registered_sources)}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Записи</div>
            <div className="mt-1 text-xl font-semibold">
              {toDisplayNumber(model.summary.entries)}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Запросы</div>
            <div className="mt-1 text-xl font-semibold">
              {toDisplayNumber(model.summary.booking_requests)}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Подтверждено</div>
            <div className="mt-1 text-xl font-semibold">
              {toDisplayNumber(model.summary.confirmed_bookings)}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Завершено</div>
            <div className="mt-1 text-xl font-semibold">
              {toDisplayNumber(model.summary.completed_rides)}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Отзывы</div>
            <div className="mt-1 text-xl font-semibold">{toDisplayNumber(model.summary.reviews)}</div>
          </article>
        </section>

        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/50 px-3 py-2">
          <div className="text-xs text-slate-300">
            Итоговая конверсия из записей: {formatTelegramAnalyticsPercent(model.summary.final_conversion_from_entries_pct)}
            {' '}| Потери до отзыва: {toDisplayNumber(model.summary.final_dropoff_count)}
          </div>
          <span className={viewStateBadgeClass(viewState)}>{viewStateLabel(viewState)}</span>
        </div>

        {loadingError ? (
          <div className="rounded-2xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm text-rose-100">
            {loadingError}
          </div>
        ) : null}
        {detailError ? (
          <div className="rounded-2xl border border-orange-500/40 bg-orange-900/20 px-4 py-3 text-sm text-orange-100">
            {detailError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="mb-3 text-base font-semibold">Метрики по источникам</h2>
            <div className="max-h-[540px] space-y-2 overflow-auto pr-1">
              {model.sourceReports.map((item) => (
                <button
                  key={item.sourceReference}
                  type="button"
                  className={sourceItemClass(item.sourceReference === model.selectedSourceReference)}
                  onClick={() => onSelectSource(item.sourceReference)}
                >
                  <div className="font-medium">{item.sourceReference}</div>
                  <div className="mt-1 text-xs opacity-80">
                    {familyLabel(item.sourceFamily)} | {item.sourceType}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    записи={toDisplayNumber(item.counters.entries)} | запросы=
                    {toDisplayNumber(item.counters.booking_requests)} | подтверждено=
                    {toDisplayNumber(item.counters.bridged_presales)}
                  </div>
                </button>
              ))}
              {!model.hasAnySources ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                  Аналитика источников пока недоступна.
                </div>
              ) : null}
            </div>
          </article>

          <div className="space-y-4">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Общая сводка воронки</h2>
                <div className="text-xs text-slate-400">
                  на основе существующих событий аналитики Telegram только
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-400">
                      <th className="px-2 py-2">Состояние</th>
                      <th className="px-2 py-2">Количество</th>
                      <th className="px-2 py-2">Потери от предыдущего</th>
                      <th className="px-2 py-2">Конверсия от предыдущего</th>
                      <th className="px-2 py-2">Конверсия из записей</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.funnelSteps.map((step) => (
                      <tr key={step.key} className="border-b border-slate-900/70">
                        <td className="px-2 py-2 text-slate-200">{step.label}</td>
                        <td className="px-2 py-2 text-slate-100">{toDisplayNumber(step.count)}</td>
                        <td className="px-2 py-2 text-slate-300">
                          {step.dropoff_from_previous === null
                            ? 'n/a'
                            : toDisplayNumber(step.dropoff_from_previous)}
                        </td>
                        <td className="px-2 py-2 text-slate-300">
                          {formatTelegramAnalyticsPercent(step.conversion_from_previous_pct)}
                        </td>
                        <td className="px-2 py-2 text-slate-300">
                          {formatTelegramAnalyticsPercent(step.conversion_from_entries_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!model.hasAnyOverallData ? (
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                  События воронки ещё не зафиксированы.
                </div>
              ) : null}
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  Детали источника: {selectedSourceReport?.sourceReference || 'не выбран'}
                </h2>
                {model.selectedSourceReference ? (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/admin/telegram-sources?source=${encodeURIComponent(
                          model.selectedSourceReference
                        )}`
                      )
                    }
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                  >
                    Открыть в реестре источников
                  </button>
                ) : null}
              </div>

              {selectedSourceReport ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
                    <div>Записи: {toDisplayNumber(selectedSourceReport.counters.entries)}</div>
                    <div>
                      Начала атрибуции: {toDisplayNumber(selectedSourceReport.counters.attribution_starts)}
                    </div>
                    <div>
                      Создание запроса: {toDisplayNumber(selectedSourceReport.counters.booking_requests)}
                    </div>
                    <div>
                      Подтверждения предоплаты:{' '}
                      {toDisplayNumber(selectedSourceReport.counters.prepayment_confirmations)}
                    </div>
                    <div>
                      Подтверждённые бронирования: {toDisplayNumber(selectedSourceReport.counters.bridged_presales)}
                    </div>
                    <div>
                      Завершённые поездки: {toDisplayNumber(selectedSourceReport.counters.completed_trips)}
                    </div>
                    <div>
                      Отзывы: {toDisplayNumber(selectedSourceReport.counters.review_submissions)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-200">
                    <div>
                      Запросы из записей:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion.booking_requests_from_entries_pct
                      )}
                    </div>
                    <div>
                      Предоплата из запросов:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion
                          .prepayment_confirmations_from_booking_requests_pct
                      )}
                    </div>
                    <div>
                      Подтверждено из предоплаты:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion
                          .bridged_presales_from_prepayment_confirmations_pct
                      )}
                    </div>
                    <div>
                      Завершено из подтверждённых:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion.completed_trips_from_bridged_presales_pct
                      )}
                    </div>
                    <div>
                      Отзывы из завершённых:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion.review_submissions_from_completed_trips_pct
                      )}
                    </div>
                    <div>
                      Отзывы из записей:{' '}
                      {formatTelegramAnalyticsPercent(
                        selectedSourceReport.conversion.review_submissions_from_entries_pct
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                  Выберите источник для просмотра детальных метрик.
                </div>
              )}
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
