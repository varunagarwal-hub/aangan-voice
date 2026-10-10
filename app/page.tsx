import { requireLogin } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { Avatar, BookedPill, Icon, Kpi, OutcomePill, Priority, Shell, humanize, inr, ist, istDay, istTime } from "./ui";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number | null> = { "7": 7, "30": 30, "90": 90, all: null };
const OUTCOMES = ["qualified", "not_qualified", "needs_clarification", "escalation", "incomplete", "no_conversation"];
const AVATAR_TONE: Record<string, string> = { qualified: "good", escalation: "bad", needs_clarification: "warn", incomplete: "warn", not_qualified: "muted", no_conversation: "muted" };

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

  const counts = Object.fromEntries(
    (await q(`SELECT outcome, count(*)::int AS n FROM leads WHERE created_at >= $1 GROUP BY outcome`, [since])).map((r) => [r.outcome, r.n]),
  );

  const leads = await q(`
    SELECT l.*, b.slot_start, c.after_hours, c.cost_total_inr, c.processing_status
    FROM leads l
    LEFT JOIN bookings b ON b.lead_id=l.id AND b.status='confirmed'
    LEFT JOIN LATERAL (SELECT * FROM calls WHERE lead_id=l.id ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE l.created_at >= $1 AND ($2::text IS NULL OR l.outcome=$2)
      AND ($3::boolean IS NOT TRUE OR jsonb_array_length(l.human_review) + jsonb_array_length(l.ai_flags) > 0 OR l.needs_callback)
    ORDER BY l.created_at DESC LIMIT 300`, [since, outcome, sp.review === "1"]);

  const upcoming = await q(`
    SELECT l.id, l.name, l.ref, b.slot_start FROM bookings b JOIN leads l ON l.id=b.lead_id
    WHERE b.status='confirmed' AND b.slot_start >= now() ORDER BY b.slot_start LIMIT 4`);

  const perLead = k.leads ? k.cost / k.leads : null;
  const perQualified = k.qualified ? k.cost / k.qualified : null;
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ days: daysKey, outcome: outcome ?? undefined, review: sp.review, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/?${p}`;
  };
  const rangeLabel = daysKey === "all" ? "all time" : `the last ${daysKey} days`;

  return (
    <Shell active="leads">
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p>Phone enquiries handled by the AI assistant over {rangeLabel}.</p>
        </div>
        <nav className="segmented">
          {Object.keys(RANGES).map((r) => (
            <a key={r} href={link({ days: r })} className={r === daysKey ? "on" : ""}>{r === "all" ? "All time" : `${r} days`}</a>
          ))}
        </nav>
      </div>

      <div className="kpis">
        <Kpi icon={Icon.phone} label="Calls" value={k.calls} sub={`${k.leads} leads logged`} />
        <Kpi icon={Icon.moon} tone="info" label="After-hours calls" value={k.after_hours}
          sub={k.calls ? `${Math.round((k.after_hours / k.calls) * 100)}% outside 10–7, Mon–Fri` : "outside 10–7, Mon–Fri"} />
        <Kpi icon={Icon.check} tone="good" label="Qualified leads" value={k.qualified}
          sub={k.leads ? `${Math.round((k.qualified / k.leads) * 100)}% of leads` : "—"} />
        <Kpi icon={Icon.calendar} tone="sage" label="Consultations booked" value={k.bookings}
          sub={k.qualified ? `${Math.round((k.bookings / k.qualified) * 100)}% of qualified` : "—"} />
        <Kpi icon={Icon.rupee} tone="warn" label="Cost per lead" value={k.cost_known ? inr(perLead) : "—"}
          sub={k.cost_known ? `${inr(k.cost)} total · ${inr(perQualified)} per qualified` : k.cost_incomplete ? "Some cost rates not set" : "No calls yet"} />
        <Kpi icon={Icon.alert} tone={k.callbacks || k.errors ? "bad" : "muted"} label="Needs callback" value={k.callbacks}
          sub={k.errors ? `${k.errors} call(s) with a failed sync` : "All syncs healthy"} />
      </div>

      {upcoming.length > 0 && (
        <section className="card" style={{ marginBottom: 22 }}>
          <header className="card-head"><h2>{Icon.calendar}Upcoming consultations</h2></header>
          <div className="stats">
            {upcoming.map((u) => (
              <a key={u.id} href={`/leads/${u.id}`} className="stat">
                <div className="k">{istDay(u.slot_start)} · {istTime(u.slot_start)}</div>
                <div className="v">{u.name ?? u.ref}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="chips">
        <a href={link({ outcome: undefined })} className={`chip ${!outcome ? "on" : ""}`}>All <span className="count">{k.leads}</span></a>
        {OUTCOMES.filter((o) => counts[o] || o === outcome).map((o) => (
          <a key={o} href={link({ outcome: o })} className={`chip ${o === outcome ? "on" : ""}`}>{humanize(o)} <span className="count">{counts[o] ?? 0}</span></a>
        ))}
        <a href={link({ review: sp.review === "1" ? undefined : "1" })} className={`chip ${sp.review === "1" ? "on" : ""}`}>{Icon.alert}Needs review</a>
      </div>

      <section className="card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lead</th><th>Outcome</th><th>Project</th><th className="hide-sm">Consultation</th><th>Priority</th><th className="hide-sm">Received</th><th className="hide-sm">Cost</th></tr>
            </thead>
            <tbody>
              {leads.length === 0 && (
                <tr><td colSpan={7}><div className="empty">{Icon.users}<div>No leads in this view yet.</div></div></td></tr>
              )}
              {leads.map((l) => {
                const i = l.raw_input ?? {};
                const flags = (l.human_review?.length ?? 0) + (l.ai_flags?.length ?? 0);
                return (
                  <tr key={l.id}>
                    <td>
                      <a href={`/leads/${l.id}`} className="row-link">
                        <Avatar name={l.name ?? l.caller_phone} tone={AVATAR_TONE[l.outcome] ?? "accent"} />
                        <span>
                          <b>{l.name ?? l.caller_phone ?? "Unknown caller"}</b>
                          <div className="sub">{l.ref}{l.after_hours ? " · after hours" : ""}</div>
                        </span>
                      </a>
                    </td>
                    <td>
                      <div className="pills"><OutcomePill outcome={l.outcome} />{l.slot_start && <BookedPill />}</div>
                      {flags > 0 && <div className="flag">{Icon.alert}{flags} to review</div>}
                      {l.processing_status === "error" && <div className="flag" style={{ color: "var(--bad)" }}>{Icon.alert}sync failed</div>}
                    </td>
                    <td>
                      <div>{[humanize(i.property_type), i.location].filter(Boolean).join(" · ") || "—"}</div>
                      {i.carpet_area_sqft ? <div className="sub">{Number(i.carpet_area_sqft).toLocaleString("en-IN")} sq ft</div> : null}
                    </td>
                    <td className="hide-sm">{l.slot_start ? <><div>{istDay(l.slot_start)}</div><div className="sub">{istTime(l.slot_start)}</div></> : <span className="muted">—</span>}</td>
                    <td><Priority score={l.priority_score} /></td>
                    <td className="hide-sm"><span className="sub">{ist(l.created_at)}</span></td>
                    <td className="hide-sm">{inr(l.cost_total_inr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}
