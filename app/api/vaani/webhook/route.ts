import { after, NextResponse } from "next/server";
import { webhookAuthorized } from "@/lib/auth";
import { processCall, recordWebhook } from "@/lib/postcall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Gemini can take a minute or more; processing runs after the 2xx is sent.
export const maxDuration = 300;

/** Vaani → Settings → Webhooks. We store the event fast (Vaani wants a 2xx within 5 s) and process after responding. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!webhookAuthorized(req, raw)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const callId = await recordWebhook(payload);
  if (callId) after(() => processCall(callId).catch((err) => console.error("[webhook] processCall", err)));
  return NextResponse.json({ ok: true, queued: !!callId });
}
