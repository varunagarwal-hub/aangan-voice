import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { formatEstimate } from "@/lib/rules";
import { Header, OutcomeBadge, inr, ist } from "../../Header";

export const dynamic = "force-dynamic";
const STATUSES = ["new", "contacted", "consultation_booked", "needs_callback", "closed"];
const CRITERIA_LABEL: Record<string, string> = {
  real_project: "1. Real project", service_area: "2. Service area", timeline: "3. Timeline", budget: "4. Budget", decision_maker: "5. Decision-maker",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const lead = await q1(`SELECT * FROM leads WHERE id=$1`, [id]);
  if (!lead) notFound();
  const calls = await q(`SELECT * FROM calls WHERE lead_id=$1 ORDER BY created_at DESC`, [id]);
  const booking = await q1(`SELECT * FROM bookings WHERE lead_id=$1`, [id]);
  const events = await q(`SELECT tool, request, response, error, created_at FROM tool_events WHERE lead_id=$1 ORDER BY id`, [id]);
  const sync = calls[0] ? await q(`SELECT step, status, error, updated_at FROM sync_log WHERE vaani_call_id=$1 ORDER BY id`, [calls[0].vaani_call_id]) : [];
  const i = lead.raw_input ?? {};
  const review = [...(lead.human_review ?? []), ...(lead.ai_flags ?? [])];

  return (
    <>
      <Header />
      <main>
        <p><a href="/">← All leads</a></p>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>{lead.name ?? lead.caller_phone ?? "Unknown caller"} <span className="muted">· {lead.ref}</span></h1>
          <OutcomeBadge outcome={lead.outcome} booked={booking?.status === "confirmed"} />
        </div>

        {review.length > 0 && (
          <div className="panel" style={{ borderColor: "var(--warn)" }}>
            <b className="warn">⚑ Needs human review</b>
            <ul>{review.map((r: string, n: number) => <li key={n}>{r}</li>)}</ul>
          </div>
        )}

        <div className="grid2">
          <div>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Lead</h2>
              <dl>
                <dt>Phone</dt><dd>{lead.caller_phone ?? "—"}</dd>
                <dt>Email</dt><dd>{lead.email ?? "—"}</dd>
                <dt>Project</dt><dd>{[i.project_category, i.property_type, i.scope].filter((x: string) => x && x !== "unknown").join(" / ") || "—"}</dd>
                <dt>Location</dt><dd>{i.location ?? "—"}</dd>
                <dt>Carpet area</dt><dd>{i.carpet_area_sqft ? `${i.carpet_area_sqft} sq ft` : "—"}</dd>
                <dt>Timeline</dt><dd>{i.timeline_text ?? (i.no_fixed_deadline ? "No fixed deadline" : "—")}</dd>
                <dt>Budget</dt><dd>{i.budget_volunteered ? `Volunteered: ${inr(i.budget_min_inr)} – ${inr(i.budget_max_inr)}` : "Not mentioned"}</dd>
                <dt>Requirements</dt><dd>{i.requirements ?? "—"}</dd>
                <dt>Consultation</dt><dd>{booking?.status === "confirmed" ? `${ist(booking.slot_start)} (Cal.com ${booking.cal_booking_uid})` : booking ? `${booking.status}: ${booking.error ?? ""}` : "Not booked"}</dd>
                <dt>Priority</dt><dd>{lead.priority_score ? `${lead.priority_score}/5 — ${lead.priority_reason}` : "—"}</dd>
              </dl>
              <form method="post" action={`/api/leads/${id}`} className="row" style={{ marginTop: 12 }}>
                <input type="hidden" name="action" value="status" />
                <select name="status" defaultValue={lead.status}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
                <button type="submit">Update status</button>
              </form>
            </div>

            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Qualification (rules from qualified.md)</h2>
              <table>
                <tbody>
                  {Object.keys(CRITERIA_LABEL).filter((k) => lead.criteria?.[k]).map((k) => [k, lead.criteria[k]] as [string, any]).map(([k, v]: [string, any]) => (
                    <tr key={k}><td>{CRITERIA_LABEL[k] ?? k}</td><td><span className={`badge ${v.status === "pass" ? "b-qualified" : v.status === "fail" ? "b-escalation" : "b-needs_clarification"}`}>{v.status}</span></td><td className="muted">{v.reason}</td></tr>
                  ))}
                </tbody>
              </table>
              {(lead.handoff_notes ?? []).length > 0 && <><h2>Handoff notes</h2><ul>{lead.handoff_notes.map((n: string, x: number) => <li key={x}>{n}</li>)}</ul></>}
            </div>

            <div className="panel estimate">
              <h2 style={{ marginTop: 0 }}>Internal estimate — never quote to client</h2>
              <p>{formatEstimate(lead.internal_estimate)}</p>
            </div>
          </div>

          <div>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Summary</h2>
              <p>{lead.summary ?? <span className="muted">Not generated yet.</span>}</p>
              <h2>Designer brief</h2>
              {lead.designer_brief ? <pre>{lead.designer_brief}</pre> : <p className="muted">Not generated yet.</p>}
            </div>
            {calls.map((c) => (
              <div className="panel" key={c.id}>
                <h2 style={{ marginTop: 0 }}>Call {c.vaani_call_id}</h2>
                <dl>
                  <dt>Started</dt><dd>{ist(c.started_at)}{c.after_hours ? " · 🌙 after hours" : ""}</dd>
                  <dt>Duration</dt><dd>{c.duration_sec ? `${Math.round(c.duration_sec)} s` : "—"}</dd>
                  <dt>Cost</dt><dd>{inr(c.cost_total_inr)} <span className="muted">(Vaani {inr(c.cost_vaani_inr)} · telephony {inr(c.cost_telephony_inr)} · Gemini {inr(c.cost_gemini_inr)})</span>{!c.cost_complete && <div className="warn">Some cost rates are not set — see README.</div>}</dd>
                  <dt>Matched by</dt><dd>{c.link_method ?? "—"}</dd>
                  <dt>Processing</dt><dd>{c.processing_status}{c.last_error ? <span className="bad"> — {c.last_error}</span> : null}</dd>
                  {c.recording_url && <><dt>Recording</dt><dd><a href={c.recording_url}>Listen</a></dd></>}
                </dl>
                <h2>Transcript</h2>
                <pre>{c.transcript ?? "Not available yet."}</pre>
              </div>
            ))}
            {sync.length > 0 && (
              <div className="panel">
                <h2 style={{ marginTop: 0 }}>Sync steps</h2>
                <table><tbody>{sync.map((s) => <tr key={s.step}><td>{s.step}</td><td>{s.status}</td><td className="bad">{s.error}</td></tr>)}</tbody></table>
                <form method="post" action={`/api/leads/${id}`} style={{ marginTop: 10 }}>
                  <input type="hidden" name="action" value="reprocess" />
                  <button className="secondary" type="submit">Retry failed steps</button>
                </form>
              </div>
            )}
            <details className="panel">
              <summary>Tool calls during the call ({events.length})</summary>
              {events.map((e, n) => (
                <div key={n} style={{ marginTop: 8 }}>
                  <b>{e.tool}</b> <span className="muted">{ist(e.created_at)}</span>{e.error && <span className="bad"> {e.error}</span>}
                  <pre>{JSON.stringify({ request: e.request, response: e.response }, null, 2)}</pre>
                </div>
              ))}
            </details>
          </div>
        </div>
      </main>
    </>
  );
}
