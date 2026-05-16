// ∴ The Hermetic Path — Cloudflare Worker entry point ∴
//
// Routes:
//   GET  /                       → index.html (SPA shell)
//   GET  /manifest.webmanifest   → PWA manifest
//   GET  /sw.js                  → service worker
//   GET  /healthz                → liveness probe
//
//   POST /api/auth/login         → { email, password } → sets session cookie
//   POST /api/auth/logout        → clears cookie
//   POST /api/auth/redeem        → { code, email, password } → creates user
//   GET  /api/auth/me            → current user info (or 401)
//   POST /api/auth/change-password → { current, next }
//
//   GET  /api/admin/users        → admin: list users
//   POST /api/admin/users        → admin: create user directly (no invite)
//   DELETE /api/admin/users/:id  → admin: delete user
//   GET  /api/admin/invites      → admin: list invites
//   POST /api/admin/invites      → admin: generate invite code
//
//   POST /api/bootstrap          → first-time admin bootstrap (only when no users exist)
//
//   GET  /api/settings           → current user's settings
//   POST /api/settings           → update settings
//
//   POST /api/generate           → proxy to Anthropic; requires session
//
// The Anthropic API key NEVER reaches the browser. Same for SESSION_SECRET.

import indexHtml from "./index.html";
import manifestText from "./manifest.webmanifest";
import serviceWorkerJs from "./sw.js";

import {
  buildUser,
  clearSessionCookie,
  consumeInvite,
  countUsers,
  createInvite,
  createSessionToken,
  defaultSettings,
  deleteUser,
  generateInviteCode,
  getInvite,
  getUserByEmail,
  getUserById,
  hashPassword,
  listInvites,
  listUsers,
  readSessionCookie,
  resolveSession,
  saveUser,
  sessionCookieHeader,
  validEmail,
  validPassword,
  verifyPassword,
  verifySessionToken,
} from "./auth.js";

import { generate as runGenerate, curriculumDay, getCurriculum } from "./prompts.js";
import symbolsData from "./symbols.json";

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse({ error: "Internal error", detail: String(err?.message ?? err) }, 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  // ----- Static / PWA assets ---------------------------------------------
  if (method === "GET" || method === "HEAD") {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return htmlResponse(indexHtml);
    }
    if (url.pathname === "/manifest.webmanifest") {
      return new Response(manifestText, {
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/sw.js") {
      return new Response(serviceWorkerJs, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          "Service-Worker-Allowed": "/",
        },
      });
    }
    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    }
  }

  // ----- Bootstrap (only valid when zero users exist) --------------------
  if (url.pathname === "/api/bootstrap" && method === "POST") {
    return handleBootstrap(request, env);
  }
  if (url.pathname === "/api/info" && method === "GET") {
    const hasUsers = env.HERMETIC_USERS ? (await countUsers(env)) > 0 : true;
    return jsonResponse({
      hasUsers,
      environment: env.ENVIRONMENT || "unknown",
      // "configured" means: enough to sign in and use the app.
      configured: Boolean(env.HERMETIC_USERS && env.SESSION_SECRET && (env.AI || env.ANTHROPIC_API_KEY)),
      aiProvider: env.ANTHROPIC_API_KEY ? "anthropic" : (env.AI ? "workers-ai" : "none"),
    });
  }
  if (url.pathname === "/api/symbols" && method === "GET") {
    return jsonResponse({
      total: symbolsData.total,
      traditions: symbolsData.traditions,
      counts: symbolsData.counts,
      symbols: symbolsData.symbols,
    });
  }
  if (url.pathname === "/api/curriculum" && method === "GET") {
    return requireAuth(request, env, async (session) => {
      const c = getCurriculum();
      const user = await getUserByEmail(env, session.payload.email);
      const settings = user?.settings || defaultSettings();
      return jsonResponse({
        total_days: c.total_days,
        sections: c.sections,
        currentDay: settings.currentDay || 1,
        today: curriculumDay(settings.currentDay || 1),
      });
    });
  }
  if (url.pathname === "/api/curriculum/advance" && method === "POST") {
    return requireAuth(request, env, async (session) => {
      const user = await getUserByEmail(env, session.payload.email);
      if (!user) return jsonResponse({ error: "User not found." }, 404);
      user.settings = user.settings || defaultSettings();
      const cur = user.settings.currentDay || 1;
      const total = getCurriculum().total_days;
      user.settings.currentDay = Math.min(total, cur + 1);
      await saveUser(env, user);
      return jsonResponse({ ok: true, currentDay: user.settings.currentDay, today: curriculumDay(user.settings.currentDay) });
    });
  }
  if (url.pathname === "/api/curriculum/set" && method === "POST") {
    return requireAuth(request, env, async (session) => {
      let body;
      try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
      const day = Number(body?.day);
      const total = getCurriculum().total_days;
      if (!Number.isFinite(day) || day < 1 || day > total) return jsonResponse({ error: `day must be between 1 and ${total}` }, 400);
      const user = await getUserByEmail(env, session.payload.email);
      if (!user) return jsonResponse({ error: "User not found." }, 404);
      user.settings = user.settings || defaultSettings();
      user.settings.currentDay = day;
      await saveUser(env, user);
      return jsonResponse({ ok: true, currentDay: day, today: curriculumDay(day) });
    });
  }

  // ----- Auth ------------------------------------------------------------
  if (url.pathname === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env);
  }
  if (url.pathname === "/api/auth/logout" && method === "POST") {
    return handleLogout(request, env);
  }
  if (url.pathname === "/api/auth/redeem" && method === "POST") {
    return handleRedeem(request, env);
  }
  if (url.pathname === "/api/auth/me" && method === "GET") {
    return handleMe(request, env);
  }
  if (url.pathname === "/api/auth/change-password" && method === "POST") {
    return handleChangePassword(request, env);
  }

  // ----- Admin -----------------------------------------------------------
  if (url.pathname === "/api/admin/users" && method === "GET") {
    return requireAdmin(request, env, async () => {
      const users = await listUsers(env);
      return jsonResponse({ users });
    });
  }
  if (url.pathname === "/api/admin/users" && method === "POST") {
    return requireAdmin(request, env, async () => handleAdminCreateUser(request, env));
  }
  {
    const userIdMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userIdMatch && method === "DELETE") {
      return requireAdmin(request, env, async () => handleAdminDeleteUser(userIdMatch[1], env));
    }
  }
  if (url.pathname === "/api/admin/invites" && method === "GET") {
    return requireAdmin(request, env, async () => {
      const invites = await listInvites(env);
      return jsonResponse({ invites });
    });
  }
  if (url.pathname === "/api/admin/invites" && method === "POST") {
    return requireAdmin(request, env, async () => handleAdminCreateInvite(request, env));
  }

  // ----- Settings --------------------------------------------------------
  if (url.pathname === "/api/settings" && method === "GET") {
    return requireAuth(request, env, async (session) => handleGetSettings(session, env));
  }
  if (url.pathname === "/api/settings" && method === "POST") {
    return requireAuth(request, env, async (session) => handleSaveSettings(request, session, env));
  }

  // ----- Generation ------------------------------------------------------
  if (url.pathname === "/api/generate" && method === "POST") {
    return requireAuth(request, env, async (session) => handleGenerate(request, session, env));
  }

  // ----- SPA fallback ----------------------------------------------------
  if (method === "GET") return htmlResponse(indexHtml);

  return jsonResponse({ error: "Not found" }, 404);
}

// ---------------------------------------------------------------------------
// Middleware helpers
// ---------------------------------------------------------------------------

async function requireAuth(request, env, handler) {
  const session = await resolveSession(request, env);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);
  return handler(session);
}

async function requireAdmin(request, env, handler) {
  const session = await resolveSession(request, env);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);
  if (session.payload.role !== "admin") return jsonResponse({ error: "Forbidden" }, 403);
  return handler(session);
}

// ---------------------------------------------------------------------------
// Bootstrap — create the very first admin (only when no users exist)
// ---------------------------------------------------------------------------

async function handleBootstrap(request, env) {
  if (!env.ADMIN_EMAIL) {
    return jsonResponse({ error: "Server is missing ADMIN_EMAIL configuration." }, 500);
  }
  if (!env.SESSION_SECRET) {
    return jsonResponse({ error: "Server is missing SESSION_SECRET configuration." }, 500);
  }
  if (!env.HERMETIC_USERS) {
    return jsonResponse({ error: "User store is not configured (HERMETIC_USERS KV missing)." }, 500);
  }

  const existing = await countUsers(env);
  if (existing > 0) {
    return jsonResponse({ error: "Bootstrap is closed. An admin already exists." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { email, password } = body || {};
  if (!validEmail(email)) return jsonResponse({ error: "Invalid email." }, 400);
  if (!validPassword(password)) {
    return jsonResponse(
      { error: "Password must be at least 10 characters and include a letter and a digit or symbol." },
      400,
    );
  }
  if (email.trim().toLowerCase() !== env.ADMIN_EMAIL.trim().toLowerCase()) {
    return jsonResponse(
      { error: "Bootstrap email does not match the configured ADMIN_EMAIL." },
      403,
    );
  }

  const user = await buildUser({ email, password, role: "admin" });
  await saveUser(env, user);

  const token = await createSessionToken(user, env.SESSION_SECRET);
  return jsonResponse(
    { ok: true, user: publicUser(user) },
    200,
    { "Set-Cookie": sessionCookieHeader(token, { secure: isSecure(request) }) },
  );
}

// ---------------------------------------------------------------------------
// Login / Logout / Me / Redeem / Change password
// ---------------------------------------------------------------------------

async function handleLogin(request, env) {
  if (!env.SESSION_SECRET) {
    return jsonResponse({ error: "Server is missing SESSION_SECRET." }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const { email, password } = body || {};
  if (!validEmail(email) || typeof password !== "string") {
    return jsonResponse({ error: "Invalid credentials." }, 400);
  }

  const user = await getUserByEmail(env, email);
  // Generic message — don't leak whether the user exists.
  const fail = () => jsonResponse({ error: "Invalid email or password." }, 401);
  if (!user) return fail();
  const ok = await verifyPassword(password, user);
  if (!ok) return fail();

  user.lastLogin = Math.floor(Date.now() / 1000);
  await saveUser(env, user);

  const token = await createSessionToken(user, env.SESSION_SECRET);
  return jsonResponse(
    { ok: true, user: publicUser(user) },
    200,
    { "Set-Cookie": sessionCookieHeader(token, { secure: isSecure(request) }) },
  );
}

async function handleLogout(request, env) {
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie({ secure: isSecure(request) }) },
  );
}

async function handleMe(request, env) {
  const session = await resolveSession(request, env);
  if (!session) return jsonResponse({ authenticated: false }, 200);
  const user = await getUserByEmail(env, session.payload.email);
  if (!user) return jsonResponse({ authenticated: false }, 200);
  return jsonResponse({ authenticated: true, user: publicUser(user) });
}

async function handleRedeem(request, env) {
  if (!env.SESSION_SECRET) {
    return jsonResponse({ error: "Server is missing SESSION_SECRET." }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const { code, email, password } = body || {};
  if (!code || typeof code !== "string") return jsonResponse({ error: "Missing invite code." }, 400);
  if (!validEmail(email)) return jsonResponse({ error: "Invalid email." }, 400);
  if (!validPassword(password)) {
    return jsonResponse(
      { error: "Password must be at least 10 characters and include a letter and a digit or symbol." },
      400,
    );
  }

  const invite = await getInvite(env, code);
  if (!invite || invite.used || invite.expiresAt < Math.floor(Date.now() / 1000)) {
    return jsonResponse({ error: "Invite is invalid or expired." }, 400);
  }
  if (invite.email && invite.email.toLowerCase() !== email.trim().toLowerCase()) {
    return jsonResponse({ error: "This invite is bound to a different email." }, 400);
  }

  const existing = await getUserByEmail(env, email);
  if (existing) return jsonResponse({ error: "An account with that email already exists." }, 409);

  const consumed = await consumeInvite(env, code);
  if (!consumed) return jsonResponse({ error: "Invite could not be consumed." }, 400);

  const user = await buildUser({ email, password, role: "user" });
  await saveUser(env, user);

  const token = await createSessionToken(user, env.SESSION_SECRET);
  return jsonResponse(
    { ok: true, user: publicUser(user) },
    200,
    { "Set-Cookie": sessionCookieHeader(token, { secure: isSecure(request) }) },
  );
}

async function handleChangePassword(request, env) {
  return requireAuth(request, env, async (session) => {
    let body;
    try {
      body = await request.json();
    } catch (_e) {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }
    const { current, next } = body || {};
    if (typeof current !== "string" || !validPassword(next)) {
      return jsonResponse(
        { error: "New password must be at least 10 characters and include a letter and a digit or symbol." },
        400,
      );
    }
    const user = await getUserByEmail(env, session.payload.email);
    if (!user) return jsonResponse({ error: "User not found." }, 404);
    const ok = await verifyPassword(current, user);
    if (!ok) return jsonResponse({ error: "Current password is incorrect." }, 401);

    const { passwordHash, salt, iterations } = await hashPassword(next);
    user.passwordHash = passwordHash;
    user.salt = salt;
    user.iterations = iterations;
    await saveUser(env, user);
    return jsonResponse({ ok: true });
  });
}

// ---------------------------------------------------------------------------
// Admin handlers
// ---------------------------------------------------------------------------

async function handleAdminCreateUser(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const { email, password, role = "user" } = body || {};
  if (!validEmail(email)) return jsonResponse({ error: "Invalid email." }, 400);
  if (!validPassword(password)) {
    return jsonResponse(
      { error: "Password must be at least 10 characters and include a letter and a digit or symbol." },
      400,
    );
  }
  const existing = await getUserByEmail(env, email);
  if (existing) return jsonResponse({ error: "User already exists." }, 409);
  const user = await buildUser({ email, password, role: role === "admin" ? "admin" : "user" });
  await saveUser(env, user);
  return jsonResponse({ ok: true, user: publicUser(user) });
}

async function handleAdminDeleteUser(userId, env) {
  const list = await listUsers(env);
  const target = list.find((u) => u.id === userId);
  if (!target) return jsonResponse({ error: "User not found." }, 404);
  if (target.role === "admin") {
    const remainingAdmins = list.filter((u) => u.role === "admin" && u.id !== userId);
    if (remainingAdmins.length === 0) {
      return jsonResponse({ error: "Cannot delete the last admin." }, 400);
    }
  }
  await deleteUser(env, target.email);
  return jsonResponse({ ok: true });
}

async function handleAdminCreateInvite(request, env) {
  let body = {};
  try {
    body = (await request.json()) || {};
  } catch (_e) {
    body = {};
  }
  const session = await resolveSession(request, env);
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
  if (email && !validEmail(email)) return jsonResponse({ error: "Invalid bound email." }, 400);
  const invite = await createInvite(env, { createdBy: session.payload.uid, email });
  return jsonResponse({ ok: true, invite });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function handleGetSettings(session, env) {
  const user = await getUserByEmail(env, session.payload.email);
  if (!user) return jsonResponse({ error: "User not found." }, 404);
  return jsonResponse({ settings: user.settings || defaultSettings() });
}

async function handleSaveSettings(request, session, env) {
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const user = await getUserByEmail(env, session.payload.email);
  if (!user) return jsonResponse({ error: "User not found." }, 404);
  const current = user.settings || defaultSettings();
  const next = { ...current, ...sanitizeSettings(body || {}) };
  user.settings = next;
  await saveUser(env, user);
  return jsonResponse({ ok: true, settings: next });
}

function sanitizeSettings(raw) {
  const out = {};
  if (typeof raw.tradition === "string") out.tradition = raw.tradition.slice(0, 40);
  if (typeof raw.depth === "string") out.depth = raw.depth.slice(0, 60);
  if (typeof raw.notificationsEnabled === "boolean") out.notificationsEnabled = raw.notificationsEnabled;
  if (Number.isFinite(raw.notificationsPerDay)) out.notificationsPerDay = Math.min(9, Math.max(1, Math.floor(raw.notificationsPerDay)));
  if (raw.notificationsWindow && typeof raw.notificationsWindow === "object") {
    out.notificationsWindow = {
      start: typeof raw.notificationsWindow.start === "string" ? raw.notificationsWindow.start : "07:00",
      end: typeof raw.notificationsWindow.end === "string" ? raw.notificationsWindow.end : "22:00",
    };
  }
  if (raw.notificationStyle === "short" || raw.notificationStyle === "medium") out.notificationStyle = raw.notificationStyle;
  if (Array.isArray(raw.notificationKinds)) out.notificationKinds = raw.notificationKinds.filter((k) => typeof k === "string").slice(0, 8);
  if (typeof raw.lockScreenSymbolRotation === "boolean") out.lockScreenSymbolRotation = raw.lockScreenSymbolRotation;
  return out;
}

// ---------------------------------------------------------------------------
// Generate (routes to Workers AI or Anthropic via prompts.js)
// ---------------------------------------------------------------------------

async function handleGenerate(request, session, env) {
  if (!env.AI && !env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "No AI provider configured on the Worker." }, 500);
  }
  let payload;
  try {
    payload = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  const { feature, params = {} } = payload || {};
  if (!feature || typeof feature !== "string") {
    return jsonResponse({ error: "Missing 'feature' in request body." }, 400);
  }

  const user = await getUserByEmail(env, session.payload.email);
  const settings = user?.settings || defaultSettings();
  const ctx = { user, currentDay: settings.currentDay || 1 };

  try {
    const result = await runGenerate(env, feature, params, settings, ctx);
    return jsonResponse({ ok: true, feature, ...result });
  } catch (err) {
    return jsonResponse(
      { error: err.message || "Upstream error", detail: err.detail || null },
      err.status || 502,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function htmlResponse(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function isSecure(request) {
  // workers.dev and *.v64otd.com are always HTTPS; this is just a safety check.
  return new URL(request.url).protocol === "https:";
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    settings: user.settings || defaultSettings(),
  };
}
