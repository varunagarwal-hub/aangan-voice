// Live check for one integration at a time, as keys are added. Mock mode is ignored here.
// Usage: npm run check -- gemini
process.env.MOCK_MODE = "false";

const which = process.argv[2];

async function gemini() {
  const { writeBrief } = await import("../lib/integrations/gemini");
  const { env } = await import("../lib/env");
  const transcript = [
    "AGENT: Hello, thank you for calling Aangan Studio. I'm Aangan's AI assistant. May I know your name?",
    "USER: Hi, I'm Priya. We have a 3BHK in Kothrud, Dahanukar Colony, about 1,400 sq ft carpet. We want to redo the whole thing — kitchen, living room, both bedrooms.",
    "AGENT: When would you need the project complete?",
    "USER: By March, no rush. My husband knows I'm calling and is happy to go ahead. Roughly how much would it cost?",
    "AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
  ].join("\n\n");
  const t0 = Date.now();
  const { output, usage } = await writeBrief({
    transcript,
    lead: { name: "Priya", project_category: "residential", property_type: "apartment", scope: "full_home", location: "Kothrud", carpet_area_sqft: 1400, timeline_text: "by March" },
    outcome: "qualified",
    notes: [],
    booking: null,
  });
  console.log(`Model: ${env.geminiModel}  (${Date.now() - t0} ms)`);
  console.log("Usage:", usage);
  console.log(JSON.stringify(output, null, 2));
}

async function telegram() {
  const { env, need } = await import("../lib/env");
  const token = need(env.telegramToken, "TELEGRAM_BOT_TOKEN");
  const api = async (method: string) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`);
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
    return body.result;
  };
  const me = await api("getMe");
  console.log(`Bot: @${me.username} (${me.first_name}), id ${me.id}`);
  const updates: any[] = await api("getUpdates");
  const chats = new Map<string, any>();
  for (const u of updates) {
    const c = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (c && c.type !== "private") chats.set(String(c.id), c);
  }
  if (!chats.size) console.log("No group seen yet. Add the bot to the group and send a message there, then re-run.");
  for (const c of chats.values()) console.log(`Group: "${c.title}"  type=${c.type}  chat_id=${c.id}`);
  console.log(`TELEGRAM_CHAT_ID in .env: ${env.telegramChatId ?? "(not set)"}`);
  if (process.argv[3] === "--send") {
    const { sendTelegram } = await import("../lib/integrations/telegram");
    const r = await sendTelegram("✅ <b>Aangan intake bot connected.</b>\nQualified leads, urgent client escalations and callback requests will be posted here.");
    console.log(`Test message sent, message_id ${r.message_id}`);
  }
}

async function calcom() {
  const { env } = await import("../lib/env");
  const { getAvailableSlots } = await import("../lib/integrations/calcom");
  const { pickThree, slotLabel } = await import("../lib/tools");
  console.log(`Event type: ${env.calEventTypeId ?? "(not set)"}  API key: ${env.calApiKey ? "set" : "(not set)"}`);
  // Read-only: lists free slots, books nothing.
  const from = new Date(Date.now() + 60 * 60 * 1000);
  const to = new Date(from.getTime() + env.slotSearchDays * 86400000);
  const slots = await getAvailableSlots(from.toISOString(), to.toISOString());
  console.log(`${slots.length} free slots in the next ${env.slotSearchDays} days.`);
  const days = new Map<string, number>();
  for (const s of slots) {
    const d = new Date(s.start).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
    days.set(d, (days.get(d) ?? 0) + 1);
  }
  for (const [d, n] of days) console.log(`  ${d}: ${n} slot(s)`);
  if (slots[0]?.end) console.log(`Slot length: ${(Date.parse(slots[0].end) - Date.parse(slots[0].start)) / 60000} min`);
  const three = pickThree(slots);
  console.log("Vaani would offer:");
  three.forEach((s, i) => console.log(`  option ${i + 1}, ${slotLabel(s.start)}`));
}

async function hubspot() {
  // Read-only: pipelines, stages, and whether our custom properties exist yet. Creates nothing.
  const { env, need } = await import("../lib/env");
  const { CONTACT_PROPERTIES, DEAL_PROPERTIES } = await import("../lib/integrations/hubspot");
  const v = env.hubspotApiVersion;
  const headers = { Authorization: `Bearer ${need(env.hubspotToken, "HUBSPOT_TOKEN")}` };
  const get = async (path: string) => {
    const res = await fetch(`https://api.hubapi.com${path}`, { headers });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };
  console.log(`API version: ${v}`);

  const c = await get(`/crm/objects/${v}/contacts?limit=1`);
  console.log(`Read contacts: ${c.status === 200 ? "OK" : `HTTP ${c.status} ${c.body.message ?? ""}`}`);
  const d = await get(`/crm/objects/${v}/deals?limit=1`);
  console.log(`Read deals:    ${d.status === 200 ? "OK" : `HTTP ${d.status} ${d.body.message ?? ""}`}`);

  const p = await get(`/crm/pipelines/${v}/deals`);
  if (p.status !== 200) console.log(`Pipelines: HTTP ${p.status} ${p.body.message ?? ""}`);
  for (const pl of p.body.results ?? []) {
    console.log(`\nPipeline "${pl.label}"  id=${pl.id}`);
    for (const s of [...(pl.stages ?? [])].sort((a: any, b: any) => a.displayOrder - b.displayOrder))
      console.log(`  ${String(s.id).padEnd(24)} ${s.label}`);
  }
  const want = env.hubspotStage;
  console.log(`\n.env uses pipeline=${env.hubspotPipeline}, stages: booked=${want.booked}, qualified=${want.qualified}, not_qualified=${want.not_qualified}, other=${want.other}`);
  const pipeline = (p.body.results ?? []).find((x: any) => x.id === env.hubspotPipeline);
  if (pipeline) {
    const ids = new Set(pipeline.stages.map((s: any) => String(s.id)));
    for (const [k, id] of Object.entries(want)) console.log(`  ${k.padEnd(14)} ${id.padEnd(24)} ${ids.has(id) ? "✓ exists" : "✗ NOT in this pipeline"}`);
  } else if (p.status === 200) console.log(`  ✗ pipeline "${env.hubspotPipeline}" not found`);

  console.log("\nCustom properties:");
  for (const [object, props] of [["contacts", CONTACT_PROPERTIES], ["deals", DEAL_PROPERTIES]] as const) {
    let have = 0;
    for (const prop of props) if ((await get(`/crm/properties/${v}/${object}/${prop.name}`)).status === 200) have++;
    console.log(`  ${object}: ${have}/${props.length} exist${have < props.length ? " (run npm run hubspot:setup to create)" : ""}`);
  }
}

async function vaani() {
  // Read-only: recent call history + one call's details, to confirm field names/formats the backend relies on.
  const { env, need } = await import("../lib/env");
  const headers = { "X-API-Key": need(env.vaaniApiKey, "VAANI_API_KEY") };
  const mask = (s: unknown) => (typeof s === "string" && s.length > 4 ? s.slice(0, 3) + "…" + s.slice(-2) : s);
  const res = await fetch(`${env.vaaniBaseUrl}/api/call-history?page=1&page_size=5`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`call-history HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  console.log(`call-history OK. Total calls: ${body.pagination?.total_count ?? "?"}`);
  const calls: any[] = body.data ?? [];
  if (!calls.length) { console.log("No calls yet — fine; make a test call later."); return; }
  const used = ["call_id", "from_number", "to_number", "direction", "Start_time", "End_time", "duration_ms", "call_cost", "call_status", "post_processing_status"];
  console.log("Fields the backend uses:", used.map((k) => `${k}${k in calls[0] ? "✓" : "✗"}`).join(" "));
  for (const c of calls)
    console.log(`  ${c.call_id}  ${c.direction ?? "?"}  from=${mask(c.from_number)}  start=${c.Start_time}  end=${c.End_time}  duration_ms=${c.duration_ms}  cost=${c.call_cost}  pp=${c.post_processing_status}`);
  const d = await fetch(`${env.vaaniBaseUrl}/api/call_details/${encodeURIComponent(calls[0].call_id)}`, { headers });
  const dt = await d.text();
  if (!d.ok) { console.log(`call_details HTTP ${d.status}: ${dt.slice(0, 200)}`); return; }
  const det = JSON.parse(dt);
  console.log(`call_details OK. Keys: ${Object.keys(det).join(", ")}`);
  const tr = typeof det.transcription === "string" ? det.transcription : "";
  console.log(`Transcript: ${tr.length} chars; starts: ${JSON.stringify(tr.slice(0, 80))}`);
}

const checks: Record<string, () => Promise<void>> = { gemini, telegram, calcom, hubspot, vaani };

(async () => {
  const fn = checks[which];
  if (!fn) throw new Error(`Unknown check "${which}". Available: ${Object.keys(checks).join(", ")}`);
  await fn();
  console.log(`\n✓ ${which} OK`);
})().catch((err) => { console.error(`\n✗ ${which} failed:`, err?.message ?? err); process.exit(1); });
