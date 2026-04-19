import { describe, expect, it } from 'vitest';
import {
  buildTelegramAdminContentModel,
  classifyTelegramEditorStateByError,
  createTelegramManagedContentDraft,
  createTelegramTemplateDraft,
  reduceTelegramEditorState,
  resolveManagedContentPreview,
  resolveTemplatePreview,
  TELEGRAM_EDITOR_VIEW_STATES,
} from '../../src/telegram/admin-telegram-content-management-model.js';

describe('telegram admin content-management model', () => {
  it('builds normalized screen model with deterministic selections and category buckets', () => {
    const model = buildTelegramAdminContentModel({
      templateList: {
        items: [
          {
            template_reference: 'tg_service_message_template_post_trip_review_request',
            template_type: 'post_trip_review_request',
            title_name_summary: { title_name: 'Review Request' },
            text_body_summary: { text_body: 'Please leave review.' },
            enabled_state_summary: { enabled: true },
            version_summary: { template_version: 2 },
          },
          {
            template_reference: 'tg_service_message_template_1_hour_before_trip',
            template_type: '1_hour_before_trip',
            title_name_summary: { title_name: '1h Reminder' },
            text_body_summary: { text_body: 'Trip starts in 1 hour.' },
            enabled_state_summary: { enabled: true },
            version_summary: { template_version: 1 },
          },
        ],
      },
      managedContentList: {
        items: [
          {
            content_reference: 'tg_faq_general_001',
            content_type_group_summary: {
              content_group: 'faq_general',
            },
            title_summary: { title: 'FAQ title' },
            short_text_summary: { short_text: 'FAQ text' },
            visibility_enabled_summary: { enabled: true },
            version_summary: { content_version: 1 },
          },
          {
            content_reference: 'tg_useful_places_001',
            content_type_group_summary: {
              content_group: 'useful_places',
            },
            title_summary: { title: 'Useful title' },
            short_text_summary: { short_text: 'Useful text' },
            visibility_enabled_summary: { enabled: true },
            version_summary: { content_version: 1 },
          },
        ],
      },
      faqProjection: { item_count: 3 },
      usefulProjection: { item_count: 5 },
    });

    expect(model.templates.length).toBe(2);
    expect(model.managedContentItems.length).toBe(2);
    expect(model.selectedTemplate.template_reference).toBe(
      'tg_service_message_template_1_hour_before_trip'
    );
    expect(model.selectedTemplate.template_category).toBe('reminder');
    expect(model.selectedContent.content_reference).toBe('tg_faq_general_001');
    expect(model.selectedContent.content_category).toBe('faq');
    expect(model.projections).toEqual({
      faqItemCount: 3,
      usefulItemCount: 5,
    });
  });

  it('builds fallback preview states for templates/content when drafts are blank', () => {
    const templateItem = {
      template_reference: 'tg_service_message_template_30_minutes_before_trip',
      template_type: '30_minutes_before_trip',
      title_name_summary: { title_name: '' },
      text_body_summary: { text_body: '' },
      enabled_state_summary: { enabled: false },
    };
    const templatePreview = resolveTemplatePreview(templateItem, {
      ...createTelegramTemplateDraft(templateItem),
      title: ' ',
      body: '',
      enabled: false,
    });
    expect(templatePreview.enabled).toBe(false);
    expect(templatePreview.fallbackUsed).toBe(true);
    expect(templatePreview.headline).toBeTruthy();
    expect(templatePreview.body).toBeTruthy();

    const contentItem = {
      content_reference: 'tg_faq_general_001',
      content_type_group_summary: { content_group: 'faq_general' },
      title_summary: { title: '' },
      short_text_summary: { short_text: '' },
      visibility_enabled_summary: { enabled: true },
    };
    const contentPreview = resolveManagedContentPreview(contentItem, {
      ...createTelegramManagedContentDraft(contentItem),
      title: '',
      shortText: ' ',
    });
    expect(contentPreview.enabled).toBe(true);
    expect(contentPreview.fallbackUsed).toBe(true);
    expect(contentPreview.title).toBeTruthy();
    expect(contentPreview.shortText).toBeTruthy();
  });

  it('tracks UI state transitions and classifies version conflicts separately', () => {
    const afterLoadStart = reduceTelegramEditorState(TELEGRAM_EDITOR_VIEW_STATES.IDLE, {
      type: 'start_load',
    });
    const afterLoadSuccess = reduceTelegramEditorState(afterLoadStart, {
      type: 'load_success',
    });
    const afterSaveStart = reduceTelegramEditorState(afterLoadSuccess, {
      type: 'start_save',
    });
    const afterSaveSuccess = reduceTelegramEditorState(afterSaveStart, {
      type: 'save_success',
    });
    const afterReset = reduceTelegramEditorState(afterSaveSuccess, {
      type: 'reset_feedback',
    });

    expect(afterLoadStart).toBe(TELEGRAM_EDITOR_VIEW_STATES.LOADING);
    expect(afterLoadSuccess).toBe(TELEGRAM_EDITOR_VIEW_STATES.READY);
    expect(afterSaveStart).toBe(TELEGRAM_EDITOR_VIEW_STATES.SAVING);
    expect(afterSaveSuccess).toBe(TELEGRAM_EDITOR_VIEW_STATES.SAVED);
    expect(afterReset).toBe(TELEGRAM_EDITOR_VIEW_STATES.READY);

    expect(
      classifyTelegramEditorStateByError(
        'version conflict for template reference tg_service_message_template_hold_extended'
      )
    ).toBe(TELEGRAM_EDITOR_VIEW_STATES.CONFLICT);
    expect(classifyTelegramEditorStateByError('unexpected server error')).toBe(
      TELEGRAM_EDITOR_VIEW_STATES.ERROR
    );
  });
});
