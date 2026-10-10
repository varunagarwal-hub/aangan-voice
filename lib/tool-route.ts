import { NextResponse } from "next/server";
import { toolAuthorized } from "./auth";
import { FALLBACK_SAY } from "./rules";
import type { ToolResponse } from "./tools";

/** Wrap a tool handler: auth, tolerant body parsing, always 200 with a `say` line. */
export function toolRoute(handler: (body: Record<string, unknown>) => Promise<ToolResponse>) {
  return async (req: Request) => {
    if (!toolAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let body: Record<string, unknown> = {};
    try {
      const raw = await req.json();
      // Accept the params at top level or nested under a common wrapper key.
      body = (raw?.parameters ?? raw?.args ?? raw?.arguments ?? raw) as Record<string, unknown>;
      // Query-string params (e.g. ?call_id={{call_id}}) fill gaps.
      for (const [k, v] of new URL(req.url).searchParams) if (k !== "key" && body[k] === undefined) body[k] = v;
    } catch {
      return NextResponse.json({ result: "error", say: FALLBACK_SAY, next_step: "close_call_politely" });
    }
    const t0 = Date.now();
    const res = await handler(body);
    // Latency per tool call, visible in Vercel logs ("vercel logs").
    console.log(`[tool] ${new URL(req.url).pathname} result=${res.result} ${Date.now() - t0}ms`);
    return NextResponse.json(res);
  };
}
