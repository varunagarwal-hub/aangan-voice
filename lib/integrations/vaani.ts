/**
 * Vaani Voice AI — https://docs.vaanivoice.ai
 * Auth header: X-API-Key: vaani_...
 * - GET /api/call_details/{call_id}  -> transcription, summary, entity, ...
 * - GET /api/transcript/{call_id}    -> { transcript } (404 until ready)
 * - GET /api/call-history?page=&page_size=  -> from_number, Start_time, End_time, duration_ms, call_cost (credits)
 * Webhook "call_postprocessing" -> { event, call_id, timestamp, data: { call_duration (ms), transcript, summary, recording_url, end_reason } }
 */
import { env, need } from "../env";
import { q1 } from "../db";
import { fetchJson, HttpError } from "./http";

const NOT_READY = "Transcript is not available";

function headers() {
  return { "X-API-Key": need(env.vaaniApiKey, "VAANI_API_KEY") };
}

export interface VaaniCallDetails { transcript: string | null; summary: string | null; raw: any; }

export async function getCallDetails(callId: string): Promise<VaaniCallDetails> {
  if (env.mockFails("vaani")) throw new Error("MOCK_FAIL: vaani");
  if (env.mock) {
    const row = await q1(`SELECT data FROM mock_vaani_calls WHERE call_id=$1`, [callId]);
    return { transcript: row?.data?.transcript ?? null, summary: null, raw: row?.data ?? null };
  }
  const base = env.vaaniBaseUrl;
  try {
    const d = await fetchJson<any>(`${base}/api/call_details/${encodeURIComponent(callId)}`, { headers: headers() });
    const t = typeof d.transcription === "string" && !d.transcription.includes(NOT_READY) ? d.transcription : null;
    const s = typeof d.summary === "string" && !d.summary.includes(NOT_READY) ? d.summary : null;
    if (t) return { transcript: t, summary: s, raw: d };
  } catch (err) {
    if (!(err instanceof HttpError) || err.status >= 500) throw err;
  }
  // Fallback: dedicated transcript endpoint.
  try {
    const t = await fetchJson<any>(`${base}/api/transcript/${encodeURIComponent(callId)}`, { headers: headers() });
    // This endpoint can answer HTTP 200 with {"transcript":"Error retrieving transcript","status_code":500,...}.
    const ok = typeof t.transcript === "string" && (t.status_code === undefined || t.status_code === 200) && !t.error;
    return { transcript: ok ? t.transcript : null, summary: null, raw: t };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { transcript: null, summary: null, raw: null };
    throw err;
  }
}

export interface VaaniCallHistoryItem {
  call_id: string; from_number?: string; to_number?: string; direction?: string;
  Start_time?: string; End_time?: string; duration_ms?: number; call_cost?: number; call_status?: string;
  [k: string]: any;
}

/** Call-history is the only documented source of caller number, cost and start/end time. */
export async function findInCallHistory(callId: string, maxPages = 5): Promise<VaaniCallHistoryItem | null> {
  if (env.mockFails("vaani_history")) throw new Error("MOCK_FAIL: vaani_history");
  if (env.mock) {
    const row = await q1(`SELECT data FROM mock_vaani_calls WHERE call_id=$1`, [callId]);
    return row?.data?.history ?? null;
  }
  for (let page = 1; page <= maxPages; page++) {
    const res = await listCallHistory(page, 100);
    const hit = res.data.find((c) => c.call_id === callId);
    if (hit) return hit;
    if (!res.pagination?.has_next) break;
  }
  return null;
}

export async function listCallHistory(page = 1, pageSize = 100) {
  if (env.mock) return { data: [] as VaaniCallHistoryItem[], pagination: { has_next: false } };
  return fetchJson<{ data: VaaniCallHistoryItem[]; pagination: { has_next: boolean } }>(
    `${env.vaaniBaseUrl}/api/call-history?page=${page}&page_size=${pageSize}`, { headers: headers() },
  );
}
