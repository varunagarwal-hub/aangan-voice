import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { PHONE_FIXTURES, runFixture } from "@/lib/simulate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Mock mode only. ?id=T01 runs one transcript; ?id=all runs all. ?format=json returns the log. */
export async function POST(req: Request) {
  if (!env.mock) return NextResponse.json({ error: "simulator only runs with MOCK_MODE=true" }, { status: 403 });
  if (!(await isLoggedIn()) && req.headers.get("x-sim") !== "cli") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "all";
  const origin = url.origin;
  const list = id === "all" ? PHONE_FIXTURES : PHONE_FIXTURES.filter((f) => f.id === id);
  const results = [];
  for (const f of list) results.push(await runFixture(f, origin));
  if (url.searchParams.get("format") === "json" || list.length !== 1 || !results[0]?.leadId)
    return NextResponse.json({ results });
  return NextResponse.redirect(new URL(`/leads/${results[0].leadId}`, req.url), 303);
}
