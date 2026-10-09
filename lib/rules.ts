/**
 * Qualification + internal price estimate. Plain code, no AI.
 * Source of truth: knowledge/qualified.md, knowledge/services.md, knowledge/pricing.md
 * (constants live in lib/knowledge.ts).
 */
import { z } from "zod";
import {
  BUDGET_FAIL_RATIO, COMMERCIAL_MAX_SQFT, GENERIC_DECLINE, MIN_LEAD_TIME_WEEKS, OUTSIDE_SERVICE_AREA,
  OUT_OF_SCOPE_SPACES, PRICING, PRICING_ANSWER, SERVICE_AREA_LOCALITIES, TIGHT_TIMELINE_WEEKS, TIMELINE_QUESTION,
} from "./knowledge";

const yesNoUnknown = z.enum(["yes", "no", "unknown"]);

/** What Vaani sends to check_lead. Everything except call_id is optional: Vaani sends what it has. */
export const LeadInput = z.object({
  call_id: z.string().min(1),
  caller_phone: z.string().optional(),
  name: z.string().optional(),
  enquiry_type: z.enum(["new_project", "existing_client"]).default("new_project"),
  project_category: z.enum(["residential", "commercial", "unknown"]).default("unknown"),
  property_type: z.string().optional(), // apartment, villa, independent house, office, clinic, studio, restaurant, gym...
  scope: z.enum(["full_home", "partial_home", "single_room", "office_fitout", "unknown"]).default("unknown"),
  room_count: z.coerce.number().int().positive().optional(),
  location: z.string().optional(),
  location_confirmed_pune_pcmc: yesNoUnknown.default("unknown"),
  carpet_area_sqft: z.coerce.number().positive().optional(),
  service_wanted: z
    .enum(["design_and_execution", "advice_only", "furniture_sourcing_only", "vastu_only", "unknown"])
    .default("unknown"),
  structural_changes_required: yesNoUnknown.default("unknown"),
  is_rented: yesNoUnknown.default("unknown"),
  budget_volunteered: z.boolean().default(false),
  budget_min_inr: z.coerce.number().nonnegative().optional(),
  budget_max_inr: z.coerce.number().nonnegative().optional(),
  timeline_text: z.string().optional(),
  needed_by_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weeks_until_needed: z.coerce.number().nonnegative().optional(),
  no_fixed_deadline: z.boolean().default(false),
  decision_maker: z.enum(["yes", "authorised_on_behalf", "no", "unknown"]).default("unknown"),
  requirements: z.string().optional(),
  email: z.string().email().optional(),
  asked_about_price: z.boolean().default(false),
});
export type LeadInput = z.infer<typeof LeadInput>;

export type CriterionKey = "real_project" | "service_area" | "timeline" | "budget" | "decision_maker";
export type CriterionStatus = "pass" | "fail" | "unclear";
export interface CriterionResult { status: CriterionStatus; reason: string; }

export type Outcome = "qualified" | "not_qualified" | "needs_clarification" | "escalation";

export interface PriceBand { label: string; min: number; max: number | null; }
export interface PriceEstimate { basis: string; bands: PriceBand[]; note: string; }

export interface RuleResult {
  outcome: Outcome;
  criteria: Record<CriterionKey, CriterionResult>;
  /** Exact sentence Vaani should say next. Never contains a price. */
  say: string;
  /** The single direct question to ask, when outcome is needs_clarification. */
  clarify_criterion?: CriterionKey;
  /** Notes for the designer (uncertainty on 4/5, tight timeline, etc.). */
  handoff_notes: string[];
  human_review: string[];
  /** INTERNAL ONLY. Goes to brief / Telegram / HubSpot, never to Vaani. */
  internal_estimate: PriceEstimate | null;
}

const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function weeksUntil(dateIso: string, today: Date): number {
  const ms = new Date(dateIso + "T00:00:00+05:30").getTime() - today.getTime();
  return ms / (7 * 24 * 3600 * 1000);
}

function checkRealProject(i: LeadInput): CriterionResult {
  const space = norm(i.property_type);
  const outOfScope = OUT_OF_SCOPE_SPACES.find((s) => space.includes(s));
  if (outOfScope) return { status: "fail", reason: `out_of_scope_space:${outOfScope}` };
  if (i.service_wanted === "advice_only") return { status: "fail", reason: "advice_only" };
  if (i.service_wanted === "furniture_sourcing_only") return { status: "fail", reason: "furniture_sourcing_only" };
  if (i.service_wanted === "vastu_only") return { status: "fail", reason: "vastu_only" };
  if (i.structural_changes_required === "yes") return { status: "fail", reason: "structural_work" };
  if (i.service_wanted === "unknown") return { status: "unclear", reason: "design_and_execution_not_confirmed" };
  return { status: "pass", reason: "design_and_execution" };
}

function checkServiceArea(i: LeadInput): CriterionResult {
  const loc = norm(i.location);
  const outside = OUTSIDE_SERVICE_AREA.find((p) => loc.includes(p));
  if (outside) return { status: "fail", reason: `outside_area:${outside}` };
  if (i.location_confirmed_pune_pcmc === "no") return { status: "fail", reason: "outside_area:caller_confirmed" };
  if (loc && SERVICE_AREA_LOCALITIES.some((p) => loc.includes(p))) return { status: "pass", reason: "listed_locality" };
  if (i.location_confirmed_pune_pcmc === "yes") return { status: "pass", reason: "caller_confirmed_pune_pcmc_unlisted_locality" };
  return { status: "unclear", reason: loc ? "locality_not_in_list" : "location_missing" };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

/**
 * Deterministic reading of what the caller said about timing, used only when Vaani didn't send
 * needed_by_date / weeks_until_needed. "by March" -> end of next March; "in 3 weeks" -> 3;
 * "no rush" -> no fixed deadline. Anything else stays unknown (and the timeline question is asked).
 */
export function parseTimelineText(text: string | undefined, today: Date): { weeks?: number; noDeadline?: boolean } {
  const t = (text ?? "").toLowerCase();
  if (!t) return {};
  const rel = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(week|wk|month)s?\b/);
  if (rel) {
    const n = /\d/.test(rel[1]) ? Number(rel[1]) : WORD_NUM[rel[1]];
    return { weeks: rel[2].startsWith("month") ? n * 4.345 : n };
  }
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:\s+(\d{4}))?/);
  if (m) {
    const month = MONTHS.indexOf(m[1]);
    const nowIst = new Date(today.getTime() + 5.5 * 3600000);
    let year = m[2] ? Number(m[2]) : nowIst.getUTCFullYear();
    if (!m[2] && month < nowIst.getUTCMonth()) year += 1;
    const end = new Date(Date.UTC(year, month + 1, 0)); // last day of that month
    return { weeks: weeksUntil(end.toISOString().slice(0, 10), today) };
  }
  if (/no rush|no deadline|flexible|whenever|no hurry|not in a rush|no specific deadline/.test(t)) return { noDeadline: true };
  return {};
}

function checkTimeline(i: LeadInput, today: Date): CriterionResult & { weeks?: number } {
  let weeks = i.weeks_until_needed;
  if (i.needed_by_date) weeks = weeksUntil(i.needed_by_date, today);
  let noDeadline = i.no_fixed_deadline;
  if (weeks === undefined && !noDeadline) {
    const parsed = parseTimelineText(i.timeline_text, today);
    weeks = parsed.weeks;
    noDeadline = !!parsed.noDeadline;
  }
  if (weeks === undefined) {
    if (noDeadline) return { status: "pass", reason: "no_fixed_deadline" };
    return { status: "unclear", reason: "completion_date_unknown" };
  }
  if (weeks < MIN_LEAD_TIME_WEEKS) return { status: "fail", reason: `needed_in_${weeks.toFixed(1)}_weeks`, weeks };
  return { status: "pass", reason: `needed_in_${weeks.toFixed(1)}_weeks`, weeks };
}

/** Lowest pricing.md figure for the described scope, or null when we can't tell. */
export function lowestPlausibleCost(i: LeadInput): number | null {
  const roomOnly = (i.scope === "single_room" || i.scope === "partial_home") && i.room_count;
  if (roomOnly) return PRICING.singleRoom.min * (i.room_count as number);
  if (!i.carpet_area_sqft) return null;
  if (i.project_category === "commercial") return i.carpet_area_sqft * PRICING.commercial.basic.min;
  if (i.project_category === "residential") return i.carpet_area_sqft * PRICING.residential.standard.min;
  return null;
}

function checkBudget(i: LeadInput): CriterionResult {
  // qualified.md: "Don't quote. Don't probe." Only a volunteered number is checked.
  const budget = i.budget_max_inr ?? i.budget_min_inr;
  if (!i.budget_volunteered || budget === undefined) return { status: "pass", reason: "not_mentioned" };
  const floor = lowestPlausibleCost(i);
  if (floor === null) return { status: "unclear", reason: "budget_given_scope_unclear" };
  if (budget < floor * BUDGET_FAIL_RATIO) return { status: "fail", reason: "budget_clearly_below_scope" };
  if (budget < floor) return { status: "pass", reason: "budget_below_lowest_tier_note" };
  return { status: "pass", reason: "budget_ok" };
}

function checkDecisionMaker(i: LeadInput): CriterionResult {
  if (i.decision_maker === "yes") return { status: "pass", reason: "decision_maker" };
  if (i.decision_maker === "authorised_on_behalf") return { status: "pass", reason: "authorised_representative" };
  if (i.decision_maker === "no") return { status: "fail", reason: "research_only_not_authorised" };
  return { status: "unclear", reason: "not_confirmed" };
}

export function internalEstimate(i: LeadInput): PriceEstimate | null {
  const sqft = i.carpet_area_sqft;
  if (i.scope === "single_room") {
    return {
      basis: "Single room redesign (all-in), pricing.md",
      bands: [{ label: "Single room", min: PRICING.singleRoom.min, max: PRICING.singleRoom.max }],
      note: "Indicative only — varies by site. Never quote to the client.",
    };
  }
  if (!sqft) return null;
  const mk = (label: string, r: { min: number; max: number | null }): PriceBand => ({
    label, min: r.min * sqft, max: r.max === null ? null : r.max * sqft,
  });
  if (i.project_category === "commercial") {
    const c = PRICING.commercial;
    return {
      basis: `${sqft} sq ft × commercial rates, pricing.md`,
      bands: [mk("Basic fitout", c.basic), mk("Mid-range office", c.mid), mk("Premium office", c.premium)],
      note: "Indicative only — varies by site. Never quote to the client.",
    };
  }
  if (i.project_category === "residential") {
    const r = PRICING.residential;
    const partial = i.scope === "partial_home" ? " (sq ft is the whole home; designed area may be smaller)" : "";
    return {
      basis: `${sqft} sq ft carpet × residential rates, pricing.md${partial}`,
      bands: [mk("Standard", r.standard), mk("Premium", r.premium), mk("Luxury", r.luxury)],
      note: "Indicative only — varies by site. Never quote to the client.",
    };
  }
  return null;
}

// Sentences Vaani says. Wording follows the front-desk transcripts and knowledge files.
const SAY = {
  qualified: (name?: string) =>
    `Thank you${name ? `, ${name}` : ""} — this sounds like a good fit for Aangan Studio. The next step is a free consultation with one of our designers. Shall I check the available slots for you?`,
  escalation:
    "I'm sorry to hear that. I've flagged this to the Aangan team as urgent, and someone senior will call you back as soon as possible.",
  clarify: {
    real_project:
      "Just to check — are you looking for design along with full execution, or only advice and ideas?",
    service_area: "Is the site within Pune city or PCMC?",
    timeline: TIMELINE_QUESTION,
  } as Record<string, string>,
  decline: {
    outside_area:
      "Thank you for calling. We only work in Pune and PCMC at the moment — we don't have the vendor network to take on projects outside Pune. I'm sorry we can't help this time.",
    out_of_scope_space:
      "Thank you for thinking of us. That kind of space is outside our current scope — we focus on residential homes and offices, clinics and studios. A studio that specialises in it would serve you better.",
    advice_only:
      "We're a full-service studio — our projects include design and execution together, so we don't do advice-only visits. If you decide to go ahead with a full redesign with execution, we'd love to hear from you.",
    furniture_sourcing_only:
      "We only source furniture as part of a full design project, so we wouldn't be the right fit for sourcing on its own. If you plan a redesign with execution later, we'd love to hear from you.",
    vastu_only:
      "We include Vastu requirements within our design projects, but we don't offer Vastu consultation on its own. If you plan a redesign with execution, we'd be happy to help.",
    structural_work:
      "We're interior designers rather than architects, so we don't move walls or do structural work. If you'd like an interior redesign without structural changes, we'd be happy to help.",
    timeline:
      "I want to be honest with you — our design phase alone takes three to four weeks, and execution follows, so we couldn't do justice to the project in that time. If your timeline changes, please do call us back.",
    budget:
      "I appreciate you sharing that. For that scope with full execution — materials, furniture and contractor work — that budget would be significantly below what it would cost with us, and I wouldn't want to bring you to a consultation if the numbers don't align.",
    research_only:
      "Thank you for calling. Our designers like to understand the brief directly from the person who will decide on the project, so please do ask them to call us, or call back once they've asked you to go ahead.",
    generic: GENERIC_DECLINE,
  },
};

const CLARIFY_ORDER: CriterionKey[] = ["real_project", "service_area", "timeline"];

/**
 * @param alreadyAsked criteria we already asked one clarifying question about on this call.
 *   qualified.md says ask ONE direct question; if still unclear after that, we forward with a flag.
 */
export function evaluateLead(input: LeadInput, opts: { today?: Date; alreadyAsked?: CriterionKey[] } = {}): RuleResult {
  const today = opts.today ?? new Date();
  const alreadyAsked = opts.alreadyAsked ?? [];
  const criteria: Record<CriterionKey, CriterionResult> = {
    real_project: checkRealProject(input),
    service_area: checkServiceArea(input),
    timeline: checkTimeline(input, today),
    budget: checkBudget(input),
    decision_maker: checkDecisionMaker(input),
  };
  const handoff_notes: string[] = [];
  const human_review: string[] = [];
  const estimate = internalEstimate(input);

  if (input.enquiry_type === "existing_client") {
    return {
      outcome: "escalation", criteria, say: SAY.escalation, handoff_notes: ["Existing client — not a new enquiry."],
      human_review: ["Existing client contacting the studio — senior callback needed."], internal_estimate: null,
    };
  }

  // Notes that never change the outcome.
  if (criteria.budget.status === "unclear") handoff_notes.push("Budget volunteered but scope too unclear to compare — designer to check fit.");
  if (criteria.budget.reason === "budget_below_lowest_tier_note")
    handoff_notes.push("Volunteered budget is below the lowest pricing.md tier for this scope (not clearly misaligned) — designer to discuss.");
  if (criteria.decision_maker.status === "unclear") handoff_notes.push("Decision-maker not confirmed on the call.");
  if (criteria.decision_maker.reason === "authorised_representative") handoff_notes.push("Caller is calling on behalf of the decision-maker (says they are authorised).");
  const weeks = (criteria.timeline as { weeks?: number }).weeks;
  if (weeks !== undefined && weeks < TIGHT_TIMELINE_WEEKS && criteria.timeline.status === "pass")
    handoff_notes.push(`Tight timeline: needed in about ${Math.round(weeks)} weeks (qualified.md expects 8–10 weeks from consultation).`);
  if (criteria.service_area.reason === "caller_confirmed_pune_pcmc_unlisted_locality") {
    handoff_notes.push(`Locality "${input.location}" is not in the services.md list; caller says it is in Pune/PCMC.`);
    human_review.push("Confirm locality is within service area.");
  }
  if (input.project_category === "commercial" && (input.carpet_area_sqft ?? 0) > COMMERCIAL_MAX_SQFT)
    human_review.push(`Commercial project of ${input.carpet_area_sqft} sq ft is above the ~${COMMERCIAL_MAX_SQFT} sq ft guideline in services.md.`);
  if (input.is_rented === "yes") handoff_notes.push("Rented property — no structural changes.");

  const failed = (Object.keys(criteria) as CriterionKey[]).filter((k) => criteria[k].status === "fail");
  if (failed.length > 0) {
    // qualified.md: fail one -> close gracefully; two or more -> the generic decline.
    let say = SAY.decline.generic;
    if (failed.length === 1) {
      const c = failed[0];
      const reason = criteria[c].reason;
      if (c === "service_area") say = SAY.decline.outside_area;
      else if (c === "timeline") say = SAY.decline.timeline;
      else if (c === "budget") say = SAY.decline.budget;
      else if (c === "decision_maker") say = SAY.decline.research_only;
      else if (reason.startsWith("out_of_scope_space")) say = SAY.decline.out_of_scope_space;
      else say = (SAY.decline as Record<string, string>)[reason] ?? SAY.decline.generic;
    }
    return { outcome: "not_qualified", criteria, say, handoff_notes, human_review, internal_estimate: estimate };
  }

  // qualified.md: unclear on 1, 2 or 3 -> ask one direct question (once per criterion).
  const toAsk = CLARIFY_ORDER.find((k) => criteria[k].status === "unclear" && !alreadyAsked.includes(k));
  if (toAsk) {
    return {
      outcome: "needs_clarification", criteria, clarify_criterion: toAsk, say: SAY.clarify[toAsk],
      handoff_notes, human_review, internal_estimate: estimate,
    };
  }
  for (const k of CLARIFY_ORDER) {
    if (criteria[k].status === "unclear") {
      handoff_notes.push(`Still unclear after one question: ${k.replace("_", " ")} (${criteria[k].reason}).`);
      human_review.push(`Unclear ${k.replace("_", " ")} — designer to confirm before consultation.`);
    }
  }

  let say = SAY.qualified(input.name);
  if (input.asked_about_price) say = `${PRICING_ANSWER} ${say}`;
  return { outcome: "qualified", criteria, say, handoff_notes, human_review, internal_estimate: estimate };
}

export const FALLBACK_SAY =
  "I'm sorry, I'm having a little trouble with our system right now. I've noted your details, and one of our designers will call you back.";
export { PRICING_ANSWER };

/** Guard: no caller-facing sentence may contain a price. */
export function containsPrice(text: string): boolean {
  return /₹|\brs\.?\s*\d|\d[\d,.]*\s*(lakh|lac|crore|k\b|per sq)|\binr\b/i.test(text);
}

export function formatINR(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function formatEstimate(e: PriceEstimate | null): string {
  if (!e) return "Not enough info (no sq ft / scope)";
  const bands = e.bands.map((b) => `${b.label}: ${formatINR(b.min)}${b.max === null ? "+" : ` – ${formatINR(b.max)}`}`);
  return `${bands.join(" · ")} (${e.basis}). ${e.note}`;
}
