// Staff profile photos: data access (spec docs/staff-photo-spec.md, Part E1).
//
// Everything is enforced in the database (supabase/staff-photo.sql): who may
// submit, which names are allowed, the admin-only RPCs, the audit rows and the
// storage policies. The UI only mirrors those rules.
//
//   SP_api.myStatus()                          sp_my_photo_status(): gate + Settings
//   SP_api.submit(originalPath, currentPath)   sp_submit_my_photo()
//   SP_api.adminList()                         sp_admin_photo_list() (admins)
//   SP_api.history(email)                      sp_admin_photo_history() (admins)
//   SP_api.replace(email, path, note)          sp_admin_replace_staff_photo() (admins)
//   SP_api.restore(email)                      sp_admin_restore_staff_photo() (admins)
//   SP_api.setExempt(email, exempt, reason)    sp_admin_set_photo_exempt() (admins)
//   SP_api.hideVersion(id)                     sp_admin_hide_photo_version() (admins)
//   SP_api.logDownload(emails, what)           sp_admin_log_photo_download() (admins)
//   SP_api.upload / signedUrl / download       storage bucket staff-avatars
//
// SP_useMyStatus() and SP_useAdminList() are shared stores. SP_changed()
// refreshes both (and ST_profile, which listens for SP_CHANGED_EVENT) after any
// change. Pure rules live in staffPhotoLogic.js (loaded first).

const SP_BUCKET = "staff-avatars";
const SP_CHANGED_EVENT = "sp:changed";

function SP_errText(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  return m.replace(/^ERROR:\s*/i, "") || "Something went wrong. Try again.";
}

function SP_changed() {
  SP_myStore.at = 0;
  SP_adminStore.at = 0;
  window.dispatchEvent(new CustomEvent(SP_CHANGED_EVENT));
}

const SP_api = {
  async rpc(fn, args) {
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(SP_errText(error));
    return data;
  },
  myStatus() {
    return SP_api.rpc("sp_my_photo_status");
  },
  async submit(originalPath, currentPath) {
    const d = await SP_api.rpc("sp_submit_my_photo", { p_original_path: originalPath, p_current_path: currentPath });
    SP_changed();
    return d;
  },
  adminList() {
    return SP_api.rpc("sp_admin_photo_list").then((d) => d || []);
  },
  history(email) {
    return SP_api.rpc("sp_admin_photo_history", { p_staff_email: email }).then((d) => d || []);
  },
  async replace(email, path, note) {
    const d = await SP_api.rpc("sp_admin_replace_staff_photo", { p_staff_email: email, p_path: path, p_note: note || null });
    SP_changed();
    return d;
  },
  async restore(email) {
    const d = await SP_api.rpc("sp_admin_restore_staff_photo", { p_staff_email: email });
    SP_changed();
    return d;
  },
  async setExempt(email, exempt, reason) {
    await SP_api.rpc("sp_admin_set_photo_exempt", { p_staff_email: email, p_exempt: !!exempt, p_reason: reason || null });
    SP_changed();
  },
  async hideVersion(id) {
    await SP_api.rpc("sp_admin_hide_photo_version", { p_version_id: id });
    SP_changed();
  },
  // Audit only: a logging failure must never block the download itself.
  async logDownload(emails, what) {
    try {
      await SP_api.rpc("sp_admin_log_photo_download", { p_staff_emails: emails || [], p_what: what });
    } catch (e) {
      /* ignore */
    }
  },
  async upload(path, blob, contentType) {
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { error } = await sb.storage.from(SP_BUCKET).upload(path, blob, {
      contentType: contentType || blob.type || "image/jpeg",
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) throw new Error(SP_errText(error));
    return path;
  },
  async signedUrl(path, seconds) {
    if (!path) return null;
    const sb = window.mgbSupabase;
    if (!sb) return null;
    try {
      const { data, error } = await sb.storage.from(SP_BUCKET).createSignedUrl(path, seconds || 3600);
      if (error) return null;
      return (data && data.signedUrl) || null;
    } catch (e) {
      return null;
    }
  },
  async download(path) {
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { data, error } = await sb.storage.from(SP_BUCKET).download(path);
    if (error) throw new Error(SP_errText(error));
    return data;
  },
};

// ---------------------------------------------------------------------------
// Shared stores. In-flight requests are deduped; a change event reloads both.
// ---------------------------------------------------------------------------
const SP_myStore = { email: "", loaded: false, error: "", data: null, at: 0, pending: null, subs: new Set() };
const SP_adminStore = { loaded: false, error: "", rows: null, at: 0, pending: null, subs: new Set() };

function SP_loadMy(email, force) {
  if (SP_myStore.email !== email) {
    SP_myStore.email = email;
    SP_myStore.loaded = false;
    SP_myStore.error = "";
    SP_myStore.data = null;
    SP_myStore.at = 0;
    SP_myStore.pending = null;
  }
  if (SP_myStore.pending) return SP_myStore.pending;
  if (!force && SP_myStore.at && Date.now() - SP_myStore.at < 60000) return Promise.resolve(SP_myStore.data);
  const forEmail = email;
  const p = SP_api
    .myStatus()
    .then((d) => {
      if (SP_myStore.email !== forEmail) return null;
      SP_myStore.data = d || null;
      SP_myStore.error = "";
      return SP_myStore.data;
    })
    .catch((e) => {
      if (SP_myStore.email === forEmail) SP_myStore.error = SP_errText(e);
      return null;
    })
    .finally(() => {
      if (SP_myStore.email === forEmail) {
        SP_myStore.loaded = true;
        SP_myStore.at = Date.now();
        SP_myStore.pending = null;
      }
      SP_myStore.subs.forEach((f) => f());
    });
  SP_myStore.pending = p;
  return p;
}

function SP_useMyStatus(email) {
  const [, bump] = React.useReducer((x) => x + 1, 0);
  const key = String(email || "").toLowerCase();
  React.useEffect(() => {
    if (!key) return undefined;
    SP_myStore.subs.add(bump);
    SP_loadMy(key, false);
    const onChange = () => SP_loadMy(key, true);
    window.addEventListener(SP_CHANGED_EVENT, onChange);
    return () => {
      SP_myStore.subs.delete(bump);
      window.removeEventListener(SP_CHANGED_EVENT, onChange);
    };
  }, [key]);
  if (!key || SP_myStore.email !== key) return { loaded: false, error: "", data: null };
  return { loaded: SP_myStore.loaded, error: SP_myStore.error, data: SP_myStore.data };
}

function SP_loadAdmin(force) {
  if (SP_adminStore.pending) return SP_adminStore.pending;
  if (!force && SP_adminStore.at && Date.now() - SP_adminStore.at < 60000) return Promise.resolve(SP_adminStore.rows);
  SP_adminStore.pending = SP_api
    .adminList()
    .then((rows) => {
      SP_adminStore.rows = rows;
      SP_adminStore.error = "";
      return rows;
    })
    .catch((e) => {
      // Not an admin (or schema missing): quiet, rows stay null.
      SP_adminStore.rows = null;
      SP_adminStore.error = SP_errText(e);
      return null;
    })
    .finally(() => {
      SP_adminStore.loaded = true;
      SP_adminStore.at = Date.now();
      SP_adminStore.pending = null;
      SP_adminStore.subs.forEach((f) => f());
    });
  return SP_adminStore.pending;
}

function SP_useAdminList(enabled) {
  const [, bump] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    if (!enabled) return undefined;
    SP_adminStore.subs.add(bump);
    SP_loadAdmin(false);
    const onChange = () => SP_loadAdmin(true);
    window.addEventListener(SP_CHANGED_EVENT, onChange);
    return () => {
      SP_adminStore.subs.delete(bump);
      window.removeEventListener(SP_CHANGED_EVENT, onChange);
    };
  }, [!!enabled]);
  if (!enabled) return { loaded: false, error: "", rows: null };
  return { loaded: SP_adminStore.loaded, error: SP_adminStore.error, rows: SP_adminStore.rows };
}
