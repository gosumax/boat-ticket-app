import { describe, expect, it } from 'vitest';
import {
  MINI_APP_CONTACT_RENDER_STATES,
  MINI_APP_FAQ_RENDER_STATES,
  buildMiniAppContactViewModel,
  buildMiniAppFaqViewModel,
  resolveMiniAppContactRenderState,
  resolveMiniAppFaqRenderState,
} from '../../src/telegram/faq-contact-view-model.js';

describe('telegram mini app faq/contact view model', () => {
  it('supports deterministic FAQ and Contact render-state transitions', () => {
    expect(resolveMiniAppFaqRenderState({})).toBe('idle');
    expect(resolveMiniAppFaqRenderState({ loading: true })).toBe('loading');
    expect(resolveMiniAppFaqRenderState({ error: 'network_error' })).toBe('error');
    expect(
      resolveMiniAppFaqRenderState({
        faqScreenContent: { entrypoint_key: 'faq' },
      })
    ).toBe('ready');

    expect(resolveMiniAppContactRenderState({})).toBe('idle');
    expect(resolveMiniAppContactRenderState({ loading: true })).toBe('loading');
    expect(resolveMiniAppContactRenderState({ error: 'network_error' })).toBe('error');
    expect(
      resolveMiniAppContactRenderState({
        contactScreenContent: { entrypoint_key: 'contact' },
      })
    ).toBe('ready');

    expect(MINI_APP_FAQ_RENDER_STATES).toEqual(['idle', 'loading', 'error', 'ready']);
    expect(MINI_APP_CONTACT_RENDER_STATES).toEqual(['idle', 'loading', 'error', 'ready']);
  });

  it('builds stable FAQ screen model from FAQ read model content', () => {
    const viewModel = buildMiniAppFaqViewModel({
      faqScreenContent: {
        entrypoint_key: 'faq',
        fallback_content_used: false,
        title: 'FAQ',
        body: 'Questions available: 2.',
        faq_read_model: {
          item_count: 2,
          items: [
            {
              faq_reference: 'tg_faq_general_001',
              title_short_text_summary: {
                title: 'When should I arrive?',
                short_text: 'Arrive at least 15 minutes before departure.',
              },
              content_type_summary: {
                content_grouping: 'faq_general',
              },
            },
            {
              faq_reference: 'tg_faq_trip_rules_002',
              title_short_text_summary: {
                title: 'Is smoking allowed?',
                short_text: 'Smoking is not allowed during passenger trips.',
              },
              content_type_summary: {
                content_grouping: 'faq_trip_rules',
              },
            },
          ],
        },
      },
    });

    expect(viewModel).toEqual({
      renderState: 'ready',
      entrypointKey: 'faq',
      title: 'FAQ',
      body: 'Questions available: 2.',
      errorMessage: null,
      fallbackUsed: false,
      questionCount: 2,
      faqItems: [
        {
          faqReference: 'tg_faq_general_001',
          title: 'When should I arrive?',
          shortText: 'Arrive at least 15 minutes before departure.',
          contentGrouping: 'faq_general',
        },
        {
          faqReference: 'tg_faq_trip_rules_002',
          title: 'Is smoking allowed?',
          shortText: 'Smoking is not allowed during passenger trips.',
          contentGrouping: 'faq_trip_rules',
        },
      ],
      hasFaqItems: true,
    });
  });

  it('builds stable Contact screen model with phone and support notes', () => {
    const viewModel = buildMiniAppContactViewModel({
      contactScreenContent: {
        entrypoint_key: 'contact',
        fallback_content_used: false,
        title: 'Contact',
        body: 'Preferred contact: +79990000000.',
        contact_read_model: {
          applicability_state: 'guest_profile_context',
          preferred_contact_phone_e164: '+79990000000',
          support_action_reference: 'contact_support',
          trip_help_feed_summary: {
            item_count: 1,
            items: [
              {
                content_reference: 'tg_trip_help_001',
                title_short_text_summary: {
                  title: 'How to contact support',
                  short_text: 'Use your booking reference when contacting support.',
                },
                content_type_summary: {
                  content_grouping: 'trip_help',
                },
              },
            ],
          },
        },
      },
    });

    expect(viewModel).toEqual({
      renderState: 'ready',
      entrypointKey: 'contact',
      title: 'Contact',
      body: 'Preferred contact: +79990000000.',
      errorMessage: null,
      fallbackUsed: false,
      applicabilityState: 'guest_profile_context',
      contactPhone: '+79990000000',
      contactCallHref: 'tel:+79990000000',
      supportActionReference: 'contact_support',
      supportItemCount: 1,
      supportItems: [
        {
          contentReference: 'tg_trip_help_001',
          title: 'How to contact support',
          shortText: 'Use your booking reference when contacting support.',
          contentGrouping: 'trip_help',
        },
      ],
      hasSupportItems: true,
    });
  });

  it('keeps deterministic fallback for not-applicable contact screen state', () => {
    const viewModel = buildMiniAppContactViewModel({
      contactScreenContent: {
        entrypoint_key: 'contact',
        fallback_content_used: true,
        title: 'Contact',
        body: 'Support contact and help notes are available in this section.',
        contact_read_model: {
          applicability_state: 'not_applicable',
          preferred_contact_phone_e164: null,
          trip_help_feed_summary: {
            item_count: 0,
            items: [],
          },
        },
      },
      error: 'temporary_network_error',
    });

    expect(viewModel.renderState).toBe('error');
    expect(viewModel.errorMessage).toBe('temporary_network_error');
    expect(viewModel.fallbackUsed).toBe(true);
    expect(viewModel.applicabilityState).toBe('not_applicable');
    expect(viewModel.contactPhone).toBe(null);
    expect(viewModel.hasSupportItems).toBe(false);
  });
});
