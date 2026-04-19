import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient.js';
import {
  buildTelegramAdminContentModel,
  createTelegramManagedContentDraft,
  createTelegramTemplateDraft,
  reduceTelegramEditorState,
  resolveTelegramEditorErrorMessage,
  TELEGRAM_EDITOR_VIEW_STATES,
} from './admin-telegram-content-management-model.js';

const MANAGED_CONTENT_GROUP_FILTER = Object.freeze([
  'faq_general',
  'faq_trip_rules',
  'useful_places',
  'what_to_take',
  'trip_help',
]);

function normalizeVersion(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function stateBadgeClass(state) {
  if (state === TELEGRAM_EDITOR_VIEW_STATES.SAVING || state === TELEGRAM_EDITOR_VIEW_STATES.LOADING) {
    return 'rounded-full border border-amber-500/50 bg-amber-900/30 px-2.5 py-1 text-[11px] font-semibold text-amber-100';
  }
  if (state === TELEGRAM_EDITOR_VIEW_STATES.SAVED || state === TELEGRAM_EDITOR_VIEW_STATES.READY) {
    return 'rounded-full border border-emerald-500/50 bg-emerald-900/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100';
  }
  if (state === TELEGRAM_EDITOR_VIEW_STATES.CONFLICT || state === TELEGRAM_EDITOR_VIEW_STATES.ERROR) {
    return 'rounded-full border border-rose-500/50 bg-rose-900/30 px-2.5 py-1 text-[11px] font-semibold text-rose-100';
  }
  return 'rounded-full border border-slate-500/50 bg-slate-900/30 px-2.5 py-1 text-[11px] font-semibold text-slate-200';
}

function stateLabel(state) {
  if (state === TELEGRAM_EDITOR_VIEW_STATES.LOADING) return 'Загрузка';
  if (state === TELEGRAM_EDITOR_VIEW_STATES.SAVING) return 'Сохранение';
  if (state === TELEGRAM_EDITOR_VIEW_STATES.SAVED) return 'Сохранено';
  if (state === TELEGRAM_EDITOR_VIEW_STATES.CONFLICT) return 'Конфликт версий';
  if (state === TELEGRAM_EDITOR_VIEW_STATES.ERROR) return 'Ошибка';
  if (state === TELEGRAM_EDITOR_VIEW_STATES.READY) return 'Готово';
  return 'Ожидание';
}

function templateCategoryLabel(category) {
  if (category === 'reminder') return 'Напоминание';
  if (category === 'post_trip') return 'После поездки';
  return 'Сервис';
}

function contentCategoryLabel(category) {
  return category === 'faq' ? 'FAQ' : 'Полезный контент';
}

function filterButtonClass(isActive) {
  return isActive
    ? 'rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-100'
    : 'rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800';
}

function selectItemClass(isActive) {
  return isActive
    ? 'w-full rounded-xl border border-cyan-500/70 bg-cyan-900/30 px-3 py-2 text-left text-sm text-cyan-50'
    : 'w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900';
}

function fieldClass() {
  return 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500';
}

export default function AdminTelegramContentManagementView() {
  const navigate = useNavigate();
  const [templateState, dispatchTemplateState] = useReducer(
    reduceTelegramEditorState,
    TELEGRAM_EDITOR_VIEW_STATES.IDLE
  );
  const [contentState, dispatchContentState] = useReducer(
    reduceTelegramEditorState,
    TELEGRAM_EDITOR_VIEW_STATES.IDLE
  );
  const [loadingError, setLoadingError] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [contentError, setContentError] = useState('');
  const [templateList, setTemplateList] = useState({ items: [] });
  const [managedContentList, setManagedContentList] = useState({ items: [] });
  const [faqProjection, setFaqProjection] = useState({ item_count: 0, items: [] });
  const [usefulProjection, setUsefulProjection] = useState({ item_count: 0, items: [] });
  const [selectedTemplateReference, setSelectedTemplateReference] = useState(null);
  const [selectedContentReference, setSelectedContentReference] = useState(null);
  const [templateDrafts, setTemplateDrafts] = useState({});
  const [contentDrafts, setContentDrafts] = useState({});
  const [templateFilter, setTemplateFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState('all');

  const refreshAll = useCallback(async () => {
    dispatchTemplateState({ type: 'start_load' });
    dispatchContentState({ type: 'start_load' });
    setLoadingError('');
    setTemplateError('');
    setContentError('');

    try {
      const [templateResult, managedResult, faqResult, usefulResult] = await Promise.all([
        apiClient.getTelegramAdminServiceMessageTemplates(),
        apiClient.getTelegramAdminManagedContent({
          contentGroups: MANAGED_CONTENT_GROUP_FILTER,
        }),
        apiClient.getTelegramAdminFaq(),
        apiClient.getTelegramAdminUsefulContentFeed(),
      ]);
      setTemplateList(templateResult || { items: [] });
      setManagedContentList(managedResult || { items: [] });
      setFaqProjection(faqResult || { item_count: 0, items: [] });
      setUsefulProjection(usefulResult || { item_count: 0, items: [] });
      setSelectedTemplateReference((previous) => {
        if (
          previous &&
          Array.isArray(templateResult?.items) &&
          templateResult.items.some((item) => item.template_reference === previous)
        ) {
          return previous;
        }
        return templateResult?.items?.[0]?.template_reference || null;
      });
      setSelectedContentReference((previous) => {
        if (
          previous &&
          Array.isArray(managedResult?.items) &&
          managedResult.items.some((item) => item.content_reference === previous)
        ) {
          return previous;
        }
        return managedResult?.items?.[0]?.content_reference || null;
      });
      dispatchTemplateState({ type: 'load_success' });
      dispatchContentState({ type: 'load_success' });
    } catch (error) {
      const message = resolveTelegramEditorErrorMessage(
        error,
        'Не удалось загрузить данные управления контентом Telegram'
      );
      setLoadingError(message);
      dispatchTemplateState({ type: 'load_error' });
      dispatchContentState({ type: 'load_error' });
    }
  }, []);

  useEffect(() => {
    if (templateState === TELEGRAM_EDITOR_VIEW_STATES.IDLE && contentState === TELEGRAM_EDITOR_VIEW_STATES.IDLE) {
      refreshAll();
    }
  }, [templateState, contentState, refreshAll]);

  const model = useMemo(
    () =>
      buildTelegramAdminContentModel({
        templateList,
        managedContentList,
        faqProjection,
        usefulProjection,
        selectedTemplateReference,
        selectedContentReference,
        templateDrafts,
        contentDrafts,
      }),
    [
      templateList,
      managedContentList,
      faqProjection,
      usefulProjection,
      selectedTemplateReference,
      selectedContentReference,
      templateDrafts,
      contentDrafts,
    ]
  );

  const visibleTemplates = useMemo(() => {
    if (templateFilter === 'all') return model.templates;
    return model.templates.filter((item) => item.template_category === templateFilter);
  }, [model.templates, templateFilter]);

  const visibleContentItems = useMemo(() => {
    if (contentFilter === 'all') return model.managedContentItems;
    return model.managedContentItems.filter((item) => item.content_category === contentFilter);
  }, [model.managedContentItems, contentFilter]);

  const selectedTemplate = model.selectedTemplate;
  const selectedContent = model.selectedContent;
  const selectedTemplateDraft = selectedTemplate
    ? templateDrafts[selectedTemplate.template_reference] ||
      createTelegramTemplateDraft(selectedTemplate)
    : createTelegramTemplateDraft(null);
  const selectedContentDraft = selectedContent
    ? contentDrafts[selectedContent.content_reference] ||
      createTelegramManagedContentDraft(selectedContent)
    : createTelegramManagedContentDraft(null);

  const saveTemplate = useCallback(async () => {
    if (!selectedTemplate) return;

    const expectedVersion = normalizeVersion(
      selectedTemplate?.version_summary?.template_version
    );
    dispatchTemplateState({ type: 'start_save' });
    setTemplateError('');

    try {
      await apiClient.updateTelegramAdminServiceMessageTemplate(
        selectedTemplate.template_reference,
        {
          expected_version: expectedVersion,
          title_name_summary: selectedTemplateDraft.title,
          text_body_summary: selectedTemplateDraft.body,
          enabled: Boolean(selectedTemplateDraft.enabled),
        }
      );
      await refreshAll();
      dispatchTemplateState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramEditorErrorMessage(
        error,
        'Ошибка сохранения шаблона'
      );
      setTemplateError(message);
      dispatchTemplateState({ type: 'save_error', errorMessage: message });
      await refreshAll();
    }
  }, [selectedTemplate, selectedTemplateDraft, refreshAll]);

  const toggleTemplateEnabled = useCallback(async () => {
    if (!selectedTemplate) return;

    const expectedVersion = normalizeVersion(
      selectedTemplate?.version_summary?.template_version
    );
    const nextEnabled = !selectedTemplateDraft.enabled;
    dispatchTemplateState({ type: 'start_save' });
    setTemplateError('');

    try {
      await apiClient.setTelegramAdminServiceMessageTemplateEnabled(
        selectedTemplate.template_reference,
        {
          enabled: nextEnabled,
          expectedVersion,
        }
      );
      setTemplateDrafts((previous) => ({
        ...previous,
        [selectedTemplate.template_reference]: {
          ...selectedTemplateDraft,
          enabled: nextEnabled,
        },
      }));
      await refreshAll();
      dispatchTemplateState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramEditorErrorMessage(
        error,
        'Ошибка включения/отключения шаблона'
      );
      setTemplateError(message);
      dispatchTemplateState({ type: 'save_error', errorMessage: message });
      await refreshAll();
    }
  }, [selectedTemplate, selectedTemplateDraft, refreshAll]);

  const saveManagedContent = useCallback(async () => {
    if (!selectedContent) return;

    const expectedVersion = normalizeVersion(
      selectedContent?.version_summary?.content_version
    );
    dispatchContentState({ type: 'start_save' });
    setContentError('');

    try {
      await apiClient.updateTelegramAdminManagedContentItem(
        selectedContent.content_reference,
        {
          expected_version: expectedVersion,
          title_summary: selectedContentDraft.title,
          short_text_summary: selectedContentDraft.shortText,
          is_enabled: Boolean(selectedContentDraft.enabled),
        }
      );
      await refreshAll();
      dispatchContentState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramEditorErrorMessage(
        error,
        'Ошибка сохранения контента'
      );
      setContentError(message);
      dispatchContentState({ type: 'save_error', errorMessage: message });
      await refreshAll();
    }
  }, [selectedContent, selectedContentDraft, refreshAll]);

  const toggleManagedContentEnabled = useCallback(async () => {
    if (!selectedContent) return;

    const expectedVersion = normalizeVersion(
      selectedContent?.version_summary?.content_version
    );
    const nextEnabled = !selectedContentDraft.enabled;
    dispatchContentState({ type: 'start_save' });
    setContentError('');

    try {
      await apiClient.setTelegramAdminManagedContentEnabled(
        selectedContent.content_reference,
        {
          enabled: nextEnabled,
          expectedVersion,
        }
      );
      setContentDrafts((previous) => ({
        ...previous,
        [selectedContent.content_reference]: {
          ...selectedContentDraft,
          enabled: nextEnabled,
        },
      }));
      await refreshAll();
      dispatchContentState({ type: 'save_success' });
    } catch (error) {
      const message = resolveTelegramEditorErrorMessage(
        error,
        'Ошибка включения/отключения контента'
      );
      setContentError(message);
      dispatchContentState({ type: 'save_error', errorMessage: message });
      await refreshAll();
    }
  }, [selectedContent, selectedContentDraft, refreshAll]);

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      data-testid="telegram-content-management-screen"
    >
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Управление контентом Telegram</h1>
            <p className="mt-1 text-xs text-slate-400">
              Экран супер-администратора для шаблонов, FAQ и полезных материалов.
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
              onClick={() => navigate('/admin/telegram-analytics')}
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
              onClick={refreshAll}
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
            <div className="text-xs uppercase text-slate-400">Шаблоны</div>
            <div className="mt-1 text-xl font-semibold">{model.templates.length}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Контент</div>
            <div className="mt-1 text-xl font-semibold">{model.managedContentItems.length}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Опубликовано FAQ</div>
            <div className="mt-1 text-xl font-semibold">{model.projections.faqItemCount}</div>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-xs uppercase text-slate-400">Опубликовано карточек</div>
            <div className="mt-1 text-xl font-semibold">{model.projections.usefulItemCount}</div>
          </article>
        </section>

        {loadingError ? (
          <div className="rounded-2xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm text-rose-100">
            {loadingError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Шаблоны бота и сервисных сообщений</h2>
              <span className={stateBadgeClass(templateState)}>{stateLabel(templateState)}</span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {['all', 'service', 'reminder', 'post_trip'].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={filterButtonClass(templateFilter === filter)}
                  onClick={() => setTemplateFilter(filter)}
                >
                  {filter === 'all' ? 'Все' : templateCategoryLabel(filter)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_1fr]">
              <aside className="max-h-[420px] overflow-auto pr-1">
                <div className="space-y-2">
                  {visibleTemplates.map((item) => (
                    <button
                      key={item.template_reference}
                      type="button"
                      className={selectItemClass(
                        selectedTemplate?.template_reference === item.template_reference
                      )}
                      onClick={() => {
                        setSelectedTemplateReference(item.template_reference);
                        setTemplateDrafts((previous) => ({
                          ...previous,
                          [item.template_reference]:
                            previous[item.template_reference] ||
                            createTelegramTemplateDraft(item),
                        }));
                        dispatchTemplateState({ type: 'reset_feedback' });
                      }}
                    >
                      <div className="font-medium">{item.template_reference}</div>
                      <div className="mt-1 text-xs opacity-80">
                        {templateCategoryLabel(item.template_category)} | v
                        {item.version_summary?.template_version}
                      </div>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="space-y-3">
                {selectedTemplate ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                        Заголовок
                      </label>
                      <input
                        className={fieldClass()}
                        value={selectedTemplateDraft.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          setTemplateDrafts((previous) => ({
                            ...previous,
                            [selectedTemplate.template_reference]: {
                              ...selectedTemplateDraft,
                              title: value,
                            },
                          }));
                          dispatchTemplateState({ type: 'reset_feedback' });
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                        Текст
                      </label>
                      <textarea
                        className={fieldClass()}
                        rows={5}
                        value={selectedTemplateDraft.body}
                        onChange={(event) => {
                          const value = event.target.value;
                          setTemplateDrafts((previous) => ({
                            ...previous,
                            [selectedTemplate.template_reference]: {
                              ...selectedTemplateDraft,
                              body: value,
                            },
                          }));
                          dispatchTemplateState({ type: 'reset_feedback' });
                        }}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedTemplateDraft.enabled)}
                        onChange={(event) => {
                          const value = event.target.checked;
                          setTemplateDrafts((previous) => ({
                            ...previous,
                            [selectedTemplate.template_reference]: {
                              ...selectedTemplateDraft,
                              enabled: value,
                            },
                          }));
                          dispatchTemplateState({ type: 'reset_feedback' });
                        }}
                      />
                      Включён
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-cyan-500/60 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/45"
                        onClick={saveTemplate}
                      >
                        Сохранить шаблон (с защитой версий)
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                        onClick={toggleTemplateEnabled}
                      >
                        {selectedTemplateDraft.enabled ? 'Отключить' : 'Включить'}
                      </button>
                    </div>
                    {templateError ? (
                      <div className="rounded-xl border border-rose-600/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-100">
                        {templateError}
                      </div>
                    ) : null}
                    <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                        Предпросмотр шаблона
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100">
                        {model.selectedTemplatePreview.headline}
                      </h3>
                      <p className="mt-2 text-sm text-slate-300">
                        {model.selectedTemplatePreview.body}
                      </p>
                      <div className="mt-2 text-xs text-slate-400">
                        Включён: {model.selectedTemplatePreview.enabled ? 'да' : 'нет'} | Резерв:{' '}
                        {model.selectedTemplatePreview.fallbackUsed ? 'используется резервный' : 'нет'}
                      </div>
                    </article>
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
                    Шаблон не выбран.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">FAQ и полезные материалы</h2>
              <span className={stateBadgeClass(contentState)}>{stateLabel(contentState)}</span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {['all', 'faq', 'useful'].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={filterButtonClass(contentFilter === filter)}
                  onClick={() => setContentFilter(filter)}
                >
                  {filter === 'all' ? 'Все' : contentCategoryLabel(filter)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_1fr]">
              <aside className="max-h-[420px] overflow-auto pr-1">
                <div className="space-y-2">
                  {visibleContentItems.map((item) => (
                    <button
                      key={item.content_reference}
                      type="button"
                      className={selectItemClass(
                        selectedContent?.content_reference === item.content_reference
                      )}
                      onClick={() => {
                        setSelectedContentReference(item.content_reference);
                        setContentDrafts((previous) => ({
                          ...previous,
                          [item.content_reference]:
                            previous[item.content_reference] ||
                            createTelegramManagedContentDraft(item),
                        }));
                        dispatchContentState({ type: 'reset_feedback' });
                      }}
                    >
                      <div className="font-medium">{item.content_reference}</div>
                      <div className="mt-1 text-xs opacity-80">
                        {contentCategoryLabel(item.content_category)} | v
                        {item.version_summary?.content_version}
                      </div>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="space-y-3">
                {selectedContent ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                        Title
                      </label>
                      <input
                        className={fieldClass()}
                        value={selectedContentDraft.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContentDrafts((previous) => ({
                            ...previous,
                            [selectedContent.content_reference]: {
                              ...selectedContentDraft,
                              title: value,
                            },
                          }));
                          dispatchContentState({ type: 'reset_feedback' });
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
                        Краткий текст
                      </label>
                      <textarea
                        className={fieldClass()}
                        rows={5}
                        value={selectedContentDraft.shortText}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContentDrafts((previous) => ({
                            ...previous,
                            [selectedContent.content_reference]: {
                              ...selectedContentDraft,
                              shortText: value,
                            },
                          }));
                          dispatchContentState({ type: 'reset_feedback' });
                        }}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedContentDraft.enabled)}
                        onChange={(event) => {
                          const value = event.target.checked;
                          setContentDrafts((previous) => ({
                            ...previous,
                            [selectedContent.content_reference]: {
                              ...selectedContentDraft,
                              enabled: value,
                            },
                          }));
                          dispatchContentState({ type: 'reset_feedback' });
                        }}
                      />
                      Включён
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-cyan-500/60 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-900/45"
                        onClick={saveManagedContent}
                      >
                        Сохранить контент (с защитой версий)
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                        onClick={toggleManagedContentEnabled}
                      >
                        {selectedContentDraft.enabled ? 'Отключить' : 'Включить'}
                      </button>
                    </div>
                    {contentError ? (
                      <div className="rounded-xl border border-rose-600/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-100">
                        {contentError}
                      </div>
                    ) : null}
                    <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                        Предпросмотр контента
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100">
                        {model.selectedContentPreview.title}
                      </h3>
                      <p className="mt-2 text-sm text-slate-300">
                        {model.selectedContentPreview.shortText}
                      </p>
                      <div className="mt-2 text-xs text-slate-400">
                        Включён: {model.selectedContentPreview.enabled ? 'да' : 'нет'} | Резерв:{' '}
                        {model.selectedContentPreview.fallbackUsed
                          ? 'используется резервный'
                          : 'нет'}
                      </div>
                    </article>
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-400">
                    Карточка контента не выбрана.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
