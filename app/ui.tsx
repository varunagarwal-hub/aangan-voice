import type { ReactNode } from "react";
import { env } from "@/lib/env";

// ---------- formatting ----------
export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const ist = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

export const istDay = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }) : "—";

export const istTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "";

export const humanize = (s?: string | null) => (s ?? "").replace(/_/g, " ");

export function initials(name?: string | null) {
  const parts = (name ?? "").replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// ---------- icons (inline, stroke = currentColor) ----------
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  phone: <svg viewBox="0 0 24 24" {...P}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>,
  moon: <svg viewBox="0 0 24 24" {...P}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  check: <svg viewBox="0 0 24 24" {...P}><path d="M20 6 9 17l-5-5" /></svg>,
  calendar: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>,
  rupee: <svg viewBox="0 0 24 24" {...P}><path d="M6 4h12M6 9h12M6 4h3a5 5 0 0 1 0 10H6l8 7" /></svg>,
  alert: <svg viewBox="0 0 24 24" {...P}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  users: <svg viewBox="0 0 24 24" {...P}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>,
  home: <svg viewBox="0 0 24 24" {...P}><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>,
  play: <svg viewBox="0 0 24 24" {...P}><path d="m6 4 14 8-14 8z" /></svg>,
  logout: <svg viewBox="0 0 24 24" {...P}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
  arrowLeft: <svg viewBox="0 0 24 24" {...P}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>,
  sparkle: <svg viewBox="0 0 24 24" {...P}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>,
  x: <svg viewBox="0 0 24 24" {...P}><path d="M18 6 6 18M6 6l12 12" /></svg>,
  dot: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor" /></svg>,
};

// ---------- layout ----------
export function Shell({ active, children }: { active: "leads" | "simulator"; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/" className="logo">
          <span className="logo-mark">A</span>
          <span className="logo-text">Aangan<small>Studio · Leads</small></span>
        </a>
        <nav className="nav">
          <a href="/" className={active === "leads" ? "active" : ""}>{Icon.users}<span>Leads</span></a>
          {env.mock && <a href="/simulator" className={active === "simulator" ? "active" : ""}>{Icon.play}<span>Simulator</span></a>}
        </nav>
        <div className="sidebar-foot">
          {env.mock && <span className="pill pill-warn">Mock mode</span>}
          <form method="post" action="/api/auth/logout">
            <button className="ghost" type="submit">{Icon.logout}<span>Sign out</span></button>
          </form>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

// ---------- pieces ----------
const OUTCOME_TONE: Record<string, string> = {
  qualified: "good", not_qualified: "muted", needs_clarification: "warn", escalation: "bad", incomplete: "warn", no_conversation: "muted",
};
export function OutcomePill({ outcome }: { outcome?: string | null }) {
  const tone = OUTCOME_TONE[outcome ?? ""] ?? "muted";
  return <span className={`pill pill-${tone}`}><i className="pill-dot" />{humanize(outcome) || "unknown"}</span>;
}
export function BookedPill() {
  return <span className="pill pill-info">{Icon.calendar}booked</span>;
}

export function Kpi({ label, value, sub, icon, tone = "accent" }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: string }) {
  return (
    <div className="kpi">
      <div className={`kpi-icon tone-${tone}`}>{icon}</div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function Priority({ score }: { score?: number | null }) {
  if (!score) return <span className="muted">—</span>;
  return (
    <span className="priority" title={`Priority ${score}/5`}>
      {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= score ? `on p${score}` : ""} />)}
    </span>
  );
}

export function Avatar({ name, tone }: { name?: string | null; tone?: string }) {
  return <span className={`avatar tone-${tone ?? "accent"}`}>{initials(name)}</span>;
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && <header className="card-head"><h2>{title}</h2>{action}</header>}
      {children}
    </section>
  );
}

/** Vaani transcript ("[HH:MM:SS] AGENT: ..." / "USER: ...") as chat bubbles. */
export function Transcript({ text }: { text?: string | null }) {
  if (!text) return <p className="muted">Transcript not available yet.</p>;
  const turns = text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(?:\[([\d:]+)\]\s*)?(AGENT|USER)\s*:\s*(.*)$/i);
    return m ? { time: m[1], who: m[2].toUpperCase(), text: m[3] } : { time: undefined, who: "NOTE", text: l };
  });
  return (
    <div className="chat">
      {turns.map((t, n) => (
        <div key={n} className={`bubble-row ${t.who === "USER" ? "from-user" : t.who === "AGENT" ? "from-agent" : "from-note"}`}>
          <div className="bubble">
            <div className="bubble-meta">{t.who === "USER" ? "Caller" : t.who === "AGENT" ? "Vaani" : ""}{t.time && <span>{t.time}</span>}</div>
            {t.text}
          </div>
        </div>
      ))}
    </div>
  );
}
