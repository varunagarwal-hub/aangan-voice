# Where to get each key

Put every value in `.env` locally and in **Vercel → Project → Settings → Environment Variables** for production.
APIs and screens were checked against each provider's docs on 8 Oct 2026. Menus move, so if a step doesn't match, search the provider's docs for the name in bold.

## Your own secrets (make them up)

Generate random strings, e.g. `openssl rand -hex 24`, or any password generator (24+ characters).

| Variable | Used for |
|---|---|
| `TOOL_SECRET` | Sent by Vaani with every tool call (header `x-tool-secret` or `?key=`). |
| `VAANI_WEBHOOK_TOKEN` | Put at the end of the webhook URL you give Vaani: `/api/vaani/webhook?token=…` |
| `CRON_SECRET` | Vercel Cron sends it automatically as `Authorization: Bearer …`. Just set it in Vercel. |
| `DASHBOARD_PASSWORD` | The one password designers type to open the dashboard. |
| `SESSION_SECRET` | Signs the login cookie. Change it to log everyone out. |

## Neon (database)

1. Sign in at **console.neon.tech** → **New project** (region: *AWS Asia Pacific (Singapore)* or the closest to Pune).
2. On the project dashboard click **Connect**, choose **Pooled connection**, copy the string → `DATABASE_URL`.
3. Create the tables once: `npm run db:migrate` (with `DATABASE_URL` in `.env`).
   Alternatively: Vercel → **Storage** → **Neon**, which creates the database and sets `DATABASE_URL` for you.

## Vaani (voice agent) — docs.vaanivoice.ai

1. **API key:** app.vaanivoice.ai → **Settings → API Keys → Generate API Key**. It is shown once. → `VAANI_API_KEY` (starts with `vaani_`). The backend sends it as the `X-API-Key` header.
2. **Webhook:** **Settings → Webhooks** → add `https://YOUR-APP.vercel.app/api/vaani/webhook?token=VAANI_WEBHOOK_TOKEN`. We use the `call_postprocessing` event (it carries the transcript).
   If Vaani shows you a signing secret for webhooks, put it in `VAANI_WEBHOOK_SIGNING_SECRET`; otherwise leave it empty.
3. **Agent + tools:** follow [VAANI.md](VAANI.md).
4. **Cost:** Vaani's call history reports `call_cost` in **credits**. Ask Vaani (or check your plan) how much one credit costs in ₹ → `VAANI_INR_PER_CREDIT`. If you only have a per-minute price, set `VAANI_INR_PER_MIN` instead. If your Vaani price already includes the phone line, set `VAANI_COST_INCLUDES_TELEPHONY=true`; otherwise set `TELEPHONY_INR_PER_MIN` from your telephony bill.

## Cal.com (bookings)

1. Create an event type, e.g. **"Design consultation"** (set its length, location — studio or site visit — and your availability / designers there).
2. Open it. The number in the URL (`/event-types/123456`) → `CALCOM_EVENT_TYPE_ID`.
3. **Settings → Developer → API Keys → New** → `CALCOM_API_KEY` (starts with `cal_`).
4. Cal.com sends the confirmation email to the caller. Availability, buffers, minimum notice and round-robin between designers are all configured in Cal.com.

## Telegram (designer group)

1. In Telegram, open **@BotFather** → `/newbot` → follow the prompts → copy the token → `TELEGRAM_BOT_TOKEN`.
2. Add the bot to your designers' group.
3. Send any message in the group, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find `"chat":{"id":-100…}`. That negative number → `TELEGRAM_CHAT_ID`.
   (The bot only sends messages, so you don't need to change its privacy mode.)

## HubSpot (for Nikhil)

HubSpot is replacing "legacy private apps" with **Service Keys**. Creating new legacy private apps stops on **26 Oct 2026** for existing accounts, and has already stopped for accounts created after 28 Sep 2026. Either works with this app. Both are sent as a Bearer token.

- **Service key:** **Settings → Integrations → Service Keys → Create**.
- **Legacy private app** (if you already have one or create it before 26 Oct): **Development → Legacy apps → Create** → **Auth** tab → copy the access token.

Scopes to tick: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.contacts.write`, `crm.schemas.deals.read`, `crm.schemas.deals.write`.
→ `HUBSPOT_TOKEN`.

Then run once: `npm run hubspot:setup`. This:
- creates the custom properties (contact key, call ID, call cost split, outcome, brief, internal estimate…)
- prints your deal pipelines and stage IDs. If they differ from the defaults, set `HUBSPOT_PIPELINE` and `HUBSPOT_STAGE_*`.

## Gemini

1. Go to **aistudio.google.com → Get API key → Create API key** (attach a billing-enabled Google Cloud project for paid-tier limits) → `GEMINI_API_KEY`.
2. `GEMINI_MODEL` defaults to `gemini-3.8-flash`, the current Flash model per Google's model list.
3. Cost: Google's pricing page lists 3.8 Flash at $0.75 input / $3.75 output per 1M tokens until 31 Dec 2026, then $1.50 / $7.50. Update `GEMINI_USD_PER_1M_*` when it changes, and set `USD_TO_INR`.
