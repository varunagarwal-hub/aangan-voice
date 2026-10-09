/**
 * HubSpot CRM, date-versioned API (default 2026-09).
 * Docs: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide
 *       https://developers.hubspot.com/docs/api-reference/latest/crm/objects/deals/batch/upsert-deals
 *       https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide
 * Idempotency: contacts upsert on custom unique `aangan_contact_key`, deals upsert on unique `aangan_call_id`.
 * Running the sync twice for the same call updates, never duplicates.
 */
import { env, need } from "../env";
import { q } from "../db";
import { fetchJson, HttpError } from "./http";

const BASE = "https://api.hubapi.com";
const hdrs = () => ({ Authorization: `Bearer ${need(env.hubspotToken, "HUBSPOT_TOKEN")}`, "Content-Type": "application/json" });

export const CONTACT_PROPERTIES = [
  { name: "aangan_contact_key", label: "Aangan contact key", type: "string", fieldType: "text", hasUniqueValue: true },
];
export const DEAL_PROPERTIES = [
  { name: "aangan_call_id", label: "Aangan call ID", type: "string", fieldType: "text", hasUniqueValue: true },
  { name: "aangan_lead_ref", label: "Aangan lead ref", type: "string", fieldType: "text" },
  { name: "aangan_outcome", label: "Aangan qualification outcome", type: "string", fieldType: "text" },
  { name: "aangan_priority", label: "Aangan priority (1-5)", type: "number", fieldType: "number" },
  { name: "aangan_after_hours", label: "Aangan after-hours call", type: "bool", fieldType: "booleancheckbox",
    options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }] },
  { name: "aangan_consultation_at", label: "Aangan consultation time", type: "string", fieldType: "text" },
  { name: "aangan_call_cost_inr", label: "Aangan call cost total (INR)", type: "number", fieldType: "number" },
  { name: "aangan_cost_vaani_inr", label: "Aangan cost - Vaani (INR)", type: "number", fieldType: "number" },
  { name: "aangan_cost_telephony_inr", label: "Aangan cost - telephony (INR)", type: "number", fieldType: "number" },
  { name: "aangan_cost_gemini_inr", label: "Aangan cost - Gemini (INR)", type: "number", fieldType: "number" },
  { name: "aangan_internal_estimate", label: "Aangan internal estimate (never quote)", type: "string", fieldType: "textarea" },
  { name: "aangan_summary", label: "Aangan call summary", type: "string", fieldType: "textarea" },
  { name: "aangan_designer_brief", label: "Aangan designer brief", type: "string", fieldType: "textarea" },
  { name: "aangan_dashboard_url", label: "Aangan dashboard link", type: "string", fieldType: "text" },
];

/** One-time setup: create the custom properties (scripts/hubspot-setup.ts). 409 = already exists. */
export async function ensureProperties(log: (s: string) => void = console.log) {
  const v = env.hubspotApiVersion;
  for (const [object, props, group] of [
    ["contacts", CONTACT_PROPERTIES, "contactinformation"],
    ["deals", DEAL_PROPERTIES, "dealinformation"],
  ] as const) {
    for (const p of props) {
      try {
        await fetchJson(`${BASE}/crm/properties/${v}/${object}`, { method: "POST", headers: hdrs(), body: JSON.stringify({ groupName: group, ...p }) });
        log(`created ${object}.${p.name}`);
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) log(`exists  ${object}.${p.name}`);
        else throw err;
      }
    }
  }
}

export async function listDealStages() {
  return fetchJson(`${BASE}/crm/pipelines/${env.hubspotApiVersion}/deals`, { headers: hdrs() });
}

export interface HubspotSyncInput {
  callId: string;
  contact: { key: string; name?: string | null; phone?: string | null; email?: string | null; city?: string | null };
  deal: { name: string; stage: keyof ReturnType<typeof stageMap>; properties: Record<string, string | number | boolean | null | undefined> };
}
const stageMap = () => env.hubspotStage;

export async function syncToHubspot(input: HubspotSyncInput): Promise<{ contactId: string; dealId: string }> {
  if (env.mockFails("hubspot")) throw new Error("MOCK_FAIL: hubspot");
  if (env.mock) {
    await q(`INSERT INTO mock_outbox (channel, payload) VALUES ('hubspot', $1)`, [JSON.stringify(input)]);
    return { contactId: `mock-contact-${input.contact.key}`, dealId: `mock-deal-${input.callId}` };
  }
  const v = env.hubspotApiVersion;
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== null && x !== "").map(([k, x]) => [k, String(x)]));

  const contactRes = await fetchJson<any>(`${BASE}/crm/objects/${v}/contacts/batch/upsert`, {
    method: "POST", headers: hdrs(),
    body: JSON.stringify({ inputs: [{
      id: input.contact.key, idProperty: "aangan_contact_key",
      properties: strip({ aangan_contact_key: input.contact.key, firstname: input.contact.name, phone: input.contact.phone, email: input.contact.email, city: input.contact.city }),
    }] }),
  });
  const contactId = String(contactRes.results?.[0]?.id ?? "");
  if (!contactId) throw new Error(`HubSpot contact upsert returned no id: ${JSON.stringify(contactRes).slice(0, 300)}`);

  const dealRes = await fetchJson<any>(`${BASE}/crm/objects/${v}/0-3/batch/upsert`, {
    method: "POST", headers: hdrs(),
    body: JSON.stringify({ inputs: [{
      id: input.callId, idProperty: "aangan_call_id",
      properties: strip({
        dealname: input.deal.name, pipeline: env.hubspotPipeline, dealstage: stageMap()[input.deal.stage],
        aangan_call_id: input.callId, ...input.deal.properties,
      }),
    }] }),
  });
  const dealId = String(dealRes.results?.[0]?.id ?? "");
  if (!dealId) throw new Error(`HubSpot deal upsert returned no id: ${JSON.stringify(dealRes).slice(0, 300)}`);

  // Default (unlabelled) association; PUT is idempotent.
  await fetchJson(`${BASE}/crm/v4/objects/deal/${dealId}/associations/default/contact/${contactId}`, { method: "PUT", headers: hdrs() });
  return { contactId, dealId };
}
