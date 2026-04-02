export const OWNER_SETTINGS_DEFAULTS = {
  businessName: "РњРѕСЂСЃРєРёРµ РїСЂРѕРіСѓР»РєРё",
  timezone: "Europe/Moscow (UTC+3)",
  currency: "RUB",
  seasonStart: "2026-05-01",
  seasonEnd: "2026-10-01",

  badDay: 350000,
  normalDay: 550000,
  goodDay: 800000,
  baseCompareDays: 7,

  motivationType: "team",
  motivation_percent: 0.15,
  weekly_percent: 0.01,
  season_percent: 0.02,
  individual_share: 0.60,
  team_share: 0.40,
  daily_activation_threshold: 200000,
  seller_series_threshold: 40000,
  dispatchers_series_threshold: 55000,
  season_min_days_N: 1,

  teamIncludeSellers: true,
  teamIncludeDispatchers: true,

  k_speed: 1.2,
  k_cruise: 3.0,
  k_fishing: 5.0,
  k_zone_hedgehog: 1.3,
  k_zone_center: 1.0,
  k_zone_sanatorium: 0.8,
  k_zone_stationary: 0.7,
  k_banana_hedgehog: 2.7,
  k_banana_center: 2.2,
  k_banana_sanatorium: 1.2,
  k_banana_stationary: 1.0,
  k_dispatchers: 1.0,

  lowLoad: 45,
  highLoad: 85,
  minSellerRevenue: 30000,
  notifyBadRevenue: true,
  notifyLowLoad: true,
  notifyLowSeller: false,
  notifyChannel: "inapp",

  viklif_withhold_percent_total: 0,
  dispatcher_withhold_percent_total: 0.002,
  weekly_withhold_percent_total: 0.008,
  season_withhold_percent_total: 0.005,
};

export function parseOwnerSettingsJson(settingsJson) {
  try {
    return settingsJson ? JSON.parse(settingsJson) : {};
  } catch {
    return {};
  }
}

export function mergeOwnerSettings(settings = {}) {
  return {
    ...OWNER_SETTINGS_DEFAULTS,
    ...(settings || {}),
  };
}

export function resolveOwnerSettings(db) {
  try {
    const row = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
    return mergeOwnerSettings(parseOwnerSettingsJson(row?.settings_json));
  } catch {
    return mergeOwnerSettings();
  }
}
