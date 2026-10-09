import { env } from "@/lib/env";

export function Header() {
  return (
    <header className="top">
      <span className="brand">Aangan Studio</span>
      <nav>
        <a href="/">Leads</a>
        {env.mock && <a href="/simulator">Simulator (mock)</a>}
      </nav>
      {env.mock && <span className="badge b-needs_clarification">MOCK MODE</span>}
      <form method="post" action="/api/auth/logout"><button className="secondary" type="submit">Sign out</button></form>
    </header>
  );
}

export function OutcomeBadge({ outcome, booked }: { outcome?: string | null; booked?: boolean }) {
  const label = (outcome ?? "unknown").replace("_", " ");
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`badge b-${outcome}`}>{label}</span>
      {booked && <span className="badge b-booked">booked</span>}
    </span>
  );
}

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const ist = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
