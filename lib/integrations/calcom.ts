/**
 * Cal.com API v2.
 * Slots:    GET  /v2/slots     cal-api-version: 2024-09-04
 * Book:     POST /v2/bookings  cal-api-version: 2026-02-25
 * List:     GET  /v2/bookings  cal-api-version: 2026-05-01
 * Docs: https://cal.com/docs/api-reference/v2
 */
import { env, need } from "../env";
import { q } from "../db";
import { fetchJson } from "./http";
import { STUDIO_TIMEZONE } from "../knowledge";

export interface Slot { start: string; end?: string; }

function headers(version: string) {
  return {
    Authorization: `Bearer ${need(env.calApiKey, "CALCOM_API_KEY")}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

export async function getAvailableSlots(fromIso: string, toIso: string): Promise<Slot[]> {
  if (env.mockFails("calcom")) throw new Error("MOCK_FAIL: calcom");
  if (env.mock) return mockSlots(fromIso, toIso);
  const u = new URL("/v2/slots", env.calBaseUrl);
  u.searchParams.set("eventTypeId", String(need(env.calEventTypeId, "CALCOM_EVENT_TYPE_ID")));
  u.searchParams.set("start", fromIso);
  u.searchParams.set("end", toIso);
  u.searchParams.set("timeZone", STUDIO_TIMEZONE);
  u.searchParams.set("format", "range");
  const res = await fetchJson<{ status: string; data: Record<string, Slot[]> }>(u.toString(), { headers: headers("2024-09-04") });
  return Object.values(res.data ?? {}).flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export interface CreatedBooking { id: number | null; uid: string; status: string; start: string; }

export async function createBooking(args: {
  startUtcIso: string; name: string; email: string; phone?: string; leadRef: string; notes?: string;
}): Promise<CreatedBooking> {
  if (env.mockFails("calcom")) throw new Error("MOCK_FAIL: calcom");
  if (env.mock) {
    const uid = `mock-${args.leadRef}-${Date.parse(args.startUtcIso)}`;
    await q(`INSERT INTO mock_outbox (channel, payload) VALUES ('calcom', $1)`, [JSON.stringify({ action: "create_booking", ...args, uid })]);
    return { id: null, uid, status: "accepted", start: args.startUtcIso };
  }
  const body: Record<string, unknown> = {
    start: args.startUtcIso,
    eventTypeId: need(env.calEventTypeId, "CALCOM_EVENT_TYPE_ID"),
    attendee: {
      name: args.name, email: args.email, timeZone: STUDIO_TIMEZONE, language: "en",
      ...(args.phone && /^\+\d{8,15}$/.test(args.phone) ? { phoneNumber: args.phone } : {}),
    },
    metadata: { aangan_lead_ref: args.leadRef },
  };
  const res = await fetchJson<{ status: string; data: any }>(new URL("/v2/bookings", env.calBaseUrl).toString(), {
    method: "POST", headers: headers("2026-02-25"), body: JSON.stringify(body), timeoutMs: 10000,
  });
  const d = Array.isArray(res.data) ? res.data[0] : res.data;
  return { id: d?.id ?? null, uid: d?.uid, status: d?.status, start: d?.start ?? args.startUtcIso };
}

/** Find a booking we may already have created for this lead (Cal.com has no idempotency key). */
export async function findExistingBooking(email: string, leadRef: string, startUtcIso: string): Promise<CreatedBooking | null> {
  if (env.mock) {
    const rows = await q(`SELECT payload FROM mock_outbox WHERE channel='calcom' AND payload->>'leadRef'=$1 ORDER BY id DESC LIMIT 1`, [leadRef]);
    const p = rows[0]?.payload;
    return p ? { id: null, uid: p.uid, status: "accepted", start: p.startUtcIso } : null;
  }
  const u = new URL("/v2/bookings", env.calBaseUrl);
  u.searchParams.set("attendeeEmail", email);
  u.searchParams.set("eventTypeId", String(need(env.calEventTypeId, "CALCOM_EVENT_TYPE_ID")));
  u.searchParams.set("afterStart", new Date(Date.parse(startUtcIso) - 60_000).toISOString());
  u.searchParams.set("limit", "20");
  const res = await fetchJson<{ data: any[] }>(u.toString(), { headers: headers("2026-05-01") });
  const hit = (res.data ?? []).find(
    (b) => b?.metadata?.aangan_lead_ref === leadRef && b.status !== "cancelled" && b.status !== "rejected",
  );
  return hit ? { id: hit.id ?? null, uid: hit.uid, status: hit.status, start: hit.start } : null;
}

// ---- mock: weekday 11:00 & 15:00, Saturday 10:30 IST, minus slots already booked in our DB ----
async function mockSlots(fromIso: string, toIso: string): Promise<Slot[]> {
  const booked = new Set(
    (await q(`SELECT slot_start FROM bookings WHERE status <> 'failed'`)).map((r) => new Date(r.slot_start).toISOString()),
  );
  const out: Slot[] = [];
  const end = Date.parse(toIso);
  for (let t = Date.parse(fromIso); t < end; t += 86400000) {
    const ist = new Date(t + 5.5 * 3600000);
    const day = ist.getUTCDay();
    if (day === 0) continue;
    const times = day === 6 ? [[10, 30]] : [[11, 0], [15, 0]];
    for (const [h, m] of times) {
      const ymd = ist.toISOString().slice(0, 10);
      const start = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
      if (start.getTime() < Date.parse(fromIso) || booked.has(start.toISOString())) continue;
      out.push({ start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() });
    }
  }
  return out;
}
