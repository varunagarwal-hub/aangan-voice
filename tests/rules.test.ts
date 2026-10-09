import { describe, expect, it } from "vitest";
import { LeadInput, evaluateLead, containsPrice, internalEstimate, PRICING_ANSWER } from "@/lib/rules";
import { PHONE_FIXTURES } from "./fixtures/transcripts";

describe("September phone transcripts", () => {
  for (const f of PHONE_FIXTURES) {
    it(`${f.id} -> ${f.expected}${f.expectedFail ? ` (${f.expectedFail})` : ""}`, () => {
      const r = evaluateLead(LeadInput.parse(f.input), { today: new Date(f.today + "T12:00:00+05:30") });
      expect(r.outcome).toBe(f.expected);
      if (f.expectedFail) expect(r.criteria[f.expectedFail as keyof typeof r.criteria].status).toBe("fail");
      // Caller-facing text never contains a price.
      expect(containsPrice(r.say)).toBe(false);
    });
  }
});

describe("pricing", () => {
  it("price question gets the exact pricing.md line, no number", () => {
    const r = evaluateLead(LeadInput.parse(PHONE_FIXTURES.find((f) => f.id === "T02")!.input), { today: new Date("2026-09-03") });
    expect(r.say.startsWith(PRICING_ANSWER)).toBe(true);
  });
  it("internal estimate is computed from pricing.md (designers only)", () => {
    const e = internalEstimate(LeadInput.parse({ call_id: "x", project_category: "residential", carpet_area_sqft: 1000, scope: "full_home" }))!;
    expect(e.bands[0]).toEqual({ label: "Standard", min: 1_800_000, max: 2_400_000 });
    expect(e.bands[2].max).toBeNull();
  });
  it("containsPrice catches currency", () => {
    expect(containsPrice("about ₹20 lakh")).toBe(true);
    expect(containsPrice("1,800 per sq ft")).toBe(true);
    expect(containsPrice("Shall I check slots for Saturday 11 October?")).toBe(false);
  });
});

describe("boundary rules (qualified.md)", () => {
  const today = new Date("2026-10-08T12:00:00+05:30");
  const base = { call_id: "b", project_category: "residential", scope: "full_home", location: "Baner",
    carpet_area_sqft: 1000, service_wanted: "design_and_execution", no_fixed_deadline: true } as const;

  it("unclear location -> asks once, then forwards with a flag", () => {
    const i = LeadInput.parse({ ...base, location: "Nanded City" });
    const first = evaluateLead(i, { today });
    expect(first.outcome).toBe("needs_clarification");
    expect(first.clarify_criterion).toBe("service_area");
    const second = evaluateLead(i, { today, alreadyAsked: ["service_area"] });
    expect(second.outcome).toBe("qualified");
    expect(second.human_review.length).toBeGreaterThan(0);
  });
  it("unknown timeline -> asks the exact qualified.md question", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, no_fixed_deadline: false }), { today });
    expect(r.say).toBe("When would you need the project complete?");
  });
  it("unclear decision-maker or budget never blocks", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, decision_maker: "unknown" }), { today });
    expect(r.outcome).toBe("qualified");
    expect(r.handoff_notes.join(" ")).toMatch(/Decision-maker not confirmed/);
  });
  it("budget below lowest tier but above 50% -> qualified with note (F10-like)", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, carpet_area_sqft: 1300, budget_volunteered: true, budget_min_inr: 1_800_000, budget_max_inr: 2_200_000 }), { today });
    expect(r.outcome).toBe("qualified");
    expect(r.handoff_notes.join(" ")).toMatch(/below the lowest/);
  });
  it("two failures -> generic qualified.md decline", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, location: "Talegaon", weeks_until_needed: 3 }), { today });
    expect(r.outcome).toBe("not_qualified");
    expect(r.say).toMatch(/may not be the right fit/);
  });
  it("6–10 weeks passes with a tight-timeline note; under 6 fails", () => {
    expect(evaluateLead(LeadInput.parse({ ...base, weeks_until_needed: 8 }), { today }).handoff_notes.join(" ")).toMatch(/Tight timeline/);
    expect(evaluateLead(LeadInput.parse({ ...base, weeks_until_needed: 5 }), { today }).outcome).toBe("not_qualified");
  });
  it("reads timeline text deterministically when no date is sent", () => {
    const tl = (timeline_text: string) => evaluateLead(LeadInput.parse({ ...base, no_fixed_deadline: false, timeline_text }), { today });
    expect(tl("We'd like it done by March").outcome).toBe("qualified");      // ~25 weeks
    expect(tl("in three weeks, before Diwali").outcome).toBe("not_qualified");
    expect(tl("No rush, flexible").outcome).toBe("qualified");
    expect(tl("by November").handoff_notes.join(" ")).toMatch(/Tight timeline/); // ~7.5 weeks from 8 Oct
    expect(tl("soon").outcome).toBe("needs_clarification");
  });
  it("commercial above 3,000 sq ft is flagged, not failed", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, project_category: "commercial", scope: "office_fitout", carpet_area_sqft: 4000 }), { today });
    expect(r.outcome).toBe("qualified");
    expect(r.human_review.join(" ")).toMatch(/3000/);
  });
  it("rented + structural changes fails", () => {
    const r = evaluateLead(LeadInput.parse({ ...base, is_rented: "yes", structural_changes_required: "yes" }), { today });
    expect(r.outcome).toBe("not_qualified");
  });
});
