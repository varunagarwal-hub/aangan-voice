import { toolRoute } from "@/lib/tool-route";
import { getSlots } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = toolRoute(getSlots);
