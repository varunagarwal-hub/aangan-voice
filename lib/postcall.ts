/**
 * After a call ends: fetch transcript/metadata from Vaani, link to the lead, have Gemini write
 * the summary + brief, compute cost, notify Telegram, sync HubSpot.
 * Each step is recorded in sync_log; a retry skips steps that are already done, so nothing is duplicated.
 */
import { q, q1 } from "./db";
import { env } from "./env";
import { OFFICE_HOURS, STUDIO_TIMEZONE } from "./knowledge";
import { formatEstimate } from "./rules";
import { findInCallHistory, getCallDetails } from "./integrations/vaani";
import { writeBrief, type GeminiUsage } from "./integrations/gemini";
import { esc, sendTelegram } from "./integrations/telegram";
import { syncToHubspot } from "./integrations/hubspot";
import { newRef, normPhone, slotLabel } from "./tools";

type Row = Record<string, any>;

// ---------- webhook intake ----------

/** Store the Vaani webhook. Returns the call id to process, or null if the event is not one we use. */
export async function recordWebhook(payload: any): Promise<string | null> {
  if (payload?.event !== "call_postprocessing") return null;
  const d = payload.data ?? {};
  const callId: string | undefined = payload.call_id ?? d.call_id;
  if (!callId) throw new Error("call_postprocessing without call_id");
  const durationSec = typeof d.call_duration === "number" ? d.call_duration / 1000 : null; // ms per docs
  await q(
    `INSERT INTO calls (vaani_call_id, transcript, vaani_summary, recording_url, duration_sec, end_reason, raw_webhook)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (vaani_call_id) DO UPDATE SET
       transcript=COALESCE(calls.transcript, EXCLUDED.transcript), vaani_summary=COALESCE(EXCLUDED.vaani_summary, calls.vaani_summary),
       recording_url=COALESCE(EXCLUDED.recording_url, calls.recording_url), duration_sec=COALESCE(calls.duration_sec, EXCLUDED.duration_sec),
       end_reason=COALESCE(EXCLUDED.end_reason, calls.end_reason), raw_webhook=EXCLUDED.raw_webhook, updated_at=now()`,
    [callId, d.transcript ?? null, typeof d.summary === "string" ? d.summary : null, d.recording_url ?? null, durationSec, d.end_reason ?? null, JSON.stringify(payload)],
  );
  return callId;
}

/** Register a call we discovered via call-history (no webhook received). */
export async function registerCall(callId: string) {
  await q(`INSERT INTO calls (vaani_call_id) VALUES ($1) ON CONFLICT (vaani_call_id) DO NOTHING`, [callId]);
}

// ---------- step runner ----------

async function step<T>(callId: string, name: string, fn: () => Promise<T>): Promise<{ ok: boolean; result?: T }> {
  const done = await q1(`SELECT status, result FROM sync_log WHERE vaani_call_id=$1 AND step=$2`, [callId, name]);
  if (done && (done.status === "done" || done.status === "skipped")) return { ok: true, result: done.result as T };
  try {
    const result = await fn();
    const status = (result as any)?.skipped ? "skipped" : "done";
    await q(
      `INSERT INTO sync_log (vaani_call_id, step, status, result) VALUES ($1,$2,$3,$4)
       ON CONFLICT (vaani_call_id, step) DO UPDATE SET status=EXCLUDED.status, result=EXCLUDED.result, error=NULL, updated_at=now()`,
      [callId, name, status, JSON.stringify(result ?? null)],
    );
    return { ok: true, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[postcall:${name}] ${callId}`, err);
    await q(
      `INSERT INTO sync_log (vaani_call_id, step, status, error) VALUES ($1,$2,'error',$3)
       ON CONFLICT (vaani_call_id, step) DO UPDATE SET status='error', error=EXCLUDED.error, updated_at=now()`,
      [callId, name, msg.slice(0, 1000)],
    );
    return { ok: false };
  }
}

// ---------- helpers ----------

export function isAfterHours(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: STUDIO_TIMEZONE, weekday: "short", hour: "numeric", hour12: false }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return !OFFICE_HOURS.days.includes(day) || hour < OFFICE_HOURS.startHour || hour >= OFFICE_HOURS.endHour;
}

function parseVaaniTime(s?: string): Date | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"); // docs don't state a zone; assume UTC if none
  return Number.isNaN(t) ? null : new Date(t);
}

export function computeCost(c: { duration_sec?: number | null; vaani_credits?: number | null; usage?: GeminiUsage | null }) {
  const minutes = c.duration_sec != null ? Number(c.duration_sec) / 60 : null;
  const missing: string[] = [];
  let vaani: number | null = null;
  if (c.vaani_credits != null && env.vaaniInrPerCredit != null) vaani = Number(c.vaani_credits) * env.vaaniInrPerCredit;
  else if (minutes != null && env.vaaniInrPerMin != null) vaani = minutes * env.vaaniInrPerMin;
  else missing.push("Vaani rate (VAANI_INR_PER_CREDIT or VAANI_INR_PER_MIN)");
  let telephony: number | null = null;
  if (env.vaaniCostIncludesTelephony) telephony = 0;
  else if (minutes != null && env.telephonyInrPerMin != null) telephony = minutes * env.telephonyInrPerMin;
  else missing.push("TELEPHONY_INR_PER_MIN");
  let gemini: number | null = null;
  if (c.usage && env.geminiUsdPer1mInput != null && env.geminiUsdPer1mOutput != null && env.usdToInr != null) {
    const usd = (c.usage.promptTokenCount * env.geminiUsdPer1mInput + (c.usage.candidatesTokenCount + c.usage.thoughtsTokenCount) * env.geminiUsdPer1mOutput) / 1e6;
    gemini = usd * env.usdToInr;
  } else if (c.usage) missing.push("Gemini price / USD_TO_INR");
  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  const parts = [vaani, telephony, gemini].filter((x): x is number => x != null);
  const total = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  return { vaani: r2(vaani), telephony: r2(telephony), gemini: r2(gemini), total: r2(total), complete: missing.length === 0, missing };
}

/** Link a finished call to the lead created by the in-call tools. */
async function linkLead(call: Row): Promise<{ leadId: string; method: string }> {
  if (call.lead_id) return { leadId: call.lead_id, method: call.link_method ?? "existing" };
  let lead = await q1(`SELECT id FROM leads WHERE vaani_call_id=$1`, [call.vaani_call_id]);
  let method = "call_id";
  const start = call.started_at ? new Date(call.started_at) : null;
  const end = call.ended_at ? new Date(call.ended_at) : start && call.duration_sec ? new Date(start.getTime() + call.duration_sec * 1000) : null;
  const winFrom = start ? new Date(start.getTime() - 5 * 60000) : null;
  const winTo = end ? new Date(end.getTime() + 5 * 60000) : null;
  if (!lead && call.from_number && winFrom && winTo) {
    lead = await q1(`SELECT id FROM leads WHERE caller_phone=$1 AND vaani_call_id IS NULL AND created_at BETWEEN $2 AND $3 ORDER BY created_at DESC LIMIT 1`,
      [call.from_number, winFrom, winTo]);
    method = "phone_and_time";
  }
  if (!lead && winFrom && winTo) {
    const cands = await q(`SELECT id FROM leads WHERE vaani_call_id IS NULL AND created_at BETWEEN $1 AND $2`, [winFrom, winTo]);
    if (cands.length === 1) { lead = cands[0]; method = "time_window_unique"; }
  }
  if (!lead) {
    // Caller hung up before check_lead, or we couldn't match. Still log the call as a lead.
    lead = await q1(
      `INSERT INTO leads (ref, vaani_call_id, caller_phone, outcome, status, needs_callback, human_review)
       VALUES ($1,$2,$3,'incomplete','needs_callback',true,$4)
       ON CONFLICT (vaani_call_id) DO UPDATE SET updated_at=now() RETURNING id`,
      [newRef(), call.vaani_call_id, call.from_number ?? null,
       JSON.stringify(["Call ended before qualification, or could not be matched to in-call data. Check transcript."])],
    );
    method = "created_incomplete";
  } else {
    await q(`UPDATE leads SET vaani_call_id=COALESCE(vaani_call_id,$2), caller_phone=COALESCE(caller_phone,$3), updated_at=now() WHERE id=$1`,
      [lead.id, call.vaani_call_id, call.from_number ?? null]);
  }
  await q(`UPDATE calls SET lead_id=$2, link_method=$3, updated_at=now() WHERE id=$1`, [call.id, lead!.id, method]);
  return { leadId: lead!.id, method };
}

// ---------- the pipeline ----------

export async function processCall(callId: string): Promise<{ status: string; errors: string[] }> {
  // Atomic claim so two webhook retries / cron runs never process the same call at once.
  const claimed = await q1(
    `UPDATE calls SET processing_status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
     WHERE vaani_call_id=$1 AND (processing_status IN ('pending','error') OR (processing_status='processing' AND locked_at < now() - interval '5 minutes'))
     RETURNING *`, [callId],
  );
  if (!claimed) return { status: "skipped_locked_or_done", errors: [] };
  const errors: string[] = [];
  const fail = (s: string) => errors.push(s);

  // 1. Fetch transcript + call metadata from Vaani.
  const fetched = await step(callId, "vaani_fetch", async () => {
    const [details, hist] = await Promise.all([getCallDetails(callId), findInCallHistory(callId)]);
    const start = parseVaaniTime(hist?.Start_time);
    const end = parseVaaniTime(hist?.End_time);
    let duration = claimed.duration_sec != null ? Number(claimed.duration_sec) : null;
    if (duration == null && start && end) duration = (end.getTime() - start.getTime()) / 1000;
    if (duration == null && typeof hist?.duration_ms === "number") duration = hist.duration_ms / 1000;
    const startedAt = start ?? (claimed.raw_webhook?.timestamp ? new Date(new Date(claimed.raw_webhook.timestamp).getTime() - (duration ?? 0) * 1000) : null);
    const transcript = details.transcript ?? claimed.transcript;
    if (!transcript) throw new Error("Transcript not available yet");
    await q(
      `UPDATE calls SET transcript=$2, vaani_summary=COALESCE(vaani_summary,$3), from_number=$4, started_at=$5, ended_at=$6,
         duration_sec=$7, vaani_credits=$8, after_hours=$9, raw_history=$10, updated_at=now() WHERE vaani_call_id=$1`,
      [callId, transcript, details.summary, normPhone(hist?.direction === "outbound" ? hist?.to_number : hist?.from_number) ?? null,
       startedAt, end, duration, hist?.call_cost ?? null, startedAt ? isAfterHours(startedAt) : null, hist ? JSON.stringify(hist) : null],
    );
    return { has_history: !!hist };
  });
  if (!fetched.ok) fail("vaani_fetch");

  let call = (await q1(`SELECT * FROM calls WHERE vaani_call_id=$1`, [callId]))!;

  // 2. Link to lead.
  const linked = await step(callId, "link_lead", () => linkLead(call));
  if (!linked.ok) { fail("link_lead"); return finish(callId, errors); }
  call = (await q1(`SELECT * FROM calls WHERE vaani_call_id=$1`, [callId]))!;
  let lead = (await q1(`SELECT * FROM leads WHERE id=$1`, [call.lead_id]))!;
  const booking = await q1(`SELECT * FROM bookings WHERE lead_id=$1 AND status='confirmed'`, [lead.id]);
  const bookingLabel = booking ? slotLabel(new Date(booking.slot_start).toISOString()) : null;

  // 3. Gemini: summary + brief (language only).
  const gem = await step(callId, "gemini", async () => {
    if (!call.transcript) throw new Error("no transcript");
    const { output, usage } = await writeBrief({
      transcript: call.transcript, lead: lead.raw_input ?? {}, outcome: lead.outcome ?? "incomplete",
      notes: [...(lead.handoff_notes ?? []), ...(lead.human_review ?? [])], booking: bookingLabel,
    });
    await q(`UPDATE leads SET summary=$2, designer_brief=$3, priority_score=$4, priority_reason=$5, ai_flags=$6, updated_at=now() WHERE id=$1`,
      [lead.id, output.summary, output.designer_brief, output.priority_score, output.priority_reason, JSON.stringify(output.human_review_flags)]);
    await q(`UPDATE calls SET gemini_tokens=$2 WHERE vaani_call_id=$1`, [callId, JSON.stringify(usage)]);
    return { usage };
  });
  if (!gem.ok) fail("gemini");

  // 4. Cost.
  call = (await q1(`SELECT * FROM calls WHERE vaani_call_id=$1`, [callId]))!;
  const cost = computeCost({ duration_sec: call.duration_sec, vaani_credits: call.vaani_credits, usage: call.gemini_tokens });
  await q(`UPDATE calls SET cost_vaani_inr=$2, cost_telephony_inr=$3, cost_gemini_inr=$4, cost_total_inr=$5, cost_complete=$6, updated_at=now() WHERE vaani_call_id=$1`,
    [callId, cost.vaani, cost.telephony, cost.gemini, cost.total, cost.complete]);
  lead = (await q1(`SELECT * FROM leads WHERE id=$1`, [lead.id]))!;

  // 5. Telegram — qualified leads, plus anything a human must act on (escalation / callback).
  const tg = await step(callId, "telegram", async () => {
    const notify = lead.outcome === "qualified" || lead.outcome === "escalation" || lead.needs_callback;
    if (!notify) return { skipped: true, reason: `outcome ${lead.outcome}` };
    return sendTelegram(telegramMessage(lead, call, bookingLabel, !gem.ok));
  });
  if (!tg.ok) fail("telegram");

  // 6. HubSpot — every call.
  const hs = await step(callId, "hubspot", async () => {
    const input = lead.raw_input ?? {};
    const stage = booking ? "booked" : lead.outcome === "qualified" ? "qualified" : lead.outcome === "not_qualified" ? "not_qualified" : "other";
    const key = lead.caller_phone ?? lead.email ?? `call:${callId}`;
    return syncToHubspot({
      callId,
      contact: { key, name: lead.name, phone: lead.caller_phone, email: lead.email, city: input.location },
      deal: {
        name: `Aangan — ${lead.name ?? lead.caller_phone ?? "Caller"} — ${input.property_type ?? input.project_category ?? "enquiry"}${input.location ? `, ${input.location}` : ""} (${lead.ref})`,
        stage,
        properties: {
          aangan_lead_ref: lead.ref, aangan_outcome: lead.outcome, aangan_priority: lead.priority_score,
          aangan_after_hours: call.after_hours, aangan_consultation_at: bookingLabel,
          aangan_call_cost_inr: call.cost_total_inr, aangan_cost_vaani_inr: call.cost_vaani_inr,
          aangan_cost_telephony_inr: call.cost_telephony_inr, aangan_cost_gemini_inr: call.cost_gemini_inr,
          aangan_internal_estimate: formatEstimate(lead.internal_estimate), aangan_summary: lead.summary,
          aangan_designer_brief: lead.designer_brief, aangan_dashboard_url: `${env.appUrl}/leads/${lead.id}`,
        },
      },
    });
  });
  if (!hs.ok) fail("hubspot");

  return finish(callId, errors);
}

async function finish(callId: string, errors: string[]) {
  const status = errors.length ? "error" : "done";
  await q(`UPDATE calls SET processing_status=$2, last_error=$3, locked_at=NULL, updated_at=now() WHERE vaani_call_id=$1`,
    [callId, status, errors.length ? `failed steps: ${errors.join(", ")}` : null]);
  return { status, errors };
}

export function telegramMessage(lead: Row, call: Row, bookingLabel: string | null, briefMissing: boolean) {
  const i = lead.raw_input ?? {};
  const head =
    lead.outcome === "escalation" ? "🔴 <b>URGENT — existing client</b>"
    : lead.outcome === "qualified" ? "🟢 <b>New qualified lead</b>"
    : "🟠 <b>Callback needed</b>";
  const lines = [
    `${head} · ${esc(lead.ref)}${call.after_hours ? " · 🌙 after hours" : ""}`,
    `<b>Name:</b> ${esc(lead.name ?? "-")}   <b>Phone:</b> ${esc(lead.caller_phone ?? call.from_number ?? "-")}`,
    lead.email ? `<b>Email:</b> ${esc(lead.email)}` : "",
    `<b>Property:</b> ${esc([i.project_category, i.property_type, i.scope].filter((x: string) => x && x !== "unknown").join(" / ") || "-")}${i.carpet_area_sqft ? ` · ${esc(i.carpet_area_sqft)} sq ft` : ""}`,
    `<b>Location:</b> ${esc(i.location ?? "-")}   <b>Timeline:</b> ${esc(i.timeline_text ?? (i.no_fixed_deadline ? "no fixed deadline" : "-"))}`,
    `<b>Consultation:</b> ${bookingLabel ? esc(bookingLabel) : "❗ not booked — please call to schedule"}`,
    lead.priority_score ? `<b>Priority:</b> ${lead.priority_score}/5 — ${esc(lead.priority_reason ?? "")}` : "",
    "",
    lead.summary ? `<b>Summary</b>\n${esc(lead.summary)}` : "",
    briefMissing ? "<i>AI brief unavailable — see transcript in the dashboard.</i>" : lead.designer_brief ? `<b>Designer brief</b>\n<pre>${esc(lead.designer_brief)}</pre>` : "",
    `<b>Internal estimate — never quote to client</b>\n${esc(formatEstimate(lead.internal_estimate))}`,
    (lead.handoff_notes ?? []).length ? `<b>Notes</b>\n• ${(lead.handoff_notes as string[]).map(esc).join("\n• ")}` : "",
    [...(lead.human_review ?? []), ...(lead.ai_flags ?? [])].length
      ? `<b>⚑ Review</b>\n• ${[...(lead.human_review ?? []), ...(lead.ai_flags ?? [])].map(esc).join("\n• ")}` : "",
    `<a href="${esc(env.appUrl)}/leads/${lead.id}">Open in dashboard</a>`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}
