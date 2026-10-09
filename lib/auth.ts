import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Vaani tool requests: secret in `x-tool-secret`, `Authorization: Bearer`, or `?key=` (whichever the tool form supports). */
export function toolAuthorized(req: Request): boolean {
  const secret = env.toolSecret;
  if (!secret) return env.mock; // never open in live mode
  const url = new URL(req.url);
  const given = req.headers.get("x-tool-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key") ?? "";
  return safeEq(given, secret);
}

/** Vaani webhook: `?token=` in the URL you paste into Settings → Webhooks; HMAC checked too when a signing secret is set. */
export function webhookAuthorized(req: Request, rawBody: string): boolean {
  const token = env.webhookSecret;
  const url = new URL(req.url);
  if (token ? !safeEq(url.searchParams.get("token") ?? "", token) : !env.mock) return false;
  const signing = env.vaaniSigningSecret;
  if (signing) {
    const sig = req.headers.get("x-vaani-signature")?.replace(/^sha256=/, "") ?? "";
    const ts = req.headers.get("x-vaani-timestamp") ?? "";
    if (!sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const expected = createHmac("sha256", signing).update(`${ts}.${rawBody}`).digest("hex");
    if (!safeEq(sig, expected)) return false;
  }
  return true;
}

export function cronAuthorized(req: Request): boolean {
  const s = env.cronSecret;
  if (!s) return env.mock;
  return safeEq(req.headers.get("authorization") ?? "", `Bearer ${s}`);
}

// ---- dashboard (one shared password) ----
const COOKIE = "aangan_session";
const sessionValue = () => createHmac("sha256", env.sessionSecret).update("aangan-dashboard-v1").digest("hex");

export function passwordOk(pw: string) {
  const expected = env.dashboardPassword ?? (env.mock ? "aangan" : undefined);
  return !!expected && safeEq(pw, expected);
}
export async function setSession() {
  (await cookies()).set(COOKIE, sessionValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
}
export async function clearSession() { (await cookies()).delete(COOKIE); }
export async function isLoggedIn() {
  const v = (await cookies()).get(COOKIE)?.value;
  return !!v && safeEq(v, sessionValue());
}
export async function requireLogin() { if (!(await isLoggedIn())) redirect("/login"); }
