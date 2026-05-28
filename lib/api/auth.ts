import { createHash } from "node:crypto";

type AuthResult =
  | { ok: true; tokenIdentity: string }
  | { ok: false; status: number; errorCode: string; message: string };

function toBoolEnv(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export function hashTokenIdentity(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex");
  return `tok_${digest.slice(0, 12)}`;
}

export function resolveClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || "unknown";
}

export function extractBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, value] = authHeader.split(" ");
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return value.trim() || null;
}

export function verifyPilotToken(headers: Headers): AuthResult {
  const expectedToken = process.env.LE_PILOT_TOKEN?.trim() || "";
  const isProd = process.env.NODE_ENV === "production";
  const allowDevBypass = toBoolEnv(process.env.ALLOW_DEV_PILOT_TOKEN);
  const providedToken = extractBearerToken(headers);

  if (!expectedToken) {
    if (isProd) {
      return {
        ok: false,
        status: 503,
        errorCode: "pilot_token_not_configured",
        message: "Pilot token is not configured.",
      };
    }

    if (allowDevBypass) {
      return {
        ok: true,
        tokenIdentity: "dev_bypass",
      };
    }

    return {
      ok: false,
      status: 503,
      errorCode: "pilot_token_not_configured",
      message: "Pilot token is not configured for this environment.",
    };
  }

  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      errorCode: "pilot_token_missing",
      message: "Authorization bearer token is required.",
    };
  }

  if (providedToken !== expectedToken) {
    return {
      ok: false,
      status: 403,
      errorCode: "pilot_token_invalid",
      message: "Authorization token is invalid.",
    };
  }

  return {
    ok: true,
    tokenIdentity: hashTokenIdentity(providedToken),
  };
}

export async function readJsonWithSizeLimit<T>(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; body: T; bodyBytes: number }
  | { ok: false; status: number; errorCode: string; message: string }
> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      errorCode: "payload_too_large",
      message: `Request body exceeds ${maxBytes} bytes.`,
    };
  }

  const raw = await request.text();
  const rawBytes = new TextEncoder().encode(raw).byteLength;
  if (rawBytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      errorCode: "payload_too_large",
      message: `Request body exceeds ${maxBytes} bytes.`,
    };
  }

  try {
    return {
      ok: true,
      body: (raw ? JSON.parse(raw) : {}) as T,
      bodyBytes: rawBytes,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      errorCode: "invalid_json",
      message: "Invalid JSON body.",
    };
  }
}

