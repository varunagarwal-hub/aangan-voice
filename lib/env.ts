/** Central config. Every key is read here so .env.example stays the single list. */
const e = (k: string) => {
  const v = process.env[k];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
};
const num = (k: string) => {
  const v = e(k);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const env = {
  get mock() { return e("MOCK_MODE") === "true"; },
  /** Mock only: comma list of services to fail on purpose (calcom,telegram,hubspot,gemini,vaani). */
  mockFails(name: string) { return this.mock && (e("MOCK_FAIL") ?? "").split(",").map((s) => s.trim()).includes(name); },
  get appUrl() { return e("APP_URL") ?? "http://localhost:3000"; },

  // Security
  get toolSecret() { return e("TOOL_SECRET"); },
  get webhookSecret() { return e("VAANI_WEBHOOK_TOKEN"); },
  get vaaniSigningSecret() { return e("VAANI_WEBHOOK_SIGNING_SECRET"); },
  get cronSecret() { return e("CRON_SECRET"); },
  get dashboardPassword() { return e("DASHBOARD_PASSWORD"); },
  get sessionSecret() { return e("SESSION_SECRET") ?? e("DASHBOARD_PASSWORD") ?? "dev-only"; },

  // Database
  get databaseUrl() { return e("DATABASE_URL"); },

  // Vaani — https://docs.vaanivoice.ai
  get vaaniApiKey() { return e("VAANI_API_KEY"); },
  get vaaniBaseUrl() { return e("VAANI_BASE_URL") ?? "https://api.vaanivoice.ai"; },

  // Cal.com v2
  get calApiKey() { return e("CALCOM_API_KEY"); },
  get calEventTypeId() { return num("CALCOM_EVENT_TYPE_ID"); },
  get calBaseUrl() { return e("CALCOM_BASE_URL") ?? "https://api.cal.com"; },
  get slotSearchDays() { return num("SLOT_SEARCH_DAYS") ?? 14; },

  // Telegram
  get telegramToken() { return e("TELEGRAM_BOT_TOKEN"); },
  get telegramChatId() { return e("TELEGRAM_CHAT_ID"); },

  // HubSpot
  get hubspotToken() { return e("HUBSPOT_TOKEN"); },
  get hubspotApiVersion() { return e("HUBSPOT_API_VERSION") ?? "2026-09"; },
  get hubspotPipeline() { return e("HUBSPOT_PIPELINE") ?? "default"; },
  get hubspotStage() {
    return {
      booked: e("HUBSPOT_STAGE_BOOKED") ?? "appointmentscheduled",
      qualified: e("HUBSPOT_STAGE_QUALIFIED") ?? "qualifiedtobuy",
      not_qualified: e("HUBSPOT_STAGE_NOT_QUALIFIED") ?? "closedlost",
      other: e("HUBSPOT_STAGE_OTHER") ?? "appointmentscheduled",
    };
  },

  // Gemini
  get geminiApiKey() { return e("GEMINI_API_KEY"); },
  get geminiModel() { return e("GEMINI_MODEL") ?? "gemini-3.8-flash"; },
  get geminiThinkingLevel() { return e("GEMINI_THINKING_LEVEL") ?? "low"; },
  /** Used when the main model is overloaded (503/429) or times out. */
  get geminiFallbackModel() { return e("GEMINI_FALLBACK_MODEL") ?? "gemini-3.5-flash-lite"; },

  // Cost inputs (see README "Cost per call")
  get vaaniInrPerCredit() { return num("VAANI_INR_PER_CREDIT"); },
  get vaaniInrPerMin() { return num("VAANI_INR_PER_MIN"); },
  get vaaniCostIncludesTelephony() { return e("VAANI_COST_INCLUDES_TELEPHONY") === "true"; },
  get telephonyInrPerMin() { return num("TELEPHONY_INR_PER_MIN"); },
  get geminiUsdPer1mInput() { return num("GEMINI_USD_PER_1M_INPUT"); },
  get geminiUsdPer1mOutput() { return num("GEMINI_USD_PER_1M_OUTPUT"); },
  get usdToInr() { return num("USD_TO_INR"); },
};

export class ConfigError extends Error {}
export function need<T>(v: T | undefined, name: string): T {
  if (v === undefined) throw new ConfigError(`Missing env var ${name}`);
  return v;
}
