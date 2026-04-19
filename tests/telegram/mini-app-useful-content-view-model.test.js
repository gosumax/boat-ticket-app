import { describe, expect, it } from 'vitest';
import {
  MINI_APP_USEFUL_CONTENT_RENDER_STATES,
  buildMiniAppUsefulContentViewModel,
  resolveMiniAppUsefulContentRenderState,
} from '../../src/telegram/useful-content-view-model.js';

describe('telegram mini app useful-content view model', () => {
  it('supports deterministic useful-content render-state transitions', () => {
    const idleState = resolveMiniAppUsefulContentRenderState({});
    const loadingState = resolveMiniAppUsefulContentRenderState({ loading: true });
    const errorState = resolveMiniAppUsefulContentRenderState({ error: 'network_error' });
    const readyState = resolveMiniAppUsefulContentRenderState({
      usefulScreenContent: {
        entrypoint_key: 'useful_content',
      },
    });

    expect(idleState).toBe('idle');
    expect(loadingState).toBe('loading');
    expect(errorState).toBe('error');
    expect(readyState).toBe('ready');
    expect(MINI_APP_USEFUL_CONTENT_RENDER_STATES).toEqual([
      'idle',
      'loading',
      'error',
      'ready',
    ]);
  });

  it('builds stable useful-content read model for weather-aware ready state', () => {
    const viewModel = buildMiniAppUsefulContentViewModel({
      usefulScreenContent: {
        entrypoint_key: 'useful_content',
        fallback_used: false,
        title: 'Weather-aware trip tips',
        body: 'Rain is possible. Bring a waterproof layer.',
        useful_content_read_model: {
          weather_summary: {
            weather_data_state: 'available',
          },
          trip_context_summary: {
            applicability_state: 'upcoming_trip_selected',
          },
          weather_caring_content_summary: {
            reminder_status_line: 'Rain is possible. Bring a waterproof layer.',
            recommendation_lines: [
              'Rain is possible. Bring a waterproof layer.',
              'Wind can feel stronger near open water.',
            ],
          },
          useful_content_feed_summary: {
            items: [
              {
                content_reference: 'tg_useful_places_001',
                title_short_text_summary: {
                  title: 'Pier Side Coffee Point',
                  short_text: 'Coffee and water near boarding area.',
                },
                content_type_summary: {
                  content_grouping: 'useful_places',
                },
              },
            ],
          },
        },
      },
    });

    expect(viewModel).toEqual({
      renderState: 'ready',
      entrypointKey: 'useful_content',
      title: 'Weather-aware trip tips',
      body: 'Rain is possible. Bring a waterproof layer.',
      errorMessage: null,
      fallbackUsed: false,
      weatherDataState: 'available',
      reminderStatusLine: 'Rain is possible. Bring a waterproof layer.',
      tripApplicabilityState: 'upcoming_trip_selected',
      recommendationLines: [
        'Rain is possible. Bring a waterproof layer.',
        'Wind can feel stronger near open water.',
      ],
      feedItems: [
        {
          contentReference: 'tg_useful_places_001',
          title: 'Pier Side Coffee Point',
          shortText: 'Coffee and water near boarding area.',
          contentGrouping: 'useful_places',
        },
      ],
      hasUsefulItems: true,
    });
  });

  it('keeps deterministic fallback for unavailable/not-applicable useful content states', () => {
    const viewModel = buildMiniAppUsefulContentViewModel({
      usefulScreenContent: {
        entrypoint_key: 'useful_content',
        fallback_used: true,
        title: 'Useful content',
        body: 'Trip preparation notes with weather-aware hints.',
        useful_content_read_model: {
          weather_summary: {
            weather_data_state: 'unavailable',
          },
          trip_context_summary: {
            applicability_state: 'not_applicable',
          },
          weather_caring_content_summary: {
            reminder_status_line: 'Boarding is soon. Keep essentials ready.',
            recommendation_lines: ['Boarding is soon. Keep essentials ready.'],
          },
          useful_content_feed_summary: {
            items: [],
          },
        },
      },
      error: 'temporary_network_error',
    });

    expect(viewModel.renderState).toBe('error');
    expect(viewModel.errorMessage).toBe('temporary_network_error');
    expect(viewModel.fallbackUsed).toBe(true);
    expect(viewModel.weatherDataState).toBe('unavailable');
    expect(viewModel.tripApplicabilityState).toBe('not_applicable');
    expect(viewModel.recommendationLines).toEqual([
      'Boarding is soon. Keep essentials ready.',
    ]);
    expect(viewModel.hasUsefulItems).toBe(false);
  });
});
