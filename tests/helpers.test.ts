import { describe, expect, it } from "vitest";
import { cleanParams, normPhone, pickThree } from "@/lib/tools";
import { sanitize } from "@/lib/integrations/gemini";
import { isAfterHours } from "@/lib/postcall";

describe("tool input cleaning", () => {
  it("drops LLM placeholders and coerces booleans", () => {
    expect(cleanParams({ a: "", b: "null", c: "N/A", d: "true", e: "Baner", f: 5 })).toEqual({ d: true, e: "Baner", f: 5 });
  });
  it("normalises free-text enum and yes/no values (Vaani form has no dropdowns)", () => {
    expect(cleanParams({ project_category: "Residential", scope: "Full Home", decision_maker: "Authorised-On-Behalf", confirmed: "Yes", budget_volunteered: "no", location: "Koregaon Park" }))
      .toEqual({ project_category: "residential", scope: "full_home", decision_maker: "authorised_on_behalf", confirmed: true, budget_volunteered: false, location: "Koregaon Park" });
  });
  it("normalises Indian phone numbers", () => {
    expect(normPhone("98230 12345")).toBe("+919823012345");
    expect(normPhone("+91 98230-12345")).toBe("+919823012345");
    expect(normPhone("09823012345")).toBe("+919823012345");
    expect(normPhone("123")).toBeUndefined();
  });
});

describe("slot picking", () => {
  it("prefers one slot per day, max 3", () => {
    const s = (iso: string) => ({ start: iso });
    const out = pickThree([s("2026-10-09T05:30:00Z"), s("2026-10-09T09:30:00Z"), s("2026-10-10T05:00:00Z"), s("2026-10-12T05:30:00Z"), s("2026-10-13T05:30:00Z")]);
    expect(out.map((x) => x.start)).toEqual(["2026-10-09T05:30:00Z", "2026-10-10T05:00:00Z", "2026-10-12T05:30:00Z"]);
  });
});

describe("Gemini output guard", () => {
  it("removes any line with a price and flags it", () => {
    const o = sanitize({ summary: "Nice 3BHK.\nShould cost about ₹25 lakh.", designer_brief: "Client: A", priority_score: 9, priority_reason: "x", human_review_flags: [] });
    expect(o.summary).toBe("Nice 3BHK.");
    expect(o.priority_score).toBe(5);
    expect(o.human_review_flags[0]).toMatch(/price/);
  });
});

describe("after-hours (Mon–Fri 10:00–19:00 IST)", () => {
  it("classifies times in IST", () => {
    expect(isAfterHours(new Date("2026-10-08T05:00:00Z"))).toBe(false); // Thu 10:30 IST
    expect(isAfterHours(new Date("2026-10-08T17:17:00Z"))).toBe(true);  // Thu 22:47 IST
    expect(isAfterHours(new Date("2026-10-10T06:00:00Z"))).toBe(true);  // Sat
  });
});
