/**
 * The three in-call tools Vaani calls: check_lead, get_slots, book_slot.
 * Every handler returns a small JSON object whose `say` field is the exact sentence for Vaani.
 * Any failure returns the fallback sentence ("a designer will call you back") and the lead is kept.
 */
import { randomBytes } from "node:crypto";
import { q, q1 } from "./db";
import { env } from "./env";
import { LeadInput, evaluateLead, FALLBACK_SAY, formatEstimate, type CriterionKey } from "./rules";
import { createBooking, findExistingBooking, getAvailableSlots, type Slot } from "./integrations/calcom";
import { HttpError } from "./integrations/http";
import { alertSafe, esc } from "./integrations/telegram";
import { STUDIO_TIMEZONE } from "./knowledge";

export interface ToolResponse {
  result: string;
  say: string;
  lead_ref?: string;
  next_step: string;
  options?: { option: number; start: string; label: string }[];
}

type Lead = Record<string, any>;

// ---------- helpers ----------

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRef() {
  const b = randomBytes(6);
  return "AG-" + Array.from(b, (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join("");
}

/** LLMs send "", "null", "N/A" for missing values — treat them as absent. */
export function cleanParams(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t || ["null", "none", "n/a", "na", "undefined"].includes(t.toLowerCase())) continue;
      if (t === "true" || t === "false") { out[k] = t === "true"; continue; }
      if (BOOLEAN_FIELDS.has(k) && /^(yes|y|true|1)$/i.test(t)) { out[k] = true; continue; }
      if (BOOLEAN_FIELDS.has(k) && /^(no|n|false|0)$/i.test(t)) { out[k] = false; continue; }
      // Vaani's tool form has no enum dropdowns: accept "Residential", "full home", "Full-Home" etc.
      out[k] = ENUM_FIELDS.has(k) ? t.toLowerCase().replace(/[\s-]+/g, "_") : t;
    } else out[k] = v;
  }
  return out;
}

const ENUM_FIELDS = new Set([
  "enquiry_type", "project_category", "scope", "location_confirmed_pune_pcmc", "service_wanted",
  "structural_changes_required", "is_rented", "decision_maker",
]);
const BOOLEAN_FIELDS = new Set(["budget_volunteered", "no_fixed_deadline", "asked_about_price", "confirmed"]);

export function normPhone(p?: unknown): string | undefined {
  if (typeof p !== "string") return undefined;
  const digits = p.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 8) return undefined;
  if (digits.startsWith("+")) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return "+91" + d;
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  if (d.length === 11 && d.startsWith("0")) return "+91" + d.slice(1);
  return "+" + d;
}

/** Parse with zod; drop any field that fails validation instead of failing the whole call. */
function parseLenient(raw: Record<string, unknown>) {
  let obj = { ...raw };
  for (let i = 0; i < 10; i++) {
    const r = LeadInput.safeParse(obj);
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      const key = issue.path[0];
      if (key === "call_id") obj.call_id = obj.call_id ? String(obj.call_id) : "unknown";
      else if (typeof key === "string") delete obj[key];
    }
  }
  return LeadInput.parse({ call_id: String(raw.call_id ?? "unknown") });
}

/**
 * Find the lead this request belongs to. Vaani's docs don't say whether a tool request can carry
 * the call ID, so we match in order: lead_ref -> call_id -> caller phone (recent) -> name+location (recent).
 */
export async function resolveLead(p: Record<string, unknown>): Promise<Lead | undefined> {
  if (typeof p.lead_ref === "string") {
    const l = await q1(`SELECT * FROM leads WHERE upper(ref)=upper($1)`, [p.lead_ref]);
    if (l) return l;
  }
  if (typeof p.call_id === "string") {
    const l = await q1(`SELECT * FROM leads WHERE vaani_call_id=$1`, [p.call_id]);
    if (l) return l;
  }
  const phone = normPhone(p.caller_phone);
  if (phone) {
    const l = await q1(
      `SELECT * FROM leads WHERE caller_phone=$1 AND updated_at > now() - interval '45 minutes'
         AND (vaani_call_id IS NULL OR vaani_call_id=$2) ORDER BY updated_at DESC LIMIT 1`,
      [phone, typeof p.call_id === "string" ? p.call_id : ""],
    );
    if (l) return l;
  }
  if (typeof p.name === "string" && typeof p.location === "string") {
    const l = await q1(
      `SELECT * FROM leads WHERE lower(name)=lower($1) AND lower(raw_input->>'location')=lower($2)
         AND vaani_call_id IS NULL AND updated_at > now() - interval '20 minutes' ORDER BY updated_at DESC LIMIT 1`,
      [p.name, p.location],
    );
    if (l) return l;
  }
  return undefined;
}

async function logEvent(leadId: string | null, tool: string, request: unknown, response: unknown, error?: string) {
  try {
    await q(`INSERT INTO tool_events (lead_id, tool, request, response, error) VALUES ($1,$2,$3,$4,$5)`,
      [leadId, tool, JSON.stringify(request ?? null), JSON.stringify(response ?? null), error ?? null]);
  } catch (err) { console.error("[tool_events] insert failed", err); }
}

/** Something failed mid-call: keep the lead, mark it for callback, alert the team, give Vaani the fallback line. */
async function failSafe(tool: string, body: Record<string, unknown>, err: unknown, lead?: Lead): Promise<ToolResponse> {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${tool}] failed`, err);
  let ref = lead?.ref as string | undefined;
  try {
    if (lead) {
      await q(`UPDATE leads SET needs_callback=true, status='needs_callback',
                 human_review = human_review || $2::jsonb, updated_at=now() WHERE id=$1`,
        [lead.id, JSON.stringify([`${tool} failed mid-call: ${msg.slice(0, 200)}`])]);
    } else {
      ref = newRef();
      const p = cleanParams(body);
      await q(`INSERT INTO leads (ref, vaani_call_id, caller_phone, name, raw_input, outcome, status, needs_callback, human_review)
               VALUES ($1,$2,$3,$4,$5,'incomplete','needs_callback',true,$6) ON CONFLICT (vaani_call_id) DO NOTHING`,
        [ref, typeof p.call_id === "string" ? p.call_id : null, normPhone(p.caller_phone) ?? null, (p.name as string) ?? null,
         JSON.stringify(p), JSON.stringify([`${tool} failed mid-call: ${msg.slice(0, 200)}`])]);
    }
  } catch (dbErr) {
    console.error(`[${tool}] could not save fallback lead`, dbErr);
  }
  await alertSafe(
    `⚠️ <b>${esc(tool)} failed during a live call</b> — please call the customer back.\n` +
    `Ref: ${esc(ref ?? "-")}\nDetails received: <code>${esc(JSON.stringify(cleanParams(body)).slice(0, 1500))}</code>\nError: ${esc(msg.slice(0, 300))}`,
  );
  const res: ToolResponse = { result: "error", say: FALLBACK_SAY, lead_ref: ref, next_step: "close_call_politely" };
  await logEvent(lead?.id ?? null, tool, body, res, msg);
  return res;
}

const NEXT_STEP: Record<string, string> = {
  qualified: "offer_consultation_then_call_get_slots",
  needs_clarification: "ask_this_question_then_call_check_lead_again_with_the_answer",
  not_qualified: "close_call_politely",
  escalation: "close_call_politely",
};

// ---------- check_lead ----------

export async function checkLead(body: Record<string, unknown>): Promise<ToolResponse> {
  let lead: Lead | undefined;
  try {
    const p = cleanParams(body);
    if (p.caller_phone) p.caller_phone = normPhone(p.caller_phone) ?? p.caller_phone;
    lead = await resolveLead(p);
    const prevOutcome = lead?.outcome as string | undefined;
    const merged = { ...(lead?.raw_input ?? {}), ...p };
    delete (merged as any).lead_ref;
    if (!merged.call_id) merged.call_id = lead?.vaani_call_id ?? "unknown";
    const input = parseLenient(merged);
    const result = evaluateLead(input, { alreadyAsked: (lead?.clarify_asked ?? []) as CriterionKey[] });

    const clarifyAsked = [...(lead?.clarify_asked ?? [])];
    if (result.clarify_criterion && !clarifyAsked.includes(result.clarify_criterion)) clarifyAsked.push(result.clarify_criterion);
    const callId = input.call_id !== "unknown" ? input.call_id : null;
    const vals = [
      callId, input.caller_phone ?? null, input.name ?? null, input.email ?? null, JSON.stringify(merged), result.outcome,
      JSON.stringify(result.criteria), JSON.stringify(result.handoff_notes), JSON.stringify(result.human_review),
      result.internal_estimate ? JSON.stringify(result.internal_estimate) : null, clarifyAsked,
    ];
    if (lead) {
      lead = await q1(
        `UPDATE leads SET vaani_call_id=COALESCE(vaani_call_id,$1), caller_phone=COALESCE($2,caller_phone), name=COALESCE($3,name),
           email=COALESCE($4,email), raw_input=$5, outcome=$6, criteria=$7, handoff_notes=$8, human_review=$9,
           internal_estimate=$10, clarify_asked=$11, updated_at=now() WHERE id=$12 RETURNING *`,
        [...vals, lead.id],
      );
    } else {
      lead = await q1(
        `INSERT INTO leads (vaani_call_id, caller_phone, name, email, raw_input, outcome, criteria, handoff_notes, human_review,
           internal_estimate, clarify_asked, ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (vaani_call_id) DO UPDATE SET raw_input=EXCLUDED.raw_input, outcome=EXCLUDED.outcome, criteria=EXCLUDED.criteria,
           handoff_notes=EXCLUDED.handoff_notes, human_review=EXCLUDED.human_review, internal_estimate=EXCLUDED.internal_estimate,
           clarify_asked=EXCLUDED.clarify_asked, updated_at=now()
         RETURNING *`,
        [...vals, newRef()],
      );
    }
    if (!lead) throw new Error("lead upsert returned no row");

    if (result.outcome === "escalation" && prevOutcome !== "escalation") {
      await alertSafe(
        `🔴 <b>URGENT — existing client on the phone</b> (${esc(lead.ref)})\nName: ${esc(input.name ?? "-")}\nPhone: ${esc(input.caller_phone ?? "see call log")}\n` +
        `Location: ${esc(input.location ?? "-")}\nIssue: ${esc(input.requirements ?? "-")}\nPlease have someone senior call back.`,
      );
    }
    const res: ToolResponse = { result: result.outcome, say: result.say, lead_ref: lead.ref, next_step: NEXT_STEP[result.outcome] };
    await logEvent(lead.id, "check_lead", body, { ...res, internal_estimate: formatEstimate(result.internal_estimate) });
    return res;
  } catch (err) {
    return failSafe("check_lead", body, err, lead);
  }
}

// ---------- get_slots ----------

const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: STUDIO_TIMEZONE, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true,
});
export const slotLabel = (iso: string) => fmt.format(new Date(iso)).replace(/ am| pm/i, (m) => m.toUpperCase());

/** Prefer one slot per day so the caller gets real choice. */
export function pickThree(slots: Slot[]): Slot[] {
  const byDay = new Map<string, Slot>();
  for (const s of slots) {
    const day = new Date(s.start).toLocaleDateString("en-CA", { timeZone: STUDIO_TIMEZONE });
    if (!byDay.has(day)) byDay.set(day, s);
  }
  const picked = [...byDay.values()].slice(0, 3);
  for (const s of slots) if (picked.length < 3 && !picked.includes(s)) picked.push(s);
  return picked.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function offerSlots(lead: Lead, fromIso?: string): Promise<ToolResponse["options"]> {
  const from = fromIso && Date.parse(fromIso) > Date.now() ? new Date(fromIso) : new Date(Date.now() + 60 * 60 * 1000);
  const to = new Date(from.getTime() + env.slotSearchDays * 86400000);
  const slots = pickThree(await getAvailableSlots(from.toISOString(), to.toISOString()));
  const options = slots.map((s, i) => ({ option: i + 1, start: new Date(s.start).toISOString(), label: slotLabel(s.start) }));
  await q(`UPDATE leads SET offered_slots=$2, updated_at=now() WHERE id=$1`, [lead.id, JSON.stringify(options)]);
  return options;
}

function slotsSay(options: NonNullable<ToolResponse["options"]>, prefix = "") {
  const list = options.map((o) => `option ${o.option}, ${o.label}`).join("; ");
  return `${prefix}I have these consultation times available: ${list}. Which one works best for you?`;
}

export async function getSlots(body: Record<string, unknown>): Promise<ToolResponse> {
  let lead: Lead | undefined;
  try {
    const p = cleanParams(body);
    lead = await resolveLead(p);
    if (!lead) throw new Error("get_slots called before check_lead (no lead found)");
    if (lead.outcome !== "qualified") {
      const res = { result: "not_available", say: "Before booking, I just need a few more details about your project.", lead_ref: lead.ref, next_step: "call_check_lead_first" };
      await logEvent(lead.id, "get_slots", body, res);
      return res;
    }
    const preferred = typeof p.preferred_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.preferred_date)
      ? new Date(`${p.preferred_date}T00:00:00+05:30`).toISOString() : undefined;
    const options = await offerSlots(lead, preferred);
    let res: ToolResponse;
    if (!options?.length) {
      await q(`UPDATE leads SET needs_callback=true, status='needs_callback', updated_at=now() WHERE id=$1`, [lead.id]);
      res = { result: "no_slots", say: "I couldn't find a free consultation slot right now. One of our designers will call you to fix a time that suits you.", lead_ref: lead.ref, next_step: "close_call_politely" };
    } else {
      res = { result: "slots", say: slotsSay(options), lead_ref: lead.ref, next_step: "ask_caller_to_choose_then_collect_email_then_call_book_slot", options };
    }
    await logEvent(lead.id, "get_slots", body, res);
    return res;
  } catch (err) {
    return failSafe("get_slots", body, err, lead);
  }
}

// ---------- book_slot ----------

export async function bookSlot(body: Record<string, unknown>): Promise<ToolResponse> {
  let lead: Lead | undefined;
  try {
    const p = cleanParams(body);
    lead = await resolveLead(p);
    if (!lead) throw new Error("book_slot called before check_lead (no lead found)");
    if (lead.outcome !== "qualified") {
      const res = { result: "not_available", say: "Before booking, I just need a few more details about your project.", lead_ref: lead.ref, next_step: "call_check_lead_first" };
      await logEvent(lead.id, "book_slot", body, res);
      return res;
    }
    const email = typeof p.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) ? p.email.toLowerCase() : null;
    if (!email) {
      const res = { result: "need_email", say: "Could you tell me your email address so we can send you the booking confirmation?", lead_ref: lead.ref, next_step: "collect_email_then_call_book_slot_again" };
      await logEvent(lead.id, "book_slot", body, res);
      return res;
    }
    const name = (p.name as string) ?? lead.name ?? "Aangan client";
    const offered: { option: number; start: string; label: string }[] = lead.offered_slots ?? [];
    let start: string | undefined;
    if (p.option !== undefined) start = offered.find((o) => o.option === Number(p.option))?.start;
    if (!start && typeof p.slot_start === "string" && !Number.isNaN(Date.parse(p.slot_start))) start = new Date(p.slot_start).toISOString();
    if (!start) {
      const res = { result: "need_choice", say: offered.length ? slotsSay(offered, "Sorry, I didn't catch which time you'd like. ") : "Let me check the available times for you.", lead_ref: lead.ref, next_step: offered.length ? "ask_caller_to_choose_then_call_book_slot" : "call_get_slots", options: offered };
      await logEvent(lead.id, "book_slot", body, res);
      return res;
    }

    // Idempotency: one booking per lead.
    const existing = await q1(`SELECT * FROM bookings WHERE lead_id=$1`, [lead.id]);
    if (existing?.status === "confirmed") {
      const same = new Date(existing.slot_start).toISOString() === start;
      const res = { result: "booked", say: same
        ? `You're all set for ${slotLabel(start)}. You'll receive a confirmation email shortly.`
        : `You already have a consultation booked for ${slotLabel(new Date(existing.slot_start).toISOString())}. If you'd like to change it, our designer will help you when they confirm.`,
        lead_ref: lead.ref, next_step: "wrap_up" };
      await logEvent(lead.id, "book_slot", body, res);
      return res;
    }

    // Nothing is booked until the caller has said yes to this exact slot and email.
    const pending = lead.pending_confirmation as { start: string; email: string } | null;
    const matchesReadBack = pending?.start === start && pending?.email === email;
    if (p.confirmed !== true || !matchesReadBack) {
      await q(`UPDATE leads SET pending_confirmation=$2, updated_at=now() WHERE id=$1`, [lead.id, JSON.stringify({ start, email })]);
      const res = {
        result: "confirm_needed",
        say: `Just to confirm — ${slotLabel(start)}, with the confirmation sent to ${email}. Shall I book it?`,
        lead_ref: lead.ref,
        next_step: "if_caller_says_yes_call_book_slot_again_with_confirmed_true_otherwise_ask_what_to_change",
      };
      await logEvent(lead.id, "book_slot", body, res);
      return res;
    }

    await q(
      `INSERT INTO bookings (lead_id, slot_start, attendee_name, attendee_email, status) VALUES ($1,$2,$3,$4,'pending')
       ON CONFLICT (lead_id) DO UPDATE SET slot_start=EXCLUDED.slot_start, attendee_name=EXCLUDED.attendee_name,
         attendee_email=EXCLUDED.attendee_email, status='pending', error=NULL, updated_at=now()`,
      [lead.id, start, name, email],
    );

    // A previous attempt may have reached Cal.com before timing out — look before creating.
    let booking = existing ? await findExistingBooking(email, lead.ref, start).catch(() => null) : null;
    if (!booking) {
      try {
        booking = await createBooking({ startUtcIso: start, name, email, phone: lead.caller_phone ?? undefined, leadRef: lead.ref });
      } catch (err) {
        if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
          // Most likely the slot was just taken. Offer fresh options.
          await q(`UPDATE bookings SET status='failed', error=$2, updated_at=now() WHERE lead_id=$1`, [lead.id, err.message.slice(0, 500)]);
          const options = await offerSlots(lead);
          if (options?.length) {
            const res = { result: "slot_unavailable", say: slotsSay(options, "I'm sorry, that time has just been taken. "), lead_ref: lead.ref, next_step: "ask_caller_to_choose_then_call_book_slot", options };
            await logEvent(lead.id, "book_slot", body, res, err.message);
            return res;
          }
        }
        throw err;
      }
    }
    await q(`UPDATE bookings SET status='confirmed', cal_booking_uid=$2, cal_booking_id=$3, slot_start=$4, updated_at=now() WHERE lead_id=$1`,
      [lead.id, booking.uid, booking.id, new Date(booking.start).toISOString()]);
    await q(`UPDATE leads SET email=$2, name=COALESCE(name,$3), status='consultation_booked', needs_callback=false, updated_at=now() WHERE id=$1`,
      [lead.id, email, name]);
    const res = { result: "booked", say: `You're booked for ${slotLabel(start)} with one of our designers. You'll receive a confirmation email shortly. Is there anything else I can help you with?`, lead_ref: lead.ref, next_step: "wrap_up" };
    await logEvent(lead.id, "book_slot", body, res);
    return res;
  } catch (err) {
    if (lead) await q(`UPDATE bookings SET status='failed', error=$2, updated_at=now() WHERE lead_id=$1 AND status='pending'`, [lead.id, String(err).slice(0, 500)]).catch(() => {});
    return failSafe("book_slot", body, err, lead);
  }
}
