import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient.js';
import {
  buildTelegramSourceManagementModel,
  createTelegramSourceDraft,
  getSourceTypeOptionsForFamily,
  reduceTelegramSourceEditorState,
  resolveTelegramSourceEditorErrorMessage,
  TELEGRAM_SOURCE_EDITOR_VIEW_STATES,
  TELEGRAM_SOURCE_FORM_MODES,
} from './admin-telegram-source-management-model.js';

const SOURCE_FAMILY_OPTIONS = Object.freeze([
  'seller_source',
  'owner_source',
  'generic_source',
  'point_promo_source',
]);
const SOURCE_FAMILY_FILTERS = Object.freeze(['all', ...SOURCE_FAMILY_OPTIONS]);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function readPreferredSourceReference(search) {
  const params = new URLSearchParams(search || '');
  return normalizeString(params.get('source'));
}

function fieldClass() {
  return 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500';
}

function stateBadgeClass(state) {
  if (
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVING ||
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.LOADING
  ) {
    return 'rounded-full border border-amber-500/50 bg-amber-900/30 px-2.5 py-1 text-[11px] font-semibold text-amber-100';
  }
  if (
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVED ||
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY
  ) {
    return 'rounded-full border border-emerald-500/50 bg-emerald-900/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100';
  }
  if (
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.CONFLICT ||
    state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.ERROR
  ) {
    return 'rounded-full border border-rose-500/50 bg-rose-900/30 px-2.5 py-1 text-[11px] font-semibold text-rose-100';
  }
  return 'rounded-full border border-slate-500/50 bg-slate-900/30 px-2.5 py-1 text-[11px] font-semibold text-slate-200';
}

function stateLabel(state) {
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.LOADING) return 'Загрузка';
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVING) return 'Сохранение';
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVED) return 'Сохранено';
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.CONFLICT) return 'Конфликт';
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.ERROR) return 'Ошибка';
  if (state === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY) return 'Готово';
  return 'Ожидание';
}

function familyLabel(value) {
  if (value === 'seller_source') return 'Источник продавца';
  if (value === 'owner_source') return 'Источник владельца/ручной';
  if (value === 'generic_source') return 'Общий/ручной источник';
  if (value === 'point_promo_source') return 'Точка/промо источник';
  return value || 'Неизвестно';
}

function typeLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function filterButtonClass(isActive) {
  return isActive
    ? 'rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-100'
    : 'rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800';
}

function sourceItemClass(isActive) {
  return isActive
    ? 'w-full rounded-xl border border-cyan-500/70 bg-cyan-900/30 px-3 py-2 text-left text-sm text-cyan-50'
    : 'w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900';
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'n/a';
  }
  return `${Number(value).toFixed(2)}%`;
}

function parseSellerId(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function sortByReference(left, right) {
  return String(left?.source_reference?.source_reference || '').localeCompare(
    String(right?.source_reference?.source_reference || '')
  );
}

export default function AdminTelegramSourceManagementView() {
  const navigate = useNavigate();
  const location = useLocation();
  const preferredSourceReference = useMemo(
    () => readPreferredSourceReference(location.search),
    [location.search]
  );
  const [viewState, dispatchViewState] = useReducer(
    reduceTelegramSourceEditorState,
    TELEGRAM_SOURCE_EDITOR_VIEW_STATES.IDLE
  );
  const [loadingError, setLoadingError] = useState('');
  const [editorError, setEditorError] = useState('');
  const [qrError, setQrError] = useState('');
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [sourceRegistryList, setSourceRegistryList] = useState({ items: [] });
  const [sourceAnalyticsList, setSourceAnalyticsList] = useState({ items: [] });
  const [qrExportPayloadList, setQrExportPayloadList] = useState({ items: [] });
  const [sellers, setSellers] = useState([]);
  const [selectedSourceReference, setSelectedSourceReference] = useState(null);
  const [sourceDrafts, setSourceDrafts] = useState({});
  const [activeFormMode, setActiveFormMode] = useState(TELEGRAM_SOURCE_FORM_MODES.EDIT);
  const [familyFilter, setFamilyFilter] = useState('all');

  const refreshAll = useCallback(async (preferredSourceReference = null) => {
    dispatchViewState({ type: 'start_load' });
    setLoadingError('');
    setEditorError('');
    setQrError('');

    try {
      const [sourceResult, analyticsResult, qrResult, sellersResult] = await Promise.all([
        apiClient.getTelegramAdminSourceRegistryItems(),
        apiClient.getTelegramAdminSourceAnalyticsSummaries(),
        apiClient.getTelegramAdminSourceQrExportPayloads(),
        apiClient.getSellers().catch(() => []),
      ]);

      const normalizedSourceResult = sourceResult || { items: [] };
      setSourceRegistryList(normalizedSourceResult);
      setSourceAnalyticsList(analyticsResult || { items: [] });
      setQrExportPayloadList(qrResult || { items: [] });
      setSellers(Array.isArray(sellersResult) ? sellersResult : []);
      setSelectedSourceReference((previous) => {
        const items = Array.isArray(normalizedSourceResult?.items)
          ? normalizedSourceResult.items
          : [];
        const desired = preferredSourceReference || previous;
        if (
          desired &&
          items.some(
            (item) =>
              item?.source_reference?.source_reference === desired
          )
        ) {
          return desired;
        }
        return items[0]?.source_reference?.source_reference || null;
      });
      dispatchViewState({ type: 'load_success' });
    } catch (error) {
      const message = resolveTelegramSourceEditorErrorMessage(
        error,
        'Не удалось загрузить данные управления источниками Telegram'
      );
      setLoadingError(message);
      dispatchViewState({ type: 'load_error' });
    }
  }, []);

  useEffect(() => {
    if (viewState === TELEGRAM_SOURCE_EDITOR_VIEW_STATES.IDLE) {
      refreshAll(preferredSourceReference);
    }
  }, [viewState, refreshAll, preferredSourceReference]);

  const model = useMemo(
    () =>
      buildTelegramSourceManagementModel({
        sourceRegistryList,
        analyticsList: sourceAnalyticsList,
        qrExportPayloadList,
        selectedSourceReference,
        sourceDrafts,
        activeFormMode,
      }),
    [
      sourceRegistryList,
      sourceAnalyticsList,
      qrExportPayloadList,
      selectedSourceReference,
      sourceDrafts,
      activeFormMode,
    ]
  );

  const visibleSources = useMemo(() => {
    if (familyFilter === 'all') {
      return model.sources;
    }
    return model.sources.filter((item) => item.sourceFamily === familyFilter);
  }, [model.sources, familyFilter]);

  const selectedDraft = model.selectedDraft;
  const selectedSourceReferenceValue = model.selectedSourceReference;

  const updateDraft = useCallback(
    (patch) => {
      const draftKey =
        activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE
          ? '__create__'
          : selectedSourceReferenceValue;
      if (!draftKey) return;

      setSourceDrafts((previous) => ({
        ...previous,
        [draftKey]: {
          ...(previous[draftKey] || selectedDraft),
          ...patch,
        },
      }));
      dispatchViewState({ type: 'reset_feedback' });
      setEditorError('');
    },
    [activeFormMode, selectedSourceReferenceValue, selectedDraft]
  );

  const startCreateMode = useCallback(() => {
    setActiveFormMode(TELEGRAM_SOURCE_FORM_MODES.CREATE);
    setEditorError('');
    setQrError('');
    setSourceDrafts((previous) => ({
      ...previous,
      __create__: previous.__create__ || createTelegramSourceDraft(null),
    }));
    dispatchViewState({ type: 'reset_feedback' });
  }, []);

  const switchToEditMode = useCallback(
    (sourceItem) => {
      const reference = sourceItem?.sourceReference || null;
      if (!reference) {
        return;
      }

      setActiveFormMode(TELEGRAM_SOURCE_FORM_MODES.EDIT);
      setSelectedSourceReference(reference);
      setEditorError('');
      setQrError('');
      setSourceDrafts((previous) => ({
        ...previous,
        [reference]:
          previous[reference] ||
          createTelegramSourceDraft(sourceItem),
      }));
      dispatchViewState({ type: 'reset_feedback' });
    },
    []
  );

  const saveSource = useCallback(async () => {
    if (
      activeFormMode === TELEGRAM_SOURCE_FORM_MODES.EDIT &&
      !selectedSourceReferenceValue
    ) {
      return;
    }

    dispatchViewState({ type: 'start_save' });
    setEditorError('');

    const payload = {
      source_reference: selectedDraft.sourceReference,
      source_family: selectedDraft.sourceFamily,
      source_type: selectedDraft.sourceType,
      source_token: selectedDraft.sourceToken,
      seller_id:
        selectedDraft.sourceFamily === 'seller_source'
          ? parseSellerId(selectedDraft.sellerId)
          : null,
      is_enabled: Boolean(selectedDraft.isEnabled),
      is_exportable: Boolean(selectedDraft.isExportable),
    };

    try {
      if (activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE) {
        const createResult = await apiClient.createTelegramAdminSourceRegistryItem(payload);
        const createdReference =
          createResult?.source_registry_item?.source_reference?.source_reference || null;
        setActiveFormMode(TELEGRAM_SOURCE_FORM_MODES.EDIT);
        await refreshAll(createdReference);
      } else if (selectedSourceReferenceValue) {
        await apiClient.updateTelegramAdminSourceRegistryItem(
          selectedSourceReferenceValue,
          payload
        );
        await refreshAll(selectedSourceReferenceValue);
      }

      dispatchViewState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramSourceEditorErrorMessage(error, 'Ошибка сохранения источника');
      setEditorError(message);
      dispatchViewState({ type: 'save_error', errorMessage: message });
      if (selectedSourceReferenceValue) {
        await refreshAll(selectedSourceReferenceValue);
      }
    }
  }, [
    activeFormMode,
    refreshAll,
    selectedDraft,
    selectedSourceReferenceValue,
  ]);

  const toggleEnabled = useCallback(async () => {
    if (!model.selectedSource || !selectedSourceReferenceValue) return;

    dispatchViewState({ type: 'start_save' });
    setEditorError('');
    try {
      await apiClient.setTelegramAdminSourceRegistryItemEnabled(
        selectedSourceReferenceValue,
        { enabled: !model.selectedSource.isEnabled }
      );
      await refreshAll(selectedSourceReferenceValue);
      dispatchViewState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramSourceEditorErrorMessage(
        error,
        'Ошибка включения/отключения источника'
      );
      setEditorError(message);
      dispatchViewState({ type: 'save_error', errorMessage: message });
    }
  }, [model.selectedSource, refreshAll, selectedSourceReferenceValue]);

  const loadSelectedQrPayload = useCallback(async () => {
    if (!selectedSourceReferenceValue) return;

    setIsQrLoading(true);
    setQrError('');
    try {
      const result = await apiClient.getTelegramAdminSourceQrExportPayload(
        selectedSourceReferenceValue
      );
      const payloadItem = result?.qr_export_payload || null;
      if (payloadItem) {
        setQrExportPayloadList((previous) => {
          const nextItems = Array.isArray(previous?.items) ? [...previous.items] : [];
          const existingIndex = nextItems.findIndex(
            (item) =>
              item?.source_reference?.source_reference === selectedSourceReferenceValue
          );
          if (existingIndex >= 0) {
            nextItems[existingIndex] = payloadItem;
          } else {
            nextItems.push(payloadItem);
          }
          nextItems.sort(sortByReference);
          return {
            ...(previous || {}),
            items: nextItems,
          };
        });
      }
    } catch (error) {
      const message = resolveTelegramSourceEditorErrorMessage(
        error,
        'QR-экспорт недоступен для этого источника'
      );
      setQrError(message);
    } finally {
      setIsQrLoading(false);
    }
  }, [selectedSourceReferenceValue]);

  const selectedQrPayload = model.selectedQrPayloadItem;
  const selectedSellerId = parseSellerId(selectedDraft.sellerId);
  const selectedSellerSummary = sellers.find((seller) => seller.id === selectedSellerId) || null;

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      data-testid="telegram-source-management-screen"
    >
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Управление источниками и QR Telegram</h1>
            <p className="mt-1 text-xs text-slate-400">
              Поток супер-администратора для реестра источников, привязки продавца/владельца/ручного, QR-нагрузок и аналитики источников.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/admin/telegram-content')}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              Telegram CMS
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/admin/telegram-analytics${
                    model.selectedSourceReference
                      ? `?source=${encodeURIComponent(model.selectedSourceReference)}`
                      : ''
                  }`
                )
              }
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              Аналитика источников
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
        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Всего источников</div>
            <div className="mt-1 text-xl font-semibold">{model.summary.total_sources}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Включено</div>
            <div className="mt-1 text-xl font-semibold">{model.summary.enabled_sources}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Привязано к продавцу</div>
            <div className="mt-1 text-xl font-semibold">{model.summary.seller_bound_sources}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Доступно для QR-экспорта</div>
            <div className="mt-1 text-xl font-semibold">{model.summary.exportable_sources}</div>
          </article>
        </section>

        {loadingError ? (
          <div className="rounded-2xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm text-rose-100">
            {loadingError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Реестр источников</h2>
              <span className={stateBadgeClass(viewState)}>{stateLabel(viewState)}</span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {SOURCE_FAMILY_FILTERS.map((filterValue) => (
                <button
                  key={filterValue}
                  type="button"
                  onClick={() => setFamilyFilter(filterValue)}
                  className={filterButtonClass(familyFilter === filterValue)}
                >
                  {filterValue === 'all' ? 'Все' : familyLabel(filterValue)}
                </button>
              ))}
            </div>

            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={startCreateMode}
                className="rounded-xl border border-cyan-500/60 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/45"
              >
                Новый источник
              </button>
              <button
                type="button"
                onClick={() => {
                  if (model.selectedSource) {
                    switchToEditMode(model.selectedSource);
                  }
                }}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                disabled={!model.selectedSource}
              >
                Редактировать выбранный
              </button>
            </div>

            <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
              {visibleSources.map((item) => (
                <button
                  key={item.sourceReference}
                  type="button"
                  className={sourceItemClass(item.sourceReference === model.selectedSourceReference)}
                  onClick={() => switchToEditMode(item)}
                >
                  <div className="font-medium">{item.sourceReference}</div>
                  <div className="mt-1 text-xs opacity-80">
                    {familyLabel(item.sourceFamily)} | {typeLabel(item.sourceType)}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    записи={item.counters.entries} запросы={item.counters.booking_requests} подтверждено={item.counters.confirmed_bookings}
                  </div>
                </button>
              ))}
              {visibleSources.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                  Нет источников, соответствующих фильтру.
                </div>
              ) : null}
            </div>
          </article>

          <article className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE
                  ? 'Создать источник'
                  : 'Редактировать источник'}
              </h2>
              {activeFormMode === TELEGRAM_SOURCE_FORM_MODES.EDIT ? (
                <button
                  type="button"
                  onClick={toggleEnabled}
                  disabled={!model.selectedSource}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  {model.selectedSource?.isEnabled ? 'Отключить источник' : 'Включить источник'}
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Идентификатор источника
                </label>
                <input
                  className={fieldClass()}
                  value={selectedDraft.sourceReference}
                  onChange={(event) =>
                    updateDraft({ sourceReference: event.target.value })
                  }
                  disabled={activeFormMode !== TELEGRAM_SOURCE_FORM_MODES.CREATE}
                />
                {activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE && (
                  <div className="mt-1 text-xs text-slate-400">
                    Уникальный идентификатор. После создания изменить нельзя.
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Токен источника
                </label>
                <input
                  className={fieldClass()}
                  value={selectedDraft.sourceToken}
                  onChange={(event) =>
                    updateDraft({ sourceToken: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Семейство источника
                </label>
                <select
                  className={fieldClass()}
                  value={selectedDraft.sourceFamily}
                  onChange={(event) => {
                    const nextFamily = event.target.value;
                    const sourceTypeOptions = getSourceTypeOptionsForFamily(nextFamily);
                    updateDraft({
                      sourceFamily: nextFamily,
                      sourceType: sourceTypeOptions[0] || '',
                      sellerId:
                        nextFamily === 'seller_source' ? selectedDraft.sellerId : '',
                    });
                  }}
                >
                  {SOURCE_FAMILY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {familyLabel(value)}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-slate-400">
                  {selectedDraft.sourceFamily === 'seller_source' && 'Привязка к конкретному продавцу.'}
                  {selectedDraft.sourceFamily === 'owner_source' && 'Ручное добавление владельцем.'}
                  {selectedDraft.sourceFamily === 'generic_source' && 'Общий источник без привязки.'}
                  {selectedDraft.sourceFamily === 'point_promo_source' && 'Промо-точка или рекламный материал.'}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                  Тип источника
                </label>
                <select
                  className={fieldClass()}
                  value={selectedDraft.sourceType}
                  onChange={(event) =>
                    updateDraft({ sourceType: event.target.value })
                  }
                >
                  {model.sourceTypeOptions.map((typeValue) => (
                    <option key={typeValue} value={typeValue}>
                      {typeLabel(typeValue)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                Привязка продавца
              </label>
              {selectedDraft.sourceFamily === 'seller_source' ? (
                <div className="space-y-2">
                  <input
                    className={fieldClass()}
                    value={selectedDraft.sellerId}
                    onChange={(event) => updateDraft({ sellerId: event.target.value })}
                    placeholder="ID продавца"
                  />
                  {sellers.length > 0 ? (
                    <select
                      className={fieldClass()}
                      value={selectedDraft.sellerId}
                      onChange={(event) => updateDraft({ sellerId: event.target.value })}
                    >
                      <option value="">Выберите продавца</option>
                      {sellers.map((seller) => (
                        <option key={seller.id} value={seller.id}>
                          {seller.username || `seller-${seller.id}`} (#{seller.id})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {selectedSellerSummary ? (
                    <div className="text-xs text-slate-300">
                      Привязанный продавец: {selectedSellerSummary.username} (#{selectedSellerSummary.id})
                    </div>
                  ) : null}
                  <div className="text-xs text-slate-400">
                    Источник будет связан с этим продавцом для отслеживания трафика.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                  Выбрано семейство не продавца. Источник направляется на владельца/ручной или общий трафик.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(selectedDraft.isEnabled)}
                  onChange={(event) => updateDraft({ isEnabled: event.target.checked })}
                />
                Включён
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(selectedDraft.isExportable)}
                  onChange={(event) => updateDraft({ isExportable: event.target.checked })}
                />
                Экспорт/печать
              </label>
              <div className="text-xs text-slate-400">
                {selectedDraft.isEnabled ? 'Источник активен и принимает трафик.' : 'Источник отключён.'}{' '}
                {selectedDraft.isExportable ? 'Доступен для QR-экспорта и печати.' : 'QR-экспорт недоступен.'}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveSource}
                className="rounded-xl border border-cyan-500/60 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/45"
              >
                {activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE
                  ? 'Создать источник'
                  : 'Сохранить источник'}
              </button>
              <button
                type="button"
                onClick={loadSelectedQrPayload}
                disabled={activeFormMode !== TELEGRAM_SOURCE_FORM_MODES.EDIT || !model.selectedSource}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
              >
                {isQrLoading ? 'Загрузка QR...' : 'Загрузить QR-экспорт'}
              </button>
            </div>
            {activeFormMode === TELEGRAM_SOURCE_FORM_MODES.EDIT && model.selectedSource && (
              <div className="text-xs text-slate-400">
                После сохранения источника нажмите «Загрузить QR-экспорт» для получения данных для печати QR-кода.
              </div>
            )}

            {editorError ? (
              <div className="rounded-xl border border-rose-600/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-100">
                {editorError}
              </div>
            ) : null}
            {qrError ? (
              <div className="rounded-xl border border-rose-600/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-100">
                {qrError}
              </div>
            ) : null}

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                  Аналитика источника
                </div>
                <div className="space-y-1 text-sm text-slate-200">
                  <div>Записи: {model.selectedCounters.entries}</div>
                  <div>Начала атрибуции: {model.selectedCounters.attribution_starts}</div>
                  <div>Запросы: {model.selectedCounters.booking_requests}</div>
                  <div>Подтверждённые бронирования: {model.selectedCounters.confirmed_bookings}</div>
                  <div>Завершённые поездки: {model.selectedCounters.completed_rides}</div>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <div>
                    Конверсия запросов: {formatPercent(model.selectedConversion.booking_requests_from_entries_pct)}
                  </div>
                  <div>
                    Конверсия подтверждений: {formatPercent(model.selectedConversion.confirmed_bookings_from_requests_pct)}
                  </div>
                  <div>
                    Конверсия завершений: {formatPercent(model.selectedConversion.completed_rides_from_confirmed_pct)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/admin/telegram-analytics${
                        model.selectedSourceReference
                          ? `?source=${encodeURIComponent(model.selectedSourceReference)}`
                          : ''
                      }`
                    )
                  }
                  className="mt-3 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                >
                  Открыть детальную аналитику
                </button>
              </article>

              <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                  Данные для QR-печати
                </div>
                {selectedQrPayload ? (
                  <div className="space-y-1 text-xs text-slate-300">
                    <div>
                      Команда старта:{' '}
                      <span className="font-mono">
                        {selectedQrPayload.printable_exportable_payload_summary?.start_command_payload}
                      </span>
                    </div>
                    <div>
                      Текст QR:{' '}
                      <span className="font-mono">
                        {selectedQrPayload.printable_exportable_payload_summary?.qr_payload_text}
                      </span>
                    </div>
                    <div>
                      Имя файла:{' '}
                      <span className="font-mono">
                        {selectedQrPayload.printable_exportable_payload_summary?.export_file_name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    QR-данные не загружены. Сохраните источник и нажмите «Загрузить QR-экспорт».
                  </div>
                )}
              </article>
            </section>
          </article>
        </section>
      </main>
    </div>
  );
}
