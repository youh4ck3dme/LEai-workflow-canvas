import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const timestamp = new Date().toISOString();
  let db: "ok" | "skipped" | "error" = "skipped";

  // Safe lightweight ping; if DATABASE_URL is absent or ping fails, surface non-fatal status.
  try {
    if (process.env.DATABASE_URL) {
      const sql = getDb();
      await sql`SELECT 1 as ok`;
      db = "ok";
    }
  } catch {
    db = "error";
  }

  return NextResponse.json({
    ok: true,
    service: "LEai-workflow-canvas",
    db,
    timestamp,
  });
}

