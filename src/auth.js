// ∴ The Hermetic Path — Auth module ∴
//
// Provides:
//   - PBKDF2 password hashing (100k iterations, SHA-256, 16-byte salt)
//   - HMAC-SHA256 signed session cookies (stateless; no KV reads per request)
//   - User CRUD against the HERMETIC_USERS KV namespace
//   - Invite CRUD against the HERMETIC_INVITES KV namespace
//   - Authentication middleware helpers for routes
//
// User record stored at users:<lowercaseEmail>
//   { id, email, passwordHash, salt, iterations, role, settings, createdAt, lastLogin }
//
// Invite record stored at invites:<code>
//   { code, createdAt, createdBy, expiresAt, used, email? }
//
// Sessions: NO server-side store. The cookie is a base64url JSON payload
// {uid, email, role, iat, exp} followed by "." and an HMAC-SHA256
// signature using SESSION_SECRET as the key.

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const SESSION_COOKIE = "hp_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // 30 days
const INVITE_LIFETIME_SECONDS = 60 * 60 * 24 * 7;   // 7 days

// ---------- base64url helpers --------------------------------------------

function b64uEncode(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function textBytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Password hashing ---------------------------------------------

export async function hashPassword(password, opts = {}) {
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const salt = bytesToHex(saltBytes);
  const hash = await pbkdf2(password, saltBytes, iterations);
  return { passwordHash: bytesToHex(hash), salt, iterations };
}

export async function verifyPassword(password, record) {
  if (!record?.passwordHash || !record?.salt) return false;
  const saltBytes = hexToBytes(record.salt);
  const iterations = record.iterations || PBKDF2_ITERATIONS;
  const hash = await pbkdf2(password, saltBytes, iterations);
  return constantTimeEqual(bytesToHex(hash), record.passwordHash);
}

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    key,
    HASH_BYTES * 8,
  );
  return bits;
}

// ---------- Session cookies ----------------------------------------------

async function hmacSign(secret, payloadStr) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, textBytes(payloadStr));
  return b64uEncode(sig);
}

export async function createSessionToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    uid: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + SESSION_LIFETIME_SECONDS,
  };
  const payloadStr = b64uEncode(textBytes(JSON.stringify(payload)));
  const sig = await hmacSign(secret, payloadStr);
  return `${payloadStr}.${sig}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = await hmacSign(secret, payloadStr);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(payloadStr)));
  } catch (_e) {
    return null;
  }
  if (!payload?.uid || !payload?.email || !payload?.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function sessionCookieHeader(token, { secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=/`,
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
    `HttpOnly`,
    `SameSite=Strict`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie({ secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `SameSite=Strict`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionCookie(request) {
  const header = request.headers.get("Cookie") || "";
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (name === SESSION_COOKIE) return value;
  }
  return null;
}

// ---------- KV access ----------------------------------------------------

function userKey(email) {
  return `users:${email.trim().toLowerCase()}`;
}

function inviteKey(code) {
  return `invites:${code.trim().toUpperCase()}`;
}

export async function getUserByEmail(env, email) {
  if (!env.HERMETIC_USERS) return null;
  const raw = await env.HERMETIC_USERS.get(userKey(email));
  return raw ? JSON.parse(raw) : null;
}

export async function getUserById(env, id) {
  if (!env.HERMETIC_USERS) return null;
  const list = await env.HERMETIC_USERS.list({ prefix: "users:" });
  for (const k of list.keys) {
    const raw = await env.HERMETIC_USERS.get(k.name);
    if (!raw) continue;
    const u = JSON.parse(raw);
    if (u.id === id) return u;
  }
  return null;
}

export async function listUsers(env) {
  if (!env.HERMETIC_USERS) return [];
  const list = await env.HERMETIC_USERS.list({ prefix: "users:" });
  const users = [];
  for (const k of list.keys) {
    const raw = await env.HERMETIC_USERS.get(k.name);
    if (raw) {
      const u = JSON.parse(raw);
      delete u.passwordHash;
      delete u.salt;
      users.push(u);
    }
  }
  return users;
}

export async function saveUser(env, user) {
  await env.HERMETIC_USERS.put(userKey(user.email), JSON.stringify(user));
}

export async function deleteUser(env, email) {
  await env.HERMETIC_USERS.delete(userKey(email));
}

export async function countUsers(env) {
  if (!env.HERMETIC_USERS) return 0;
  const list = await env.HERMETIC_USERS.list({ prefix: "users:" });
  return list.keys.length;
}

// ---------- Invites ------------------------------------------------------

export function generateInviteCode() {
  // 10-char Crockford-style base32 (no I, L, O, U to avoid ambiguity)
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function createInvite(env, { createdBy, email = null, lifetime = INVITE_LIFETIME_SECONDS } = {}) {
  const code = generateInviteCode();
  const now = Math.floor(Date.now() / 1000);
  const invite = {
    code,
    createdAt: now,
    createdBy,
    expiresAt: now + lifetime,
    used: false,
    email,
  };
  await env.HERMETIC_INVITES.put(inviteKey(code), JSON.stringify(invite), {
    expirationTtl: lifetime + 60,
  });
  return invite;
}

export async function getInvite(env, code) {
  if (!env.HERMETIC_INVITES) return null;
  const raw = await env.HERMETIC_INVITES.get(inviteKey(code));
  return raw ? JSON.parse(raw) : null;
}

export async function consumeInvite(env, code) {
  const invite = await getInvite(env, code);
  if (!invite) return null;
  if (invite.used) return null;
  if (invite.expiresAt < Math.floor(Date.now() / 1000)) return null;
  invite.used = true;
  invite.usedAt = Math.floor(Date.now() / 1000);
  await env.HERMETIC_INVITES.put(inviteKey(code), JSON.stringify(invite), {
    expirationTtl: 60 * 60 * 24, // keep one day for audit
  });
  return invite;
}

export async function listInvites(env) {
  if (!env.HERMETIC_INVITES) return [];
  const list = await env.HERMETIC_INVITES.list({ prefix: "invites:" });
  const out = [];
  for (const k of list.keys) {
    const raw = await env.HERMETIC_INVITES.get(k.name);
    if (raw) out.push(JSON.parse(raw));
  }
  return out;
}

// ---------- Validation helpers ------------------------------------------

export function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validPassword(password) {
  // Minimum 10 characters, at least one letter and one digit OR symbol.
  if (typeof password !== "string") return false;
  if (password.length < 10 || password.length > 128) return false;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasOther = /[\d\W_]/.test(password);
  return hasLetter && hasOther;
}

// ---------- New-user factory --------------------------------------------

export async function buildUser({ email, password, role = "user" }) {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const { passwordHash, salt, iterations } = await hashPassword(password);
  return {
    id,
    email: email.trim().toLowerCase(),
    role,
    passwordHash,
    salt,
    iterations,
    settings: defaultSettings(),
    createdAt: now,
    lastLogin: null,
  };
}

export function defaultSettings() {
  return {
    tradition: "Blended",
    depth: "Intermediate Initiate",
    notificationsEnabled: false,
    notificationsPerDay: 3,
    notificationsWindow: { start: "07:00", end: "22:00" },
    notificationStyle: "short",
    notificationKinds: ["mixed"],
    lockScreenSymbolRotation: true,
  };
}

// ---------- Auth middleware ---------------------------------------------

/**
 * Resolves the current user from the session cookie (if any).
 * Returns { token, payload, user } or null if not signed in.
 */
export async function resolveSession(request, env) {
  const token = readSessionCookie(request);
  if (!token) return null;
  if (!env.SESSION_SECRET) return null;
  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) return null;
  // We do not re-fetch the user on every request; payload is enough
  // for routing. Pages that need fresh user state can call getUserByEmail.
  return { token, payload };
}

export const constants = {
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  INVITE_LIFETIME_SECONDS,
};
