/**
 * Gemini generateContent — https://ai.google.dev/api/generate-content
 * Gemini ONLY writes language: summary, designer brief, priority score, review flags.
 * It never decides qualification and never produces a price (output is checked).
 */
import { env, need } from "../env";
import { fetchJson, HttpError } from "./http";
import { containsPrice } from "../rules";

export interface BriefOutput {
  summary: string;
  designer_brief: string;
  priority_score: number;   // 1 (low) – 5 (high)
  priority_reason: string;
  human_review_flags: string[];
}
export interface GeminiUsage { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount: number; }

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2–4 sentence plain summary of the call." },
    designer_brief: { type: "string", description: "Brief for the designer, short labelled lines." },
    priority_score: { type: "integer", minimum: 1, maximum: 5 },
    priority_reason: { type: "string" },
    human_review_flags: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "designer_brief", "priority_score", "priority_reason", "human_review_flags"],
};

const SYSTEM = `You write internal notes for Aangan Studio, an interior design studio in Pune, after a phone enquiry handled by an AI assistant.
Rules you must follow:
- Use only facts present in the transcript and the structured data. If something is unknown, write "not discussed".
- Do NOT decide or comment on whether the lead qualifies. The qualification outcome is given to you and is final.
- Do NOT write any price, cost, budget estimate, rate or per-sq-ft figure. You may mention that the caller volunteered a budget only by saying "budget volunteered — see estimate section".
- designer_brief uses these labelled lines: Client, Property, Location, Scope & requirements, Timeline, Decision-maker, Style/preferences, Open questions for consultation, Tone of call.
- priority_score: 1–5 for how quickly a designer should follow up (5 = urgent / high-intent / frustrated caller). Explain in priority_reason.
- human_review_flags: anything a human should check (frustration, complaint, confusion, mismatched details, caller asked for a human, AI said something wrong). Empty array if none.`;

export async function writeBrief(input: {
  transcript: string; lead: Record<string, unknown>; outcome: string; notes: string[]; booking?: string | null;
}): Promise<{ output: BriefOutput; usage: GeminiUsage }> {
  if (env.mockFails("gemini")) throw new Error("MOCK_FAIL: gemini");
  if (env.mock) return mockBrief(input);
  const user = [
    `Qualification outcome (final, decided by studio rules): ${input.outcome}`,
    `Consultation booking: ${input.booking ?? "none"}`,
    `Rule notes: ${input.notes.join(" | ") || "none"}`,
    `Structured lead data (JSON): ${JSON.stringify(input.lead)}`,
    `Transcript:\n${input.transcript}`,
  ].join("\n\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
  const headers = { "x-goog-api-key": need(env.geminiApiKey, "GEMINI_API_KEY"), "Content-Type": "application/json" };
  const base = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
  const thinking = env.geminiModel.includes("2.5")
    ? { thinkingBudget: 0 }
    : { thinkingLevel: env.geminiThinkingLevel };

  let res: any;
  try {
    res = await fetchJson(url, {
      method: "POST", headers, timeoutMs: 150000,
      body: JSON.stringify({ ...base, generationConfig: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, thinkingConfig: thinking } }),
    });
  } catch (err) {
    // The docs show two structured-output shapes; if this one is rejected, fall back to prompt-only JSON.
    if (!(err instanceof HttpError) || err.status !== 400) throw err;
    res = await fetchJson(url, {
      method: "POST", headers, timeoutMs: 150000,
      body: JSON.stringify({
        ...base,
        contents: [{ role: "user", parts: [{ text: `${user}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(SCHEMA)}` }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
  }
  const text: string = res.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
  const usage: GeminiUsage = {
    promptTokenCount: res.usageMetadata?.promptTokenCount ?? 0,
    candidatesTokenCount: res.usageMetadata?.candidatesTokenCount ?? 0,
    thoughtsTokenCount: res.usageMetadata?.thoughtsTokenCount ?? 0,
  };
  return { output: sanitize(parsed), usage };
}

/** Enforce "Gemini never invents a price": drop any line containing a price and flag it. */
export function sanitize(o: any): BriefOutput {
  const flags: string[] = Array.isArray(o.human_review_flags) ? o.human_review_flags.map(String) : [];
  const clean = (s: unknown) => {
    const lines = String(s ?? "").split("\n");
    const kept = lines.filter((l) => !containsPrice(l));
    if (kept.length !== lines.length) flags.push("AI text contained a price; removed automatically.");
    return kept.join("\n").trim();
  };
  const score = Math.min(5, Math.max(1, Math.round(Number(o.priority_score) || 3)));
  return {
    summary: clean(o.summary), designer_brief: clean(o.designer_brief), priority_score: score,
    priority_reason: clean(o.priority_reason), human_review_flags: Array.from(new Set(flags)),
  };
}

function mockBrief(input: { transcript: string; lead: Record<string, any>; outcome: string; notes: string[]; booking?: string | null }) {
  const l = input.lead;
  const output: BriefOutput = {
    summary: `[mock] ${l.name ?? "Caller"} enquired about ${l.property_type ?? "a project"} in ${l.location ?? "unknown location"}. Outcome: ${input.outcome}.`,
    designer_brief: [
      `Client: ${l.name ?? "not discussed"}`,
      `Property: ${l.property_type ?? "not discussed"}${l.carpet_area_sqft ? `, ${l.carpet_area_sqft} sq ft carpet` : ""}`,
      `Location: ${l.location ?? "not discussed"}`,
      `Scope & requirements: ${l.requirements ?? "not discussed"}`,
      `Timeline: ${l.timeline_text ?? (l.no_fixed_deadline ? "no fixed deadline" : "not discussed")}`,
      `Decision-maker: ${l.decision_maker ?? "not discussed"}`,
      `Open questions for consultation: ${input.notes.join("; ") || "none"}`,
    ].join("\n"),
    priority_score: input.outcome === "escalation" ? 5 : input.outcome === "qualified" ? 4 : 1,
    priority_reason: "[mock] based on outcome",
    human_review_flags: /frustrat|nobody|no one|hasn't replied/i.test(input.transcript) ? ["Caller sounded frustrated."] : [],
  };
  return Promise.resolve({ output, usage: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 0 } });
}
