import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

function parseAcceptLanguage(value: string | null): Locale | null {
  if (!value) return null;
  const lang = value.toLowerCase();
  if (lang.includes("sk")) return "sk";
  if (lang.includes("en")) return "en";
  return null;
}

function localeFromCountry(country: string | null): Locale | null {
  if (!country) return null;
  return country.toUpperCase() === "SK" ? "sk" : "en";
}

function detectLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const country = request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || null;
  const geoLocale = localeFromCountry(country);
  if (geoLocale) return geoLocale;

  const byAccept = parseAcceptLanguage(request.headers.get("accept-language"));
  if (byAccept) return byAccept;

  return DEFAULT_LOCALE;
}

function sameOriginApiRequest(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {}
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).host === host) return true;
    } catch {}
  }

  return false;
}

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const isGuardedApiPath =
    request.nextUrl.pathname === "/api/ai/generate" ||
    request.nextUrl.pathname === "/api/projects/generate" ||
    request.nextUrl.pathname === "/api/projects/import" ||
    /\/api\/workflows\/[^/]+\/run$/.test(request.nextUrl.pathname);

  if (
    isGuardedApiPath &&
    !requestHeaders.get("authorization") &&
    sameOriginApiRequest(request)
  ) {
    const pilotToken = process.env.LE_PILOT_TOKEN?.trim();
    if (pilotToken) {
      requestHeaders.set("authorization", `Bearer ${pilotToken}`);
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;

  if (!isLocale(cookieLocale)) {
    response.cookies.set(LOCALE_COOKIE, detectLocale(request), {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|site.webmanifest).*)"],
};
