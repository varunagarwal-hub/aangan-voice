import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth";
import { q } from "@/lib/db";
import { processCall, registerCall } from "@/lib/postcall";
import { listCallHistory } from "@/lib/integrations/vaani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Safety net (Vercel Cron): picks up calls whose webhook never arrived (via Vaani call-history)
 * and retries calls whose post-call processing failed. Safe to run any number of times.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const discovered: string[] = [];
  try {
    const hist = await listCallHistory(1, 100);
    for (const c of hist.data) {
      const end = c.End_time ? Date.parse(c.End_time) : NaN;
      if (!c.call_id || Number.isNaN(end) || Date.now() - end < 10 * 60_000) continue; // give the webhook 10 min first
      if (c.direction && c.direction !== "inbound") continue;
      const exists = await q(`SELECT 1 FROM calls WHERE vaani_call_id=$1`, [c.call_id]);
      if (!exists.length) { await registerCall(c.call_id); discovered.push(c.call_id); }
    }
  } catch (err) {
    console.error("[cron] call-history reconcile failed", err);
  }
  const due = await q(`SELECT vaani_call_id FROM calls WHERE (processing_status IN ('pending','error') OR
      (processing_status='processing' AND locked_at < now() - interval '5 minutes')) AND attempts < 6 ORDER BY created_at LIMIT 20`);
  const results: Record<string, unknown> = {};
  for (const r of due) results[r.vaani_call_id] = await processCall(r.vaani_call_id).catch((e) => String(e));
  return NextResponse.json({ discovered, processed: results });
}
