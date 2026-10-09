import { NextResponse } from "next/server";
import { passwordOk, setSession } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  if (!passwordOk(String(form.get("password") ?? ""))) return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  await setSession();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
