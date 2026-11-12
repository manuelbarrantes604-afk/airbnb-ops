// Server-only: creates a sign-in account for an invited email, then adds the
// member row AS THE CALLING ADMIN (so database permissions and the audit log
// apply normally). The secret key never reaches the browser.
import { createClient } from "@supabase/supabase-js";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishable || !secret) return json(500, { code: "not_configured", error: "Invitations aren’t configured on the server (missing SUPABASE_SECRET_KEY)." });

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { code: "not_signed_in", error: "Please sign in again." });

  // Act as the signed-in person: RLS decides whether they are an admin.
  const asUser = createClient(url, publishable, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await asUser.auth.getUser(token);
  if (whoErr || !who.user) return json(401, { code: "not_signed_in", error: "Your session has expired. Please sign in again." });
  const { data: me } = await asUser.from("members").select("role, active").eq("user_id", who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return json(403, { code: "not_allowed", error: "Only administrators can invite people." });

  let body: { email?: string; display_name?: string; kind?: string; fellow_id?: string | null; role?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { code: "bad_request", error: "Invalid request." });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.display_name ?? "").trim();
  const kind = body.kind === "fellow" ? "fellow" : body.kind === "staff" ? "staff" : null;
  const role = body.role === "admin" ? "admin" : "member";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return json(400, { code: "bad_email", error: "Enter a valid email." });
  if (!name || name.length > 80) return json(400, { code: "bad_name", error: "Enter a display name (up to 80 characters)." });
  if (!kind) return json(400, { code: "bad_kind", error: "Choose Fellow or staff." });
  const fellowId = kind === "fellow" ? body.fellow_id ?? null : null;
  if (kind === "fellow" && !fellowId) return json(400, { code: "bad_fellow", error: "Choose the roster profile." });

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) userId = created.data.user.id;
  else {
    // Already has a sign-in account (e.g. previously removed): find it.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!userId) return json(500, { code: "create_failed", error: created.error?.message ?? "Could not create the account." });
  }

  const { data: existing } = await asUser.from("members").select("user_id, active").eq("user_id", userId).maybeSingle();
  if (existing) {
    return json(409, { code: "exists", error: existing.active ? "That email already has access." : "That person already has an account with access removed. Use “Restore access” instead." });
  }
  const { error: insErr } = await asUser.from("members").insert({ user_id: userId, email, display_name: name, kind, fellow_id: fellowId, role });
  if (insErr) {
    const msg = /fellow_id/.test(insErr.message) ? "That roster profile is already linked to another account." : insErr.message;
    return json(400, { code: "insert_failed", error: msg });
  }
  return json(200, { ok: true });
}
