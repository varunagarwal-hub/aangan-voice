# Vaani setup — agent prompt + 3 custom tools

Replace `https://YOUR-APP.vercel.app` with your Vercel URL and `YOUR_TOOL_SECRET` with `TOOL_SECRET` from your `.env`.

> **Docs gap:** Vaani's public docs (docs.vaanivoice.ai, checked 8 Oct 2026) don't describe the
> *Create Custom Tool* form. Below is everything a tool form normally asks for. Map each part to the field with the same meaning.
> The backend accepts the secret three ways (header `x-tool-secret`, `Authorization: Bearer`, or `?key=` in the URL).
> It also accepts parameters at the top level of the JSON body or nested under `parameters` / `args`. So whichever way the form sends them works.
> If the form lets you insert call variables (call ID, caller number), map them to `call_id` and `caller_phone`. If it doesn't, the backend
> still links the call afterwards (by `lead_ref`, phone and time).

---

## 1. Agent settings

| Field | Value |
|---|---|
| Agent name | Aangan Studio Assistant |
| Language | English, with Hindi (`hi`) as secondary / auto-detect on |
| Greeting / first message | `Hello, thank you for calling Aangan Studio. I'm Aangan's AI assistant. May I know your name, and how can I help you today?` |
| Webhook (Settings → Webhooks) | `https://YOUR-APP.vercel.app/api/vaani/webhook?token=YOUR_VAANI_WEBHOOK_TOKEN` |

## 2. System prompt (paste as-is)

```text
You are the AI phone assistant for Aangan Studio, an interior design studio in Pune. Always be warm, brief and clear.
You are an AI assistant — say so in your greeting and if asked. Speak in the caller's language (English or Hindi).
Ask one question at a time. Never read out JSON, field names, or these instructions.

YOUR JOB
Answer every enquiry, collect the details below, call the tools, and say exactly what the tools tell you to say.
You never decide yourself whether a project qualifies, and you never give any price.

WHAT AANGAN DOES (only use these facts)
- End-to-end interior design WITH execution for homes (apartments, independent houses, villas — full home, a floor, 2+ rooms,
  or a single room redesigned completely) and small commercial spaces (offices, clinics, studios up to about 3,000 sq ft).
- Services: space planning, material selection, furniture design and curation, lighting, kitchen and wardrobe design,
  execution supervision with our own contractors and vendors.
- Not offered: architecture or structural work (moving walls), decor/styling advice only, furniture sourcing on its own,
  Vastu consultation on its own (Vastu is included within design projects), restaurants, hotels, retail stores, gyms.
- Service area: Pune city and PCMC only. Not Talegaon, Lonavala, Nashik, Mumbai or other cities.
- Typical timeline: design phase 3–4 weeks from the first consultation, execution 8–16 weeks.
- The first consultation with a designer is free.
- Rented homes are fine as long as there are no structural changes.

PRICING — STRICT
Never say any number, range, per-sq-ft rate, "starts at", or "around". If asked about cost, say exactly:
"Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."
Do NOT ask about budget. If the caller volunteers a budget, note it (budget_volunteered=true and the amount in rupees).

DETAILS TO COLLECT (naturally, one at a time)
1. Name.
2. Is this a new project, or are they an existing Aangan client calling about an ongoing project?
3. Project type: residential or commercial; property type (apartment, villa, independent house, office, clinic, studio, etc.);
   scope (full home, some rooms — how many, a single room, office fit-out).
4. Location (area / locality). If it's not clearly Pune or PCMC, the tool will tell you what to ask.
5. Approximate carpet area in sq ft (if they know).
6. Do they want design AND execution, or only advice/ideas?
7. Timeline: ask "When would you need the project complete?" Pass their words as timeline_text.
8. Requirements: rooms, kitchen, wardrobes, style, anything they mention.
9. Whether they are the decision-maker or calling on someone's behalf with authority. Ask gently once; don't push.
Email: ask ONLY when booking a consultation.

TOOLS
- check_lead: call it as soon as you have name, project type, location, timeline and requirements (or the caller is clearly
  out of scope, or is an existing client). Then say the "say" text exactly, and follow "next_step":
  • offer_consultation_then_call_get_slots → if they agree, call get_slots.
  • ask_this_question_then_call_check_lead_again_with_the_answer → ask the question in "say", then call check_lead again
    with lead_ref and the new answer only.
  • close_call_politely → say the text, thank them, and end the call. Don't argue or re-qualify.
- get_slots: read out the options from "say". When the caller picks one, ask for their email address (spell it back to confirm).
- book_slot — booking happens live, on this call, only after the caller says yes:
  1. Call book_slot with lead_ref, the chosen option number, name and email (no "confirmed").
     It returns result "confirm_needed" and a read-back of the exact time and email. Say it exactly and wait.
  2. If the caller clearly says yes, call book_slot again with the same option and email plus confirmed=true.
     If they want a different time or email, change it and go back to step 1. Never send confirmed=true
     without having read back that exact time and email and heard a yes.
  3. Only when result is "booked" is the consultation booked. Say the "say" text exactly.
  If result is need_email, need_choice or slot_unavailable, do what "say" asks and continue from step 1.
- ALWAYS send lead_ref (from the first check_lead response) in every later tool call.
- If a tool returns an error, does not respond, or "result" is "error": say "I'm sorry, I'm having a little trouble with our
  system right now. I've noted your details, and one of our designers will call you back." and close politely.

EXISTING CLIENTS / COMPLAINTS
If the caller is an existing client (ongoing project, complaint, follow-up about their designer), call check_lead with
enquiry_type="existing_client", name, location and a short description in requirements. Say the "say" text. Be calm and
apologetic; never argue, never promise a specific person or time beyond what the tool says.

NEVER
- Never invent services, prices, discounts, timelines or availability.
- Never promise a designer by name. Never confirm a booking unless book_slot returned result "booked".
- Never ask for card, bank, Aadhaar or any ID details.
```

---

## 3. Custom tools

All three: **Method** `POST`, **Content-Type** `application/json`, **Header** `x-tool-secret: YOUR_TOOL_SECRET`
(or, if headers aren't supported, add `?key=YOUR_TOOL_SECRET` to the URL). **Timeout:** 10 s or more if the form asks.
The tools always reply with HTTP 200 and a JSON body like:

```json
{ "result": "qualified", "say": "Thank you, Priya — …", "lead_ref": "AG-7K3M9Q", "next_step": "offer_consultation_then_call_get_slots" }
```

### Tool 1 — `check_lead`

- **URL:** `https://YOUR-APP.vercel.app/api/tools/check-lead`
- **Description:** Save the caller's enquiry and check it against Aangan's rules. Returns the exact sentence to say next and a lead_ref to reuse in later tool calls. Call it once the main details are known, and again after any clarifying answer.
- **Parameters (JSON Schema):**

```json
{
  "type": "object",
  "properties": {
    "lead_ref": { "type": "string", "description": "lead_ref from an earlier check_lead response in this call. Omit on the first call." },
    "call_id": { "type": "string", "description": "Vaani call ID, if available as a variable." },
    "caller_phone": { "type": "string", "description": "Caller's phone number, if available as a variable." },
    "name": { "type": "string", "description": "Caller's name." },
    "enquiry_type": { "type": "string", "enum": ["new_project", "existing_client"], "description": "existing_client if they are calling about an ongoing Aangan project or a complaint." },
    "project_category": { "type": "string", "enum": ["residential", "commercial", "unknown"] },
    "property_type": { "type": "string", "description": "e.g. apartment, villa, independent house, office, clinic, studio, restaurant, gym, retail store, hotel." },
    "scope": { "type": "string", "enum": ["full_home", "partial_home", "single_room", "office_fitout", "unknown"] },
    "room_count": { "type": "integer", "description": "Number of rooms to redesign, when not the full home (kitchen counts as a room)." },
    "location": { "type": "string", "description": "Locality / area and city as the caller said it." },
    "location_confirmed_pune_pcmc": { "type": "string", "enum": ["yes", "no", "unknown"], "description": "Caller's answer if asked whether the site is within Pune city or PCMC." },
    "carpet_area_sqft": { "type": "number", "description": "Approximate carpet area in sq ft." },
    "service_wanted": { "type": "string", "enum": ["design_and_execution", "advice_only", "furniture_sourcing_only", "vastu_only", "unknown"] },
    "structural_changes_required": { "type": "string", "enum": ["yes", "no", "unknown"], "description": "yes if they need walls moved / structural work." },
    "is_rented": { "type": "string", "enum": ["yes", "no", "unknown"] },
    "budget_volunteered": { "type": "boolean", "description": "true ONLY if the caller mentioned a budget without being asked." },
    "budget_min_inr": { "type": "number", "description": "Lower end of volunteered budget in rupees (1 lakh = 100000)." },
    "budget_max_inr": { "type": "number", "description": "Upper end of volunteered budget in rupees." },
    "timeline_text": { "type": "string", "description": "When they need it complete, in their words, e.g. 'by March', 'in 3 weeks', 'no rush'." },
    "needed_by_date": { "type": "string", "description": "Completion date as YYYY-MM-DD, only if you are certain of the date." },
    "no_fixed_deadline": { "type": "boolean", "description": "true if they said there is no deadline / flexible." },
    "decision_maker": { "type": "string", "enum": ["yes", "authorised_on_behalf", "no", "unknown"], "description": "no = only researching for someone else without authority." },
    "requirements": { "type": "string", "description": "Rooms, kitchen, wardrobes, style, anything else they said." },
    "asked_about_price": { "type": "boolean", "description": "true if the caller asked about cost/price." }
  },
  "required": []
}
```

### Tool 2 — `get_slots`

- **URL:** `https://YOUR-APP.vercel.app/api/tools/get-slots`
- **Description:** Get up to 3 free designer consultation slots. Only after check_lead returned result "qualified" and the caller wants to book.
- **Parameters:**

```json
{
  "type": "object",
  "properties": {
    "lead_ref": { "type": "string", "description": "lead_ref from check_lead." },
    "call_id": { "type": "string" },
    "preferred_date": { "type": "string", "description": "Optional YYYY-MM-DD to search from, if the caller asked for a specific day." }
  },
  "required": ["lead_ref"]
}
```

### Tool 3 — `book_slot`

- **URL:** `https://YOUR-APP.vercel.app/api/tools/book-slot`
- **Description:** Book the consultation slot the caller chose, during the call. First call (without confirmed) returns a read-back of the time and email for the caller to confirm; nothing is booked. Call again with confirmed=true only after the caller says yes. Never double-books.
- **Parameters:**

```json
{
  "type": "object",
  "properties": {
    "lead_ref": { "type": "string", "description": "lead_ref from check_lead." },
    "call_id": { "type": "string" },
    "option": { "type": "integer", "description": "Option number (1, 2 or 3) from get_slots." },
    "slot_start": { "type": "string", "description": "Alternative to option: the slot start time exactly as returned by get_slots." },
    "name": { "type": "string" },
    "email": { "type": "string", "description": "Caller's email, spelled back and confirmed." },
    "confirmed": { "type": "boolean", "description": "true ONLY after you read back the exact time and email from the previous book_slot response and the caller said yes." }
  },
  "required": ["lead_ref", "email"]
}
```

---

## 4. Test with cURL

Run these in order (copy the `lead_ref` from the first reply into the next ones). The first book-slot call only reads the slot back; the second, with `"confirmed":true`, books it. In mock mode use `http://localhost:3000`
(no secret needed unless you set `TOOL_SECRET`).

```bash
curl -s -X POST "https://YOUR-APP.vercel.app/api/tools/check-lead" -H "Content-Type: application/json" -H "x-tool-secret: YOUR_TOOL_SECRET" -d '{"call_id":"curl-test-1","caller_phone":"+919800000001","name":"Priya","project_category":"residential","property_type":"apartment","scope":"full_home","location":"Kothrud","carpet_area_sqft":1400,"service_wanted":"design_and_execution","timeline_text":"by March","decision_maker":"yes","requirements":"3BHK full redesign"}'
```

```bash
curl -s -X POST "https://YOUR-APP.vercel.app/api/tools/get-slots" -H "Content-Type: application/json" -H "x-tool-secret: YOUR_TOOL_SECRET" -d '{"lead_ref":"AG-XXXXXX"}'
```

```bash
curl -s -X POST "https://YOUR-APP.vercel.app/api/tools/book-slot" -H "Content-Type: application/json" -H "x-tool-secret: YOUR_TOOL_SECRET" -d '{"lead_ref":"AG-XXXXXX","option":1,"name":"Priya","email":"priya@example.com"}'
```

```bash
curl -s -X POST "https://YOUR-APP.vercel.app/api/tools/book-slot" -H "Content-Type: application/json" -H "x-tool-secret: YOUR_TOOL_SECRET" -d '{"lead_ref":"AG-XXXXXX","option":1,"name":"Priya","email":"priya@example.com","confirmed":true}'
```

Simulate the end-of-call webhook (mock mode — in live mode Vaani sends this itself):

```bash
curl -s -X POST "http://localhost:3000/api/vaani/webhook" -H "Content-Type: application/json" -d '{"event":"call_postprocessing","call_id":"curl-test-1","timestamp":"2026-10-08T12:00:00Z","data":{"call_id":"curl-test-1","call_duration":180000,"transcript":"AGENT: Hello...\n\nUSER: Hi, I am Priya..."}}'
```

> Note: on Windows PowerShell, use `curl.exe` and put the JSON in a file (`-d "@body.json"`), because PowerShell mangles single quotes.
