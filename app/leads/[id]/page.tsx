import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { formatEstimate } from "@/lib/rules";
import { Avatar, BookedPill, Card, Icon, OutcomePill, Priority, Shell, Transcript, humanize, inr, ist, istDay, istTime } from "../../ui";

export const dynamic = "force-dynamic";
const STATUSES = ["new", "contacted", "consultation_booked", "needs_callback", "closed"];
const CRITERIA_LABEL: Record<string, string> = {
  real_project: "Real project", service_area: "Service area", timeline: "Timeline", budget: "Budget", decision_maker: "Decision-maker",
};
const STEP_LABEL: Record<string, string> = { vaani_fetch: "Transcript", link_lead: "Matched", gemini: "AI brief", telegram: "Telegram", hubspot: "HubSpot" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireLogin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const lead = await q1(`SELECT * FROM leads WHERE id=$1`, [id]);
  if (!lead) notFound();
  const calls = await q(`SELECT * FROM calls WHERE lead_id=$1 ORDER BY created_at DESC`, [id]);
  const booking = await q1(`SELECT * FROM bookings WHERE lead_id=$1`, [id]);
  const events = await q(`SELECT tool, request, response, error, created_at FROM tool_events WHERE lead_id=$1 ORDER BY id`, [id]);
  const call = calls[0];
  const sync = call ? await q(`SELECT step, status, error FROM sync_log WHERE vaani_call_id=$1 ORDER BY id`, [call.vaani_call_id]) : [];
  const i = lead.raw_input ?? {};
  const review = [...(lead.human_review ?? []), ...(lead.ai_flags ?? [])];
  const summary = lead.summary ?? call?.vaani_summary ?? null;
  const summarySource = lead.summary ? "AI summary" : call?.vaani_summary ? "Vaani's summary (AI brief pending)" : null;
  const booked = booking?.status === "confirmed";

  return (
    <Shell active="leads">
      <a href="/" className="back">{Icon.arrowLeft}All leads</a>

      <div className="hero">
        <Avatar name={lead.name ?? lead.caller_phone} tone={lead.outcome === "qualified" ? "good" : lead.outcome === "escalation" ? "bad" : "accent"} />
        <div>
          <h1>{lead.name ?? lead.caller_phone ?? "Unknown caller"}</h1>
          <div className="meta">
            <span>{lead.ref}</span>
            {lead.caller_phone && <span>{Icon.phone}{lead.caller_phone}</span>}
            <span>Received {ist(lead.created_at)}</span>
            {call?.after_hours && <span>{Icon.moon}After hours</span>}
          </div>
        </div>
        <div className="hero-actions">
          <div className="pills"><OutcomePill outcome={lead.outcome} />{booked && <BookedPill />}</div>
          <form method="post" action={`/api/leads/${id}`} className="inline-form">
            <input type="hidden" name="action" value="status" />
            <select name="status" defaultValue={lead.status}>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
            <button type="submit" className="secondary">Update</button>
          </form>
        </div>
      </div>

      {review.length > 0 && (
        <Card className="note" title={<>{Icon.alert}Needs a human look</>}>
          <ul className="bullets">{review.map((r: string, n: number) => <li key={n}>{r}</li>)}</ul>
        </Card>
      )}

      <div className="detail-grid">
        <div>
          <Card title={<>{Icon.home}Enquiry</>}>
            <div className={`booking ${booked ? "" : "none"}`}>
              {Icon.calendar}
              {booked ? (
                <div><div className="when">{istDay(booking.slot_start)}, {istTime(booking.slot_start)}</div><div className="small">Consultation booked in Cal.com</div></div>
              ) : (
                <div><div className="when" style={{ color: "inherit" }}>No consultation booked</div><div className="small">{booking?.error ? `Booking failed: ${booking.error.slice(0, 120)}` : lead.needs_callback ? "Call the customer to schedule" : "—"}</div></div>
              )}
            </div>
            <dl className="facts">
              <dt>Project</dt><dd>{[i.project_category, i.property_type, i.scope].filter((x: string) => x && x !== "unknown").map(humanize).join(" · ") || "—"}</dd>
              <dt>Location</dt><dd>{i.location ?? "—"}</dd>
              <dt>Carpet area</dt><dd>{i.carpet_area_sqft ? `${Number(i.carpet_area_sqft).toLocaleString("en-IN")} sq ft` : "—"}</dd>
              <dt>Timeline</dt><dd>{i.timeline_text ?? (i.no_fixed_deadline ? "No fixed deadline" : "—")}</dd>
              <dt>Requirements</dt><dd>{i.requirements ?? "—"}</dd>
              <dt>Budget</dt><dd>{i.budget_volunteered ? `Volunteered: ${inr(i.budget_min_inr)} – ${inr(i.budget_max_inr)}` : "Not mentioned"}</dd>
              <dt>Email</dt><dd>{lead.email ?? "—"}</dd>
              <dt>Priority</dt><dd><Priority score={lead.priority_score} />{lead.priority_reason && <div className="sub">{lead.priority_reason}</div>}</dd>
            </dl>
          </Card>

          <Card title={<>{Icon.check}Qualification</>} action={<span className="sub">rules from qualified.md</span>}>
            <ul className="criteria">
              {Object.keys(CRITERIA_LABEL).filter((c) => lead.criteria?.[c]).map((c) => {
                const v = lead.criteria[c];
                const tone = v.status === "pass" ? "good" : v.status === "fail" ? "bad" : "warn";
                return (
                  <li key={c}>
                    <span className={`mark tone-${tone}`}>{v.status === "pass" ? Icon.check : v.status === "fail" ? Icon.x : Icon.alert}</span>
                    <span className="name">{CRITERIA_LABEL[c]}</span>
                    <span className="why">{humanize(v.reason)}</span>
                  </li>
                );
              })}
              {!lead.criteria && <li className="muted">Not evaluated — the call ended before the details were collected.</li>}
            </ul>
            {(lead.handoff_notes ?? []).length > 0 && (
              <>
                <div className="label">Handoff notes</div>
                <ul className="bullets">{lead.handoff_notes.map((n: string, x: number) => <li key={x}>{n}</li>)}</ul>
              </>
            )}
          </Card>

          <Card className="estimate" title={<>{Icon.rupee}Internal estimate</>} action={<span className="pill pill-warn nocap">Never quote to client</span>}>
            <p className="prose">{formatEstimate(lead.internal_estimate)}</p>
          </Card>
        </div>

        <div>
          <Card title={<>{Icon.sparkle}Summary & designer brief</>} action={summarySource && <span className="sub">{summarySource}</span>}>
            {summary ? <p className="prose">{summary}</p> : <p className="muted">Summary is generated a minute or two after the call ends.</p>}
            <div className="label">Designer brief</div>
            {lead.designer_brief ? <pre className="brief">{lead.designer_brief}</pre> : <p className="muted">Not generated yet.</p>}
          </Card>

          <Card title={<>{Icon.phone}Conversation</>} action={call && <span className="sub">{call.duration_sec ? `${Math.round(call.duration_sec / 60 * 10) / 10} min` : ""}</span>}>
            {call ? <Transcript text={call.transcript} /> : <p className="muted">The call record arrives from Vaani shortly after the call ends.</p>}
            {call?.recording_url && <p style={{ marginTop: 12 }}><a className="btn" href={call.recording_url} target="_blank" rel="noreferrer">{Icon.play}Play recording</a></p>}
          </Card>

          {call && (
            <Card title="Call & sync" action={
              <form method="post" action={`/api/leads/${id}`}><input type="hidden" name="action" value="reprocess" /><button className="secondary" type="submit">Retry failed steps</button></form>
            }>
              <div className="stats">
                <div className="stat"><div className="k">Started</div><div className="v">{ist(call.started_at)}</div></div>
                <div className="stat"><div className="k">Duration</div><div className="v">{call.duration_sec ? `${Math.round(call.duration_sec)} s` : "—"}</div></div>
                <div className="stat"><div className="k">Cost</div><div className="v">{inr(call.cost_total_inr)}</div></div>
                <div className="stat"><div className="k">Matched by</div><div className="v">{humanize(call.link_method)}</div></div>
              </div>
              <div className="label">Cost breakdown</div>
              <p className="sub" style={{ margin: 0 }}>Vaani {inr(call.cost_vaani_inr)} · Telephony {inr(call.cost_telephony_inr)} · Gemini {inr(call.cost_gemini_inr)}{!call.cost_complete && " · some rates not set"}</p>
              <div className="label">Pipeline</div>
              <div className="steps">
                {["vaani_fetch", "link_lead", "gemini", "telegram", "hubspot"].map((s) => {
                  const st = sync.find((x) => x.step === s);
                  return <span key={s} className={`step ${st?.status ?? ""}`} title={st?.error ?? ""}>{st?.status === "done" ? Icon.check : st?.status === "error" ? Icon.x : Icon.dot}{STEP_LABEL[s]}{st?.status === "skipped" ? " (not needed)" : ""}</span>;
                })}
              </div>
              {call.processing_status === "processing" && <p className="sub" style={{ marginTop: 10 }}>Processing… refresh in a minute.</p>}
              {call.last_error && <p className="error">{call.last_error}</p>}
            </Card>
          )}

          <Card className="flat">
            <details>
              <summary>Tool calls during the call ({events.length})</summary>
              {events.map((e, n) => (
                <div key={n} style={{ marginTop: 12 }}>
                  <div className="pills"><b>{e.tool}</b><span className="sub">{ist(e.created_at)}</span>{e.response?.result && <span className="pill pill-muted">{humanize(e.response.result)}</span>}</div>
                  {e.error && <p className="error">{e.error}</p>}
                  <pre className="code">{JSON.stringify({ request: e.request, response: e.response }, null, 2)}</pre>
                </div>
              ))}
            </details>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
