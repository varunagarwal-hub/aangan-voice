# Aangan Studio — AI phone intake

Vaani answers every call to Aangan Studio and collects the enquiry. Rules written in plain code decide whether the lead qualifies. The caller can book a free designer consultation in Cal.com during the call. Designers get a brief in Telegram, every call is logged in Neon and HubSpot with its cost, and there is a shared-password dashboard.

```
Caller ──► Vaani agent ──tools──► /api/tools/check-lead   (save lead, run rules from /knowledge, return sentence)
                              ├─► /api/tools/get-slots    (Cal.com: up to 3 free slots)
                              └─► /api/tools/book-slot    (Cal.com: book, never twice)
        call ends ──webhook──► /api/vaani/webhook ──► transcript (Vaani call-details) ► link to lead ► Gemini summary/brief
                                                   ► cost ► Telegram group ► HubSpot contact + deal ► Neon
        safety net: /api/cron/process (Vercel Cron) — picks up missed webhooks via Vaani call-history, retries failed steps
```

## Run it locally in mock mode (no accounts needed)

```bash
npm install
```

```bash
npm run dev
```

`.env` already contains `MOCK_MODE=true`. Open http://localhost:3000 and sign in with the password `aangan` (the mock default, changed by `DASHBOARD_PASSWORD`).

- Go to **Simulator**, then click **Run** on any September transcript, or run all of them. Each run goes through every real endpoint: check_lead → find_consultation_slots → reserve_consultation (+ a deliberate retry) → webhook → post-call processing. Only Vaani, Cal.com, Telegram, HubSpot and Gemini are faked. What they would have received appears in the *mock outbox*.
- From a terminal while `npm run dev` is running (it exits non-zero if any outcome differs from the expected one):

```bash
npm run simulate
```

- To test failures, set e.g. `MOCK_FAIL=calcom,hubspot` in `.env`, restart, and run a transcript. Vaani gets the "a designer will call you back" line. The lead is kept and flagged *needs callback*. Telegram gets an alert, and the failed step shows on the lead page with **Retry failed steps**.
- The mock database lives in `./.pglite`. Delete the folder to start fresh.

Unit tests (rules against all 19 answered phone transcripts, pricing guard, helpers):

```bash
npm test
```

## Go live

1. Get the keys: see [docs/KEYS.md](docs/KEYS.md). Copy `.env.example` to `.env` and set `MOCK_MODE=false`.
2. Create the tables in Neon: `npm run db:migrate`. Then run `npm run hubspot:setup` once.
3. Deploy to Vercel (import the repo, add every variable from `.env`). Set `APP_URL` to the Vercel URL.
4. Set up the Vaani agent, the 3 tools and the webhook: see [docs/VAANI.md](docs/VAANI.md).
5. Make a test call. Check the dashboard, the Telegram group and HubSpot.

## How decisions are made

Everything that decides is in two files, written only from `/knowledge`:

- [`lib/knowledge.ts`](lib/knowledge.ts): every fact copied from `services.md`, `pricing.md` and `qualified.md`, with the source noted.
- [`lib/rules.ts`](lib/rules.ts): the five `qualified.md` criteria as code.

| Criterion | Fails when | Unclear → |
|---|---|---|
| 1. Real project | advice only, furniture sourcing only, Vastu only, structural work, restaurant / hotel / retail / gym | asks once: design + execution or advice only? |
| 2. Service area | Talegaon, Lonavala, Nashik, Mumbai, or caller says not Pune/PCMC | asks once: "Is the site within Pune city or PCMC?" Unlisted locality confirmed as Pune/PCMC passes but is flagged for review. |
| 3. Timeline | needed in under 6 weeks (`services.md`) | asks once: "When would you need the project complete?" 6–10 weeks passes with a *tight timeline* note. |
| 4. Budget | only if volunteered and below 50% of the lowest `pricing.md` figure for that scope (₹1,800/sq ft residential, ₹1,200/sq ft commercial, ₹3.5 L per room for room-only jobs) | never asked. Below the lowest tier but above 50% passes with a note. |
| 5. Decision-maker | caller says they're only researching without authority | never pushed. Noted in the handoff. |

- Any one clear failure means not qualified: Vaani gives a polite close based on the transcripts. Two or more failures get `qualified.md`'s generic decline.
- If a criterion is still unclear after one question, the lead is forwarded with a review flag (`qualified.md`: "ask one direct question").
- Existing clients and complaints (like T09) are escalations. Telegram gets an urgent alert during the call. These are not qualified as new leads.

**Pricing:** Vaani never says a number. When asked, it gives the exact line from `pricing.md`. The backend still works out the indicative range from `pricing.md`: Standard / Premium / Luxury per sq ft for homes, Basic / Mid / Premium for commercial, and ₹3.5–8 L for a single room. That range is shown only to designers, in the dashboard, Telegram and HubSpot, labelled *"Indicative only — varies by site. Never quote to the client."* A test checks that no caller-facing sentence contains a price.

**Gemini** only writes the summary, the designer brief, a 1–5 priority score and review flags. It is told the qualification outcome. It cannot change the outcome. Any line of its output that contains a price is removed and flagged.

## Reliability: nothing lost, no duplicates

- **Mid-call failure.** Every tool catches errors and replies normally with the fallback sentence. The lead is saved, or created if needed, as *needs callback*, and Telegram gets an alert with whatever details were captured.
- **check_lead retries.** A retry updates the same lead. The lead is matched by `lead_ref`, then call ID, then caller phone (within 45 min), then name + location (within 20 min).
- **reserve_consultation retries.**
  - There is one booking row per lead (`UNIQUE`). A confirmed booking is returned instead of booking again.
  - Cal.com has no idempotency key. If an earlier attempt may have reached Cal.com, we first search its bookings by attendee email and our `aangan_lead_ref` metadata.
  - If the slot was just taken, Vaani offers fresh slots.
- **Post-call processing.**
  - Each step (Vaani fetch, link lead, Gemini, Telegram, HubSpot) is recorded in `sync_log`. A retry skips completed steps.
  - Calls are claimed atomically, so a webhook retry and the cron job can't process the same call twice.
  - HubSpot upserts on unique properties: contact by `aangan_contact_key` (phone, else email), deal by `aangan_call_id`.
- **Missed webhooks.** The cron job reads Vaani call-history and processes any inbound call it hasn't seen. A call where the caller hung up before giving details is still logged as an *incomplete* lead with a callback flag.

## Cost per call

`cost = Vaani + telephony + Gemini` (₹), stored per call and sent to HubSpot.

- **Vaani:** `call_cost` credits from call-history × `VAANI_INR_PER_CREDIT`. If that isn't set, minutes × `VAANI_INR_PER_MIN`.
- **Telephony:** minutes × `TELEPHONY_INR_PER_MIN`, or 0 if `VAANI_COST_INCLUDES_TELEPHONY=true`.
- **Gemini:** tokens from `usageMetadata` × `GEMINI_USD_PER_1M_*` × `USD_TO_INR`.

When a rate is missing, the dashboard shows "—" and a warning. It never shows a made-up number.

KPIs on the dashboard (7 / 30 / 90 days / all):
- calls
- after-hours calls (outside Mon–Fri 10:00–19:00 IST, the front-desk hours in the transcripts)
- qualified leads
- bookings
- total cost
- cost per lead and per qualified lead
- leads needing a callback

## Things to verify on first live use

These couldn't be confirmed from public docs:

1. **Vaani Custom Tool form.** Not documented. See the note at the top of [docs/VAANI.md](docs/VAANI.md). If the form can insert the call ID or caller number, map them, because it makes linking exact.
2. **Vaani webhook signing.** Signatures are only documented for campaign webhooks. We protect the webhook with the URL token, and check HMAC too if you set a signing secret.
3. **Vaani times.** `Start_time` / `End_time` in call-history have no timezone in the docs. We assume UTC. If after-hours KPIs look shifted by 5.5 h, change `parseVaaniTime` in `lib/postcall.ts`.
4. **Cal.com slot taken.** The error code isn't documented. Any 4xx on booking triggers a fresh slot offer.
5. **HubSpot.**
   - Default stage IDs vary by account. `npm run hubspot:setup` prints yours.
   - The deal–contact link uses the v4 *default association* endpoint.
6. **Gemini structured output.** The docs show two request shapes. We send `responseMimeType` + `responseJsonSchema`, and fall back to JSON-by-prompt if the API rejects it.

## Project map

```
knowledge/            the source files (services, pricing, qualified, September enquiries)
lib/knowledge.ts      facts from /knowledge
lib/rules.ts          qualification + internal estimate (no AI)
lib/tools.ts          check_lead / find_consultation_slots / reserve_consultation
lib/postcall.ts       webhook intake + post-call pipeline + cost
lib/integrations/     vaani, calcom, telegram, hubspot, gemini (each with a mock)
lib/schema.ts         Postgres schema
app/                  dashboard, lead page, simulator, API routes
tests/                rules tests from the transcripts, helper tests
docs/VAANI.md         agent prompt + tool definitions + cURL
docs/KEYS.md          where each key comes from
```
