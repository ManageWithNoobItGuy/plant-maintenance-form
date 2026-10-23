import type { Env } from "./types";

// PIN login. Two roles:
//   tech     – view, add and edit inspections, export forms (TECH_PIN)
//   engineer – everything a technician can do, plus delete inspections and sign sheets (ENGINEER_PIN)
// The session is an HMAC-signed cookie. The signing key includes the role's PIN,
// so changing a PIN logs out everyone who used the old one.

export type Role = "tech" | "engineer";

export interface Session {
  role: Role;
  exp: number; // unix seconds
}

const COOKIE = "pm_session";
const TTL: Record<Role, number> = { tech: 30 * 24 * 3600, engineer: 12 * 3600 };
const MAX_FAILS = 10;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function authConfigured(env: Env): boolean {
  return Boolean(env.TECH_PIN && env.ENGINEER_PIN && env.SESSION_SECRET);
}

function signingKey(env: Env, role: Role): string {
  return `${env.SESSION_SECRET}:${role === "engineer" ? env.ENGINEER_PIN : env.TECH_PIN}`;
}

/** Which role this PIN unlocks, or null. Compares HMACs so timing doesn't leak the PIN. */
export async function roleForPin(env: Env, pin: string): Promise<Role | null> {
  const probe = await hmac(env.SESSION_SECRET, `pin:${pin}`);
  if (equal(probe, await hmac(env.SESSION_SECRET, `pin:${env.ENGINEER_PIN}`))) return "engineer";
  if (equal(probe, await hmac(env.SESSION_SECRET, `pin:${env.TECH_PIN}`))) return "tech";
  return null;
}

export async function sessionCookie(env: Env, role: Role): Promise<{ cookie: string; session: Session }> {
  const session: Session = { role, exp: Math.floor(Date.now() / 1000) + TTL[role] };
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const sig = b64url(await hmac(signingKey(env, role), payload));
  return {
    session,
    cookie: `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL[role]}`,
  };
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function readSession(req: Request, env: Env): Promise<Session | null> {
  if (!authConfigured(env)) return null;
  const raw = (req.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".");
  try {
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (session.role !== "tech" && session.role !== "engineer") return null;
    if (!equal(fromB64url(sig), await hmac(signingKey(env, session.role), payload))) return null;
    if (session.exp < Date.now() / 1000) return null;
    return session;
  } catch {
    return null;
  }
}

// ---------- brute-force protection (per client IP) ----------

export async function isLockedOut(env: Env, ip: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > datetime('now', ?)`
  )
    .bind(ip, `-${LOCK_MINUTES} minutes`)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILS;
}

export async function recordFailure(env: Env, ip: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO login_attempts (ip) VALUES (?)`).bind(ip),
    env.DB.prepare(`DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')`),
  ]);
}

export async function clearFailures(env: Env, ip: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}

export const LOCKOUT_MESSAGE = `ใส่ PIN ผิดหลายครั้ง กรุณารอ ${LOCK_MINUTES} นาทีแล้วลองใหม่`;
