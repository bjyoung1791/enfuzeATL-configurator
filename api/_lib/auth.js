import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Reads the bearer token from the request, verifies it, returns { user, profile }
// or null if the token is missing/invalid or the profile is missing/inactive.
export async function getCallerProfile(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const anon = getAnonClient();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;

  const admin = getAdminClient();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (pErr || !profile || profile.active === false) return null;

  return { user: data.user, profile };
}

export async function requireRole(req, res, roles) {
  const caller = await getCallerProfile(req);
  if (!caller) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(caller.profile.role)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return caller;
}
