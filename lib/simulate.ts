/**
 * Mock-mode simulator: plays a September transcript as if Vaani were on the phone.
 * It calls the real HTTP endpoints (check_lead → get_slots → book_slot → webhook), so the whole
 * production code path runs; only the external APIs are faked.
 */
import { q, q1 } from "./db";
import { env } from "./env";
import { processCall } from "./postcall";
import { PHONE_FIXTURES, type Fixture } from "@/tests/fixtures/transcripts";

export { PHONE_FIXTURES };

async function post(origin: string, path: string, body: unknown) {
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(env.toolSecret ? { "x-tool-secret": env.toolSecret } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

export async function runFixture(f: Fixture, origin: string, opts: { startedAt?: Date } = {}) {
  const callId = `sim-${f.id}-${Date.now().toString(36)}`;
  const phone = "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const started = opts.startedAt ?? new Date();
  const steps: { tool: string; request: unknown; response: any }[] = [];
  const lines: string[] = ["AGENT: Hello, thank you for calling Aangan Studio. I'm Aangan's AI assistant. How can I help you today?", `USER: ${f.transcript}`];

  const input = { ...f.input, call_id: callId, caller_phone: phone };
  let res = await post(origin, "/api/tools/check-lead", input);
  steps.push({ tool: "check_lead", request: input, response: res });
  lines.push(`AGENT: ${res.say}`);
  for (let i = 0; i < 3 && res.result === "needs_clarification"; i++) {
    lines.push("USER: I'm not sure, the designer can confirm that.");
    const again = { lead_ref: res.lead_ref, call_id: callId };
    res = await post(origin, "/api/tools/check-lead", again);
    steps.push({ tool: "check_lead", request: again, response: res });
    lines.push(`AGENT: ${res.say}`);
  }
  const leadRef = res.lead_ref;
  if (res.result === "qualified") {
    lines.push("USER: Yes, please.");
    const slots = await post(origin, "/api/tools/get-slots", { lead_ref: leadRef, call_id: callId });
    steps.push({ tool: "get_slots", request: { lead_ref: leadRef }, response: slots });
    lines.push(`AGENT: ${slots.say}`);
    if (slots.result === "slots") {
      const email = `${f.id.toLowerCase()}.test@example.com`;
      lines.push(`USER: The first one works. My email is ${email}.`);
      const choice = { lead_ref: leadRef, call_id: callId, option: 1, email, name: f.input.name ?? `Caller ${f.id}` };
      // First call reads the slot + email back; nothing is booked yet.
      const readBack = await post(origin, "/api/tools/book-slot", choice);
      steps.push({ tool: "book_slot (read-back)", request: choice, response: readBack });
      lines.push(`AGENT: ${readBack.say}`, "USER: Yes, please book it.");
      const bookReq = { ...choice, confirmed: true };
      const booked = await post(origin, "/api/tools/book-slot", bookReq);
      steps.push({ tool: "book_slot", request: bookReq, response: booked });
      lines.push(`AGENT: ${booked.say}`);
      // Simulate a network retry: must NOT create a second booking.
      const retry = await post(origin, "/api/tools/book-slot", bookReq);
      steps.push({ tool: "book_slot (retry)", request: bookReq, response: retry });
    }
  }
  lines.push("USER: Thank you, bye.", "AGENT: Thank you for calling Aangan Studio. Have a lovely day!");

  const durationMs = Math.max(90, lines.join(" ").length / 12) * 1000;
  const transcript = lines.join("\n\n");
  await q(`INSERT INTO mock_vaani_calls (call_id, data) VALUES ($1,$2) ON CONFLICT (call_id) DO UPDATE SET data=EXCLUDED.data`, [
    callId, JSON.stringify({ transcript, history: {
      call_id: callId, from_number: phone, direction: "inbound", Start_time: started.toISOString(),
      End_time: new Date(started.getTime() + durationMs).toISOString(), duration_ms: durationMs, call_cost: null,
    } }),
  ]);
  const webhook = { event: "call_postprocessing", call_id: callId, timestamp: new Date(started.getTime() + durationMs).toISOString(),
    data: { call_id: callId, call_duration: durationMs / 1000, end_reason: "user_hangup", transcript, summary: null, recording_url: null } };
  const wh = await fetch(`${origin}/api/vaani/webhook${env.webhookSecret ? `?token=${encodeURIComponent(env.webhookSecret)}` : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(webhook),
  });
  steps.push({ tool: "webhook call_postprocessing", request: { call_id: callId }, response: { status: wh.status } });
  // Process now (idempotent with the after() job the webhook started).
  let processed: { status: string; errors: string[] } = await processCall(callId);
  for (let i = 0; i < 60 && processed.status === "skipped_locked_or_done"; i++) {
    const c = await q1(`SELECT processing_status, last_error FROM calls WHERE vaani_call_id=$1`, [callId]);
    if (c && c.processing_status !== "processing" && c.processing_status !== "pending") {
      processed = { status: c.processing_status, errors: c.last_error ? [c.last_error] : [] };
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  steps.push({ tool: "post-call processing", request: { call_id: callId }, response: processed });
  const lead = await q1(`SELECT id, ref, outcome FROM leads WHERE vaani_call_id=$1`, [callId]);
  return { fixture: f.id, expected: f.expected, actual: lead?.outcome, leadId: lead?.id, callId, steps };
}
