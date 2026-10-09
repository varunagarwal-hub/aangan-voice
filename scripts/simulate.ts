// Runs the mock simulator against a running dev server (MOCK_MODE=true) and checks every outcome.
// Usage: npm run simulate            (all transcripts)
//        npm run simulate -- T05     (one transcript)
const base = process.env.APP_URL ?? "http://localhost:3000";
const id = process.argv[2] ?? "all";

(async () => {
  const res = await fetch(`${base}/api/sim/run?id=${id}&format=json`, { method: "POST", headers: { "x-sim": "cli" } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { results } = await res.json();
  let bad = 0;
  for (const r of results) {
    const ok = r.expected === r.actual;
    if (!ok) bad++;
    const post = r.steps.find((s: any) => s.tool === "post-call processing")?.response;
    const book = r.steps.filter((s: any) => s.tool.startsWith("book_slot")).map((s: any) => s.response.result).join(" → ");
    console.log(`${ok ? "✓" : "✗"} ${r.fixture.padEnd(4)} expected=${r.expected.padEnd(14)} actual=${String(r.actual).padEnd(14)} post-call=${post?.status}${post?.errors?.length ? ` (${post.errors})` : ""}${book ? `  booking: ${book}` : ""}`);
  }
  console.log(`\n${results.length - bad}/${results.length} matched. Dashboard: ${base}`);
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
