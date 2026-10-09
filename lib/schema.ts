// Database schema. Applied by `npm run db:migrate` (Neon) and automatically for the local mock DB.
export const SCHEMA_SQL = `
-- Aangan voice intake schema. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,              -- short ref returned to Vaani, e.g. AG-7K3M9Q
  vaani_call_id   text UNIQUE,                       -- set when known (tool param or post-call linking)
  caller_phone    text,
  name            text,
  email           text,
  raw_input       jsonb NOT NULL DEFAULT '{}'::jsonb, -- merged check_lead params
  outcome         text,                               -- qualified | not_qualified | needs_clarification | escalation | incomplete
  criteria        jsonb,
  handoff_notes   jsonb NOT NULL DEFAULT '[]'::jsonb,
  human_review    jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_estimate jsonb,                            -- pricing.md bands, INTERNAL ONLY
  clarify_asked   text[] NOT NULL DEFAULT '{}',
  offered_slots   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'new',        -- new | consultation_booked | needs_callback | contacted | closed
  needs_callback  boolean NOT NULL DEFAULT false,
  summary         text,
  designer_brief  text,
  priority_score  int,
  priority_reason text,
  ai_flags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (caller_phone, updated_at);
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at);

CREATE TABLE IF NOT EXISTS calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vaani_call_id     text UNIQUE NOT NULL,
  lead_id           uuid REFERENCES leads(id),
  from_number       text,
  started_at        timestamptz,
  ended_at          timestamptz,
  duration_sec      numeric,
  end_reason        text,
  after_hours       boolean,
  transcript        text,
  vaani_summary     text,
  recording_url     text,
  vaani_credits     numeric,
  cost_vaani_inr    numeric,
  cost_telephony_inr numeric,
  cost_gemini_inr   numeric,
  cost_total_inr    numeric,
  cost_complete     boolean NOT NULL DEFAULT false,
  gemini_tokens     jsonb,
  link_method       text,                             -- how the call was matched to a lead
  processing_status text NOT NULL DEFAULT 'pending',  -- pending | processing | done | error
  attempts          int NOT NULL DEFAULT 0,
  locked_at         timestamptz,
  last_error        text,
  raw_webhook       jsonb,
  raw_history       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_status_idx ON calls (processing_status);
CREATE INDEX IF NOT EXISTS calls_started_idx ON calls (started_at);

CREATE TABLE IF NOT EXISTS bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid UNIQUE NOT NULL REFERENCES leads(id),  -- one consultation per lead => no duplicates
  slot_start      timestamptz NOT NULL,
  attendee_name   text,
  attendee_email  text,
  status          text NOT NULL DEFAULT 'pending',            -- pending | confirmed | failed
  cal_booking_uid text,
  cal_booking_id  bigint,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per post-call step per call. A done step is never repeated.
CREATE TABLE IF NOT EXISTS sync_log (
  id            bigserial PRIMARY KEY,
  vaani_call_id text NOT NULL,
  step          text NOT NULL,
  status        text NOT NULL,          -- done | error | skipped
  result        jsonb,
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vaani_call_id, step)
);

-- Every tool request/response, for audit and debugging.
CREATE TABLE IF NOT EXISTS tool_events (
  id         bigserial PRIMARY KEY,
  lead_id    uuid,
  tool       text NOT NULL,
  request    jsonb,
  response   jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mock mode only: messages that would have gone to Telegram / HubSpot, and fake Vaani call records.
CREATE TABLE IF NOT EXISTS mock_outbox (
  id         bigserial PRIMARY KEY,
  channel    text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mock_vaani_calls (
  call_id    text PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
