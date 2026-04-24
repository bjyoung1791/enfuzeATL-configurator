import { getAdminClient, requireRole } from "./_lib/auth.js";

const ROLES = ["admin", "lead_designer", "designer"];

export default async function handler(req, res) {
  const caller = await requireRole(req, res, "admin");
  if (!caller) return;

  const admin = getAdminClient();

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, must_change_password, active, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data || [] });
  }

  if (req.method === "POST") {
    const { email, password, full_name, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || null },
    });
    if (createErr) return res.status(400).json({ error: createErr.message });

    const { error: profileErr } = await admin.from("profiles").insert({
      id: created.user.id,
      email,
      full_name: full_name || null,
      role,
      must_change_password: true,
      active: true,
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      return res.status(500).json({ error: profileErr.message });
    }

    return res.status(200).json({ ok: true, id: created.user.id });
  }

  if (req.method === "PATCH") {
    const { id, action } = req.body || {};
    if (!id) return res.status(400).json({ error: "User id is required" });

    if (action === "reset_password") {
      const { password } = req.body;
      if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      const { error: pwErr } = await admin.auth.admin.updateUserById(id, { password });
      if (pwErr) return res.status(400).json({ error: pwErr.message });
      const { error: flagErr } = await admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", id);
      if (flagErr) return res.status(500).json({ error: flagErr.message });
      return res.status(200).json({ ok: true });
    }

    if (action === "update_profile") {
      const { role, full_name, active } = req.body;
      const updates = {};
      if (role !== undefined) {
        if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
        updates.role = role;
      }
      if (full_name !== undefined) updates.full_name = full_name;
      if (active !== undefined) updates.active = !!active;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }

      if (id === caller.user.id && updates.role && updates.role !== "admin") {
        return res.status(400).json({ error: "You cannot demote yourself" });
      }
      if (id === caller.user.id && updates.active === false) {
        return res.status(400).json({ error: "You cannot deactivate yourself" });
      }

      const { error } = await admin.from("profiles").update(updates).eq("id", id);
      if (error) return res.status(500).json({ error: error.message });

      if (updates.active === false) {
        await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" }).catch(() => {});
      } else if (updates.active === true) {
        await admin.auth.admin.updateUserById(id, { ban_duration: "none" }).catch(() => {});
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Invalid action" });
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "User id is required" });
    if (id === caller.user.id) return res.status(400).json({ error: "You cannot delete yourself" });

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
