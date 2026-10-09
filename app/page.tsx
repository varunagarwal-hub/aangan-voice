import { requireLogin } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { Header, OutcomeBadge, inr, ist } from "./Header";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number | null> = { "7": 7, "30": 30, "90": 90, all: null };
const OUTCOMES = ["qualified", "not_qualified", "needs_clarification", "escalation", "incomplete"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string; outcome?: string; review?: string }> }) {
  await requireLogin();
  const sp = await searchParams;
  const daysKey = sp.days && sp.days in RANGES ? sp.days : "30";
  const days = RANGES[daysKey];
  const since = days ? new Date(Date.now() - days * 86400000) : new Date(0);
  const outcome = sp.outcome && OUTCOMES.includes(sp.outcome) ? sp.outcome : null;

  const k = (await q1(`
    SELECT
      (SELECT count(*) FROM calls WHERE COALESCE(started_at, created_at) >= $1)::int AS calls,
      (SELECT count(*) FROM calls WHERE COALESCE(started_at, created_at) >= $1 AND after_hours)::int AS after_hours,
      (SELECT count(*) FROM leads WHERE created_at >= $1)::int AS leads,
      (SELECT count(*) FROM leads WHERE created_at >= $1 AND outcome='qualified')::int AS qualified,
      (SELECT count(*) FROM bookings b JOIN leads l ON l.id=b.lead_id WHERE l.created_at >= $1 AND b.status='confirmed')::int AS bookings,
      (SELECT count(*) FROM leads WHERE created_at >= $1 AND needs_callback)::int AS callbacks,
      (SELECT COALESCE(sum(cost_total_inr),0) FROM calls WHERE COALESCE(started_at, created_at) >= $1)::float AS cost,
      (SELECT count(*) FROM calls WHERE COALESCE(started_at, created_at) >= $1 AND NOT cost_complete)::int AS cost_incomplete,
      (SELECT count(*) FROM calls WHERE COALESCE(started_at, created_at) >= $1 AND cost_total_inr IS NOT NULL)::int AS cost_known,
      (SELECT count(*) FROM calls WHERE processing_status='error')::int AS errors
  `, [since]))!;

  const leads = await q(`
    SELECT l.*, b.slot_start, b.status AS booking_status, c.after_hours, c.cost_total_inr, c.processing_status
    FROM leads l
    LEFT JOIN bookings b ON b.lead_id=l.id AND b.status='confirmed'
    LEFT JOIN LATERAL (SELECT * FROM calls WHERE lead_id=l.id ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE l.created_at >= $1 AND ($2::text IS NULL OR l.outcome=$2)
      AND ($3::boolean IS NOT TRUE OR jsonb_array_length(l.human_review) + jsonb_array_length(l.ai_flags) > 0 OR l.needs_callback)
    ORDER BY l.created_at DESC LIMIT 300`, [since, outcome, sp.review === "1"]);

  const perLead = k.leads ? k.cost / k.leads : null;
  const perQualified = k.qualified ? k.cost / k.qualified : null;
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ days: daysKey, outcome: outcome ?? undefined, review: sp.review, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/?${p}`;
  };

  return (
    <>
      <Header />
      <main>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h1>Leads</h1>
          <div className="row">
            {Object.keys(RANGES).map((r) => (
              <a key={r} href={link({ days: r })} className={r === daysKey ? "badge b-booked" : "badge b-not_qualified"}>{r === "all" ? "All time" : `${r} days`}</a>
            ))}
          </div>
        </div>

        <div className="kpis">
          <Kpi l="Calls" v={k.calls} />
          <Kpi l="After-hours calls" v={k.after_hours} s={k.calls ? `${Math.round((k.after_hours / k.calls) * 100)}% of calls` : undefined} />
          <Kpi l="Qualified leads" v={k.qualified} s={`of ${k.leads} leads`} />
          <Kpi l="Bookings" v={k.bookings} />
          <Kpi l="Cost per lead" v={k.cost_known ? inr(perLead) : "—"} s={`per qualified: ${k.cost_known ? inr(perQualified) : "—"}`} />
          <Kpi l="Total cost" v={k.cost_known ? inr(k.cost) : "—"} s={k.cost_incomplete ? `⚠ ${k.cost_incomplete} call(s) missing a rate` : "all rates set"} />
          <Kpi l="Needs callback" v={k.callbacks} s={k.errors ? `⚠ ${k.errors} call(s) with failed sync` : undefined} />
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <a href={link({ outcome: undefined })} className="badge b-not_qualified">All</a>
          {OUTCOMES.map((o) => <a key={o} href={link({ outcome: o })} className={`badge b-${o}`}>{o.replace("_", " ")}</a>)}
          <a href={link({ review: sp.review === "1" ? undefined : "1" })} className="badge b-escalation">{sp.review === "1" ? "✓ " : ""}needs review</a>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Lead</th><th>Outcome</th><th>Project</th><th className="hide-sm">Consultation</th><th>Priority</th><th className="hide-sm">Status</th><th className="hide-sm">Cost</th></tr>
            </thead>
            <tbody>
              {leads.length === 0 && <tr><td colSpan={8} className="muted">No leads yet.</td></tr>}
              {leads.map((l) => {
                const i = l.raw_input ?? {};
                const flags = (l.human_review?.length ?? 0) + (l.ai_flags?.length ?? 0);
                return (
                  <tr key={l.id}>
                    <td>{ist(l.created_at)}{l.after_hours && <div className="muted">🌙 after hours</div>}</td>
                    <td><a href={`/leads/${l.id}`}><b>{l.name ?? l.caller_phone ?? "Unknown"}</b></a><div className="muted">{l.ref}</div></td>
                    <td><OutcomeBadge outcome={l.outcome} booked={!!l.slot_start} />{flags > 0 && <div className="warn">⚑ {flags} to review</div>}</td>
                    <td>{[i.property_type, i.location].filter(Boolean).join(", ") || "—"}{i.carpet_area_sqft ? <div className="muted">{i.carpet_area_sqft} sq ft</div> : null}</td>
                    <td className="hide-sm">{l.slot_start ? ist(l.slot_start) : "—"}</td>
                    <td>{l.priority_score ?? "—"}</td>
                    <td className="hide-sm">{l.status.replace("_", " ")}{l.processing_status === "error" && <div className="bad">sync error</div>}</td>
                    <td className="hide-sm">{inr(l.cost_total_inr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function Kpi({ l, v, s }: { l: string; v: string | number; s?: string }) {
  return <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}
