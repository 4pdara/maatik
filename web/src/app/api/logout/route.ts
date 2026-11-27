import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  void req;
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
