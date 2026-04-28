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
        title: 'РџРѕР»РµР·РЅРѕРµ РІ РђСЂС…РёРїРѕ-РћСЃРёРїРѕРІРєРµ',
        body: 'РџРѕРіРѕРґР° Рё РїРѕРґР±РѕСЂРєР° РјРµСЃС‚ РґР»СЏ РѕС‚РґС‹С…Р°.',
        useful_content_read_model: {
          weather_summary: {
            weather_data_state: 'available',
            condition_label: 'РџРµСЂРµРјРµРЅРЅР°СЏ РѕР±Р»Р°С‡РЅРѕСЃС‚СЊ',
            temperature_c: 24.2,
            water_temperature_c: 21.4,
            sunset_time_iso: '2026-04-20T16:44:00.000Z',
            location_country: 'Р РѕСЃСЃРёР№СЃРєР°СЏ Р¤РµРґРµСЂР°С†РёСЏ',
            location_region: 'РљСЂР°СЃРЅРѕРґР°СЂСЃРєРёР№ РєСЂР°Р№',
            location_locality: 'РђСЂС…РёРїРѕ-РћСЃРёРїРѕРІРєР°',
            location_water_body: 'Р§С‘СЂРЅРѕРµ РјРѕСЂРµ',
          },
          trip_context_summary: {
            applicability_state: 'upcoming_trip_selected',
          },
          weather_caring_content_summary: {
            reminder_status_line: 'РџРѕРіРѕРґР° СЃРїРѕРєРѕР№РЅР°СЏ Рё РєРѕРјС„РѕСЂС‚РЅР°СЏ РґР»СЏ РїСЂРѕРіСѓР»РѕРє.',
            recommendation_lines: [
              'РџРѕРіРѕРґР° СЃРїРѕРєРѕР№РЅР°СЏ Рё РєРѕРјС„РѕСЂС‚РЅР°СЏ РґР»СЏ РїСЂРѕРіСѓР»РѕРє.',
            ],
          },
          useful_content_feed_summary: {
            items: [
              {
                content_reference: 'tg_useful_places_003',
                title_short_text_summary: {
                  title: 'Р›СѓС‡С€РёРµ РјРµСЃС‚Р° РґР»СЏ С„РѕС‚Рѕ',
                  short_text: 'РўРµСЃС‚РѕРІР°СЏ РєР°СЂС‚РѕС‡РєР° РёР· Р°РґРјРёРЅРєРё.',
                },
              },
            ],
          },
        },
      },
    });

    expect(viewModel.renderState).toBe('ready');
    expect(viewModel.entrypointKey).toBe('useful_content');
    expect(viewModel.title).toBe('РџРѕР»РµР·РЅРѕРµ РІ РђСЂС…РёРїРѕ-РћСЃРёРїРѕРІРєРµ');
    expect(viewModel.weatherDataState).toBe('available');
    expect(viewModel.weatherConditionLabel).toBe('РџРµСЂРµРјРµРЅРЅР°СЏ РѕР±Р»Р°С‡РЅРѕСЃС‚СЊ');
    expect(viewModel.airTemperatureC).toBe(24.2);
    expect(viewModel.waterTemperatureC).toBe(21.4);
    expect(viewModel.tripApplicabilityState).toBe('upcoming_trip_selected');
    expect(viewModel.resortCards).toHaveLength(3);
    expect(viewModel.resortCards[0]).toMatchObject({
      contentReference: 'tg_useful_places_003',
      title: 'Р›СѓС‡С€РёРµ РјРµСЃС‚Р° РґР»СЏ С„РѕС‚Рѕ',
      shortText: 'РўРµСЃС‚РѕРІР°СЏ РєР°СЂС‚РѕС‡РєР° РёР· Р°РґРјРёРЅРєРё.',
    });
    expect(viewModel.hasUsefulItems).toBe(true);
  });

  it('keeps deterministic fallback for unavailable/not-applicable useful content states', () => {
    const viewModel = buildMiniAppUsefulContentViewModel({
      usefulScreenContent: {
        entrypoint_key: 'useful_content',
        fallback_used: true,
        title: 'РџРѕР»РµР·РЅРѕРµ',
        body: 'РџРѕРіРѕРґР° Рё РјРµСЃС‚Р° СЂСЏРґРѕРј СЃ РјРѕСЂРµРј.',
        useful_content_read_model: {
          weather_summary: {
            weather_data_state: 'unavailable',
          },
          trip_context_summary: {
            applicability_state: 'not_applicable',
          },
          weather_caring_content_summary: {
            reminder_status_line: 'Р”Р°РЅРЅС‹Рµ РїРѕ РїРѕРіРѕРґРµ РІСЂРµРјРµРЅРЅРѕ РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ.',
            recommendation_lines: ['Р”Р°РЅРЅС‹Рµ РїРѕ РїРѕРіРѕРґРµ РІСЂРµРјРµРЅРЅРѕ РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ.'],
          },
          useful_content_feed_summary: {
            items: [],
          },
        },
      },
      error: 'temporary_network_error',
    });

    expect(viewModel.renderState).toBe('error');
    expect(viewModel.errorMessage).toBe('Не удалось загрузить данные. Попробуйте обновить.');
    expect(viewModel.fallbackUsed).toBe(true);
    expect(viewModel.weatherDataState).toBe('unavailable');
    expect(viewModel.weatherConditionLabel).toBe('Погода временно недоступна.');
    expect(viewModel.tripApplicabilityState).toBe('not_applicable');
    expect(viewModel.recommendationLines).toEqual([
      'Р”Р°РЅРЅС‹Рµ РїРѕ РїРѕРіРѕРґРµ РІСЂРµРјРµРЅРЅРѕ РѕР±РЅРѕРІР»СЏСЋС‚СЃСЏ.',
    ]);
    expect(viewModel.hasUsefulItems).toBe(true);
    expect(viewModel.resortCards).toHaveLength(3);
  });
});

