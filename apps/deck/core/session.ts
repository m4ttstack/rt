import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "la_session";

function sign(app: string, version: number, secret: string): string {
  return createHmac("sha256", secret).update(`${app}.${version}`).digest("hex");
}

export function signToken(app: string, passwordVersion: number, secret: string): string {
  return `${app}.${passwordVersion}.${sign(app, passwordVersion, secret)}`;
}

export function verifyToken(
  token: string | undefined,
  app: string,
  passwordVersion: number,
  secret: string,
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokApp, tokVer, tokSig] = parts;
  if (tokApp !== app) return false;
  if (Number(tokVer) !== passwordVersion) return false;
  const expected = sign(app, passwordVersion, secret);
  const a = Buffer.from(tokSig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function cookieHeader(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
