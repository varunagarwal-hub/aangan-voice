import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { PHONE_FIXTURES } from "@/tests/fixtures/transcripts";
import { Card, Icon, OutcomePill, Shell, ist } from "../ui";

export const dynamic = "force-dynamic";

export default async function Simulator() {
  if (!env.mock) notFound();
  await requireLogin();
  const outbox = await q(`SELECT * FROM mock_outbox ORDER BY id DESC LIMIT 30`);
  return (
    <Shell active="simulator">
      <div className="page-head">
        <div>
          <h1>Call simulator</h1>
          <p>Plays a September enquiry through the real endpoints. External services are faked; what they would receive appears below.</p>
        </div>
        <form method="post" action="/api/sim/run?id=all&format=json"><button type="submit" className="accent">{Icon.play}Run all {PHONE_FIXTURES.length}</button></form>
      </div>

      <section className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Transcript</th><th>Caller says</th><th>Expected</th><th></th></tr></thead>
            <tbody>
              {PHONE_FIXTURES.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.id}</b></td>
                  <td className="sub" style={{ color: "var(--ink-2)" }}>{f.transcript}</td>
                  <td><OutcomePill outcome={f.expected} /></td>
                  <td><form method="post" action={`/api/sim/run?id=${f.id}`}><button type="submit" className="secondary">{Icon.play}Run</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="label" style={{ marginTop: 26 }}>Mock outbox — what Telegram, HubSpot and Cal.com would have received</div>
      {outbox.length === 0 && <p className="muted">Empty.</p>}
      {outbox.map((m) => (
        <Card key={m.id} className="flat">
          <details>
            <summary><span className="pills"><b style={{ textTransform: "capitalize" }}>{m.channel}</b><span className="sub">{ist(m.created_at)}</span></span></summary>
            <pre className="code">{m.channel === "telegram" ? m.payload.text : JSON.stringify(m.payload, null, 2)}</pre>
          </details>
        </Card>
      ))}
    </Shell>
  );
}
