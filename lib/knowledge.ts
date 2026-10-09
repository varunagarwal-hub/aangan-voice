/**
 * Every fact in this file is copied from /knowledge. Nothing here is invented.
 * Comments cite the source file. If the knowledge files change, change this file.
 */

// services.md -> "Service area"
export const SERVICE_AREA_LOCALITIES = [
  // Pune city
  "pune", "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar",
  "hadapsar", "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan",
  // PCMC
  "pcmc", "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi",
] as const;

// services.md -> "We do not currently serve Talegaon, Lonavala, Nashik, Mumbai, or other cities"
export const OUTSIDE_SERVICE_AREA = ["talegaon", "lonavala", "nashik", "mumbai"] as const;

// services.md -> "Restaurants, hotels, retail stores, gyms: out of scope."
export const OUT_OF_SCOPE_SPACES = ["restaurant", "hotel", "retail", "gym"] as const;

// services.md -> "Commercial projects: offices, clinics, studios — up to approximately 3,000 sq ft."
export const COMMERCIAL_MAX_SQFT = 3000;

// services.md -> "Minimum lead time: ... under 6 weeks from today."
export const MIN_LEAD_TIME_WEEKS = 6;
// qualified.md -> "within 8–10 weeks of the consultation"; we flag (not fail) anything under 10 weeks.
export const TIGHT_TIMELINE_WEEKS = 10;

// pricing.md (INTERNAL ONLY — never returned to the caller)
export const PRICING = {
  residential: {
    standard: { min: 1800, max: 2400 },
    premium: { min: 2400, max: 3500 },
    luxury: { min: 3500, max: null as number | null },
  },
  singleRoom: { min: 350_000, max: 800_000 },
  commercial: {
    basic: { min: 1200, max: 1800 },
    mid: { min: 1800, max: 2800 },
    premium: { min: 2800, max: 4000 },
  },
} as const;

// Budget misalignment (qualified.md criterion 4) needs a number to be plain code.
// Agreed default: fail only when the volunteered budget is below 50% of the lowest
// pricing.md figure for the described scope.
export const BUDGET_FAIL_RATIO = 0.5;

// pricing.md -> "The only acceptable response to a pricing question"
export const PRICING_ANSWER =
  "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

// qualified.md -> "At the boundary"
export const GENERIC_DECLINE =
  "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.";

// qualified.md -> criterion 3, the exact question to ask
export const TIMELINE_QUESTION = "When would you need the project complete?";

// Office hours from the enquiry transcripts ("Front desk handles calls from 10am to 7pm",
// "we're closed over the weekend"). Used only for the after-hours KPI.
export const OFFICE_HOURS = { startHour: 10, endHour: 19, days: [1, 2, 3, 4, 5] }; // Mon–Fri, IST
export const STUDIO_TIMEZONE = "Asia/Kolkata";
