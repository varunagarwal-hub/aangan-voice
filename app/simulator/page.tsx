import { notFound } from "next/navigation";
import { requireLogin } from "@/lib/auth";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { PHONE_FIXTURES } from "@/tests/fixtures/transcripts";
import { Header, ist } from "../Header";

export const dynamic = "force-dynamic";

export default async function Simulator() {
  if (!env.mock) notFound();
  await requireLogin();
  const outbox = await q(`SELECT * FROM mock_outbox ORDER BY id DESC LIMIT 30`);
  return (
    <>
      <Header />
      <main>
        <h1>Call simulator</h1>
        <p className="muted">
          Plays a September phone enquiry through the real endpoints: check_lead → get_slots → book_slot (plus a retry, to prove no duplicate) →
          Vaani webhook → transcript fetch → Gemini → cost → Telegram → HubSpot. External services are faked; what they would have received is shown below.
        </p>
        <form method="post" action="/api/sim/run?id=all&format=json" style={{ marginBottom: 12 }}>
          <button type="submit">Run all {PHONE_FIXTURES.length} transcripts (shows JSON log)</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Transcript</th><th>Caller says</th><th>Expected</th><th></th></tr></thead>
            <tbody>
              {PHONE_FIXTURES.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.id}</b></td>
                  <td>{f.transcript}</td>
                  <td><span className={`badge b-${f.expected}`}>{f.expected.replace("_", " ")}</span></td>
                  <td><form method="post" action={`/api/sim/run?id=${f.id}`}><button type="submit">Run</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Mock outbox (what Telegram / HubSpot / Cal.com would have received)</h2>
        {outbox.length === 0 && <p className="muted">Empty.</p>}
        {outbox.map((m) => (
          <details className="panel" key={m.id}>
            <summary><b>{m.channel}</b> <span className="muted">{ist(m.created_at)}</span></summary>
            <pre>{m.channel === "telegram" ? m.payload.text : JSON.stringify(m.payload, null, 2)}</pre>
          </details>
        ))}
      </main>
    </>
  );
}
