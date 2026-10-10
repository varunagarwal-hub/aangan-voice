import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { processCall } from "@/lib/postcall";

export const runtime = "nodejs";
export const maxDuration = 300;
const STATUSES = ["new", "contacted", "consultation_booked", "needs_callback", "closed"];

/** Dashboard actions: change status, or re-run failed post-call steps. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isLoggedIn())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  if (action === "status") {
    const status = String(form.get("status"));
    if (STATUSES.includes(status))
      await q(`UPDATE leads SET status=$2, needs_callback=($2='needs_callback'), updated_at=now() WHERE id=$1`, [id, status]);
  } else if (action === "reprocess") {
    const call = await q1(`SELECT vaani_call_id FROM calls WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    if (call) {
      await q(`UPDATE calls SET processing_status='error' WHERE vaani_call_id=$1 AND processing_status='done'`, [call.vaani_call_id]);
      await processCall(call.vaani_call_id);
    }
  }
  return NextResponse.redirect(new URL(`/leads/${id}`, req.url), 303);
}
