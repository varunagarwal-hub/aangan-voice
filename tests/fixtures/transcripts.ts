/**
 * The 20 September 2026 phone enquiries (knowledge/enquiries-sep-2026.txt), written as the
 * check_lead input Vaani would send, plus the outcome the rules must produce.
 * "today" for each is the call date. T08 (missed call) is omitted: Vaani answers every call.
 */
import type { LeadInput, Outcome } from "@/lib/rules";

export interface Fixture {
  id: string;
  today: string;
  input: Partial<LeadInput> & { call_id: string };
  expected: Outcome;
  expectedFail?: string;
  /** Transcript lines for the mock simulator (caller side, condensed). */
  transcript: string;
}

export const PHONE_FIXTURES: Fixture[] = [
  {
    id: "T01", today: "2026-09-02", expected: "qualified",
    input: { call_id: "sim-T01", name: "Priya", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Dahanukar Colony, Kothrud", carpet_area_sqft: 1400, service_wanted: "design_and_execution",
      timeline_text: "Done by March, no rush", needed_by_date: "2027-03-31", decision_maker: "yes",
      requirements: "3BHK full redesign — kitchen, living room, both bedrooms. Still a builder flat." },
    transcript: "We have a 3BHK in Kothrud, Dahanukar Colony, about 1,400 sq ft carpet. Want to redo the whole thing. Done by March. Myself and my husband — he's happy to go ahead.",
  },
  {
    id: "T02", today: "2026-09-03", expected: "qualified",
    input: { call_id: "sim-T02", project_category: "residential", property_type: "apartment", scope: "full_home", location: "Wakad",
      carpet_area_sqft: 950, service_wanted: "design_and_execution", timeline_text: "Move in November, design from October",
      no_fixed_deadline: false, needed_by_date: "2026-11-30", decision_maker: "unknown", asked_about_price: true,
      requirements: "2BHK full redesign — modular kitchen, wardrobes, living room, both bedrooms." },
    transcript: "I have a 2BHK in Wakad, about 950 sq ft. Full redesign. Roughly how much would it cost? Even a range?",
  },
  {
    id: "T03", today: "2026-09-03", expected: "not_qualified", expectedFail: "service_area",
    input: { call_id: "sim-T03", name: "Suresh Patil", project_category: "residential", location: "Nashik",
      service_wanted: "design_and_execution", scope: "partial_home", requirements: "Home office and study" },
    transcript: "I'm in Nashik — would you take on a project here? Home office and study.",
  },
  {
    id: "T04", today: "2026-09-04", expected: "not_qualified", expectedFail: "real_project",
    input: { call_id: "sim-T04", project_category: "residential", scope: "single_room", service_wanted: "advice_only",
      requirements: "Ideas for living room — colours, furniture arrangement" },
    transcript: "Can someone come and give us ideas for our living room? Not doing the full thing, just suggestions.",
  },
  {
    id: "T05", today: "2026-09-05", expected: "qualified",
    input: { call_id: "sim-T05", name: "Aarti Mehta", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Koregaon Park", carpet_area_sqft: 2400, service_wanted: "design_and_execution", needed_by_date: "2027-02-01",
      decision_maker: "yes", requirements: "4BHK complete redesign — flooring, kitchen, all four bedrooms. Moved out temporarily. Wants site visit." },
    transcript: "4BHK in Koregaon Park, about 2,400 sq ft carpet. Complete redesign. Move back in by February.",
  },
  {
    id: "T06", today: "2026-09-05", expected: "qualified",
    input: { call_id: "sim-T06", project_category: "commercial", property_type: "office", scope: "office_fitout", location: "Baner",
      carpet_area_sqft: 800, service_wanted: "design_and_execution", needed_by_date: "2026-12-01", decision_maker: "yes",
      requirements: "Bare shell. Workstations for 20, small cabin, meeting room, break area." },
    transcript: "Startup office in Baner, about 800 sq ft, bare shell. Operational by December. I'm the founder.",
  },
  {
    id: "T07", today: "2026-09-08", expected: "not_qualified", expectedFail: "timeline",
    input: { call_id: "sim-T07", project_category: "residential", scope: "partial_home", room_count: 2,
      service_wanted: "design_and_execution", location: "Pune", weeks_until_needed: 3, timeline_text: "Before Diwali",
      requirements: "Living room and kitchen before Diwali" },
    transcript: "I want to redo my living room and kitchen before Diwali — about three weeks away.",
  },
  {
    id: "T09", today: "2026-09-10", expected: "escalation",
    input: { call_id: "sim-T09", name: "Sheetal Deshpande", enquiry_type: "existing_client", location: "Viman Nagar",
      requirements: "Existing project, designer Aryan hasn't replied in five days. Wants callback from Nikhil or senior." },
    transcript: "My project has been going for three months and my designer hasn't replied in five days.",
  },
  {
    id: "T10", today: "2026-09-11", expected: "not_qualified", expectedFail: "budget",
    input: { call_id: "sim-T10", project_category: "residential", property_type: "apartment", scope: "partial_home", room_count: 2,
      location: "Kharadi", location_confirmed_pune_pcmc: "yes", carpet_area_sqft: 550, service_wanted: "design_and_execution",
      budget_volunteered: true, budget_min_inr: 100000, budget_max_inr: 150000, no_fixed_deadline: true,
      requirements: "1BHK — kitchen and one bedroom" },
    transcript: "1BHK in Kharadi, about 550 sq ft. Kitchen and one bedroom. Budget is 1 to 1.5 lakh maximum.",
  },
  {
    id: "T11", today: "2026-09-12", expected: "qualified",
    input: { call_id: "sim-T11", project_category: "residential", property_type: "apartment", scope: "partial_home", room_count: 3,
      location: "Baner", service_wanted: "design_and_execution", is_rented: "yes", structural_changes_required: "no",
      no_fixed_deadline: true, decision_maker: "yes", requirements: "Rented 2BHK, 3-year lease. Living room, bedroom, kitchen. Landlord OK, no wall-breaking." },
    transcript: "Rented 2BHK in Baner, 3-year lease. Design living room, bedroom, kitchen — no structural changes. Landlord is fine.",
  },
  {
    id: "T12", today: "2026-09-15", expected: "qualified",
    input: { call_id: "sim-T12", name: "Anand Sharma", project_category: "residential", property_type: "villa", scope: "full_home",
      location: "Kalyani Nagar", carpet_area_sqft: 5500, service_wanted: "design_and_execution", needed_by_date: "2027-03-31",
      decision_maker: "yes", requirements: "New villa, G+2, completely empty. Wants principal designer site visit." },
    transcript: "Villa in Kalyani Nagar, about 5,500 sq ft, ground plus two. Full end-to-end design. March to move in.",
  },
  {
    id: "T13", today: "2026-09-16", expected: "qualified",
    input: { call_id: "sim-T13", project_category: "residential", property_type: "apartment", scope: "partial_home", location: "Aundh",
      carpet_area_sqft: 1100, service_wanted: "design_and_execution", no_fixed_deadline: true, decision_maker: "unknown",
      asked_about_price: true, requirements: "3BHK — kitchen, wardrobes in both bedrooms, living room." },
    transcript: "Flat in Aundh, 3BHK, 1,100 sq ft. Kitchen, wardrobes, living room. Can't you give a rough range?",
  },
  {
    id: "T14", today: "2026-09-17", expected: "qualified",
    input: { call_id: "sim-T14", project_category: "residential", property_type: "apartment", scope: "full_home", location: "Hadapsar",
      service_wanted: "design_and_execution", no_fixed_deadline: true, decision_maker: "authorised_on_behalf",
      requirements: "Parents' new-possession 3BHK. Parents will attend the consultation and decide." },
    transcript: "Enquiring for my parents — 3BHK in Hadapsar, new possession. They'll come to the consultation.",
  },
  {
    id: "T15", today: "2026-09-18", expected: "qualified",
    input: { call_id: "sim-T15", name: "Smita", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Undri", carpet_area_sqft: 875, service_wanted: "design_and_execution", no_fixed_deadline: true, decision_maker: "yes",
      requirements: "Possession in ~6 weeks. 2BHK full package — kitchen, wardrobes, living room. Builder will allow site access." },
    transcript: "Getting possession in Undri in about six weeks. 2BHK, 875 sq ft. Full home. Want to start design now.",
  },
  {
    id: "T16", today: "2026-09-19", expected: "qualified",
    input: { call_id: "sim-T16", name: "Girish Nair", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Viman Nagar", service_wanted: "design_and_execution", no_fixed_deadline: true, decision_maker: "unknown",
      requirements: "3BHK. Called Monday, nobody called back — frustrated." },
    transcript: "I called on Monday about my 3BHK in Viman Nagar and nobody got back to me.",
  },
  {
    id: "T17", today: "2026-09-22", expected: "qualified",
    input: { call_id: "sim-T17", name: "Ritu Kapoor", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Pimple Saudagar", carpet_area_sqft: 1050, service_wanted: "design_and_execution", needed_by_date: "2027-03-31",
      decision_maker: "unknown", requirements: "3BHK, builder furniture. Kitchen, wardrobes, living room." },
    transcript: "Got cut off earlier. Ritu from Pimple Saudagar, 3BHK, 1,050 sq ft. Done by March.",
  },
  {
    id: "T18", today: "2026-09-23", expected: "qualified",
    input: { call_id: "sim-T18", project_category: "commercial", property_type: "coworking pod", scope: "office_fitout",
      location: "Pune", carpet_area_sqft: 180, service_wanted: "design_and_execution", no_fixed_deadline: true, decision_maker: "yes",
      requirements: "180 sq ft coworking pod — lighting, desk, storage." },
    transcript: "I run a coworking space. 180 sq ft pod I want to make look nice.",
  },
  {
    id: "T19", today: "2026-09-24", expected: "not_qualified", expectedFail: "real_project",
    input: { call_id: "sim-T19", project_category: "commercial", property_type: "restaurant", location: "Koregaon Park",
      service_wanted: "design_and_execution", requirements: "New restaurant interiors" },
    transcript: "Opening a restaurant in Koregaon Park — would you design the interiors?",
  },
  {
    id: "T20", today: "2026-09-25", expected: "qualified",
    input: { call_id: "sim-T20", name: "Pooja", project_category: "residential", property_type: "apartment", scope: "full_home",
      location: "Magarpatta", carpet_area_sqft: 900, service_wanted: "design_and_execution", no_fixed_deadline: true,
      decision_maker: "yes", requirements: "2BHK — kitchen, both bedrooms, living room. January execution start." },
    transcript: "2BHK in Magarpatta, about 900 sq ft. Kitchen, both bedrooms, living room. January start is ideal.",
  },
];
