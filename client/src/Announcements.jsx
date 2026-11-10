import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus, RefreshCw, Send, Pencil, Archive, X } from "lucide-react";

const initial = { title: "", content: "", priority: "normal", audience: "all", department: "", expiresAt: "" };

export default function Announcements({ token, baseUrl, manager }) {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(baseUrl + path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers }
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.message || `Request failed (${response.status})`);
    return json;
  }, [baseUrl, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await request("/announcements");
      setItems(Array.isArray(list) ? list : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!manager) return;
    request("/employees").then((users) => {
      setDepartments([...new Set((Array.isArray(users) ? users : []).map((u) => u.department).filter(Boolean))].sort());
    }).catch(() => {});
  }, [manager, request]);

  const reset = () => { setForm(initial); setEditing(null); };
  const edit = (item) => {
    setEditing(item._id);
    setForm({ title: item.title || "", content: item.content || "", priority: item.priority || "normal", audience: item.audience || "all", department: item.department || "", expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 16) : "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async (e, publish = false) => {
    e.preventDefault();
    setSaving(true); setError(""); setSuccess("");
    try {
      const payload = { ...form, department: form.audience === "all" ? "" : form.department, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null };
      if (editing) {
        await request(`/announcements/${editing}`, { method: "PATCH", body: JSON.stringify(payload) });
        if (publish) await request(`/announcements/${editing}/publish`, { method: "PATCH" });
      } else {
        await request("/announcements", { method: "POST", body: JSON.stringify({ ...payload, status: publish ? "published" : "draft" }) });
      }
      setSuccess(publish ? "Announcement published." : "Draft saved.");
      reset(); await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const changeStatus = async (item, archive = false) => {
    if (archive && !window.confirm(`Archive "${item.title}"?`)) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      await request(`/announcements/${item._id}${archive ? "" : "/publish"}`, { method: archive ? "DELETE" : "PATCH" });
      setSuccess(archive ? "Announcement archived." : "Announcement published.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="announcements-page">
      {error && <div className="ann-alert ann-error" role="alert">{error}</div>}
      {success && <div className="ann-alert ann-success" role="status">{success}</div>}
      {manager && (
        <section className="panel">
          <div className="section-heading"><h3><Megaphone size={19} /> {editing ? "Edit Draft" : "New Announcement"}</h3>{editing && <button className="small" type="button" onClick={reset}><X size={15} /> Cancel</button>}</div>
          <form className="ann-form" onSubmit={(e) => save(e, false)}>
            <label>Title<input required minLength={3} maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Monthly Town Hall" /></label>
            <label>Message<textarea required minLength={5} maxLength={5000} rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Write your announcement..." /></label>
            <div className="ann-form-grid">
              <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label>
              <label>Audience<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value, department: "" })}><option value="all">Everyone</option><option value="department">Specific department</option></select></label>
              {form.audience === "department" && <label>Department<input list="ann-departments" required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Exact department name" /><datalist id="ann-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist></label>}
              <label>Expires (optional)<input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
            </div>
            <div className="ann-actions"><button className="secondary" disabled={saving} type="submit">{editing ? "Save Changes" : "Save Draft"}</button><button className="primary" disabled={saving} type="button" onClick={(e) => save(e, true)}><Send size={16} /> {saving ? "Saving..." : "Publish Now"}</button></div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="section-heading"><h3><Megaphone size={19} /> {manager ? "Manage Announcements" : "Company Announcements"} <span className="count">{items.length}</span></h3><button className="small" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
        {loading && <p className="muted">Loading announcements...</p>}
        {!loading && !items.length && <p className="muted">No announcements available.</p>}
        <div className="ann-list">
          {items.map((item) => (
            <article key={item._id} className="ann-item">
              <div className="ann-item-top"><div className="ann-badges"><span className={`ann-priority ann-${item.priority}`}>{item.priority}</span>{manager && <span className="ann-status">{item.status}</span>}<span className="ann-status">{item.audience === "all" ? "Everyone" : item.department}</span></div><small>{new Date(item.publishedAt || item.createdAt).toLocaleString("en-IN")}</small></div>
              <h4>{item.title}</h4><p className="ann-body">{item.content}</p>
              <div className="ann-item-bottom"><small>By {item.createdBy?.name || "HR Team"}{item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleString("en-IN")}` : ""}</small>{manager && item.status !== "archived" && <div className="ann-actions">{item.status === "draft" && <><button className="small" disabled={saving} onClick={() => edit(item)}><Pencil size={14} /> Edit</button><button className="small green" disabled={saving} onClick={() => changeStatus(item)}><Send size={14} /> Publish</button></>}<button className="small" disabled={saving} onClick={() => changeStatus(item, true)}><Archive size={14} /> Archive</button></div>}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
