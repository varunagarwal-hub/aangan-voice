import { toolRoute } from "@/lib/tool-route";
import { bookSlot } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = toolRoute(bookSlot);
