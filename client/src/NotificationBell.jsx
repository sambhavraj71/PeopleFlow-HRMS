import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";

export default function NotificationBell({ token, baseUrl, onOpenAnnouncements }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(baseUrl + path, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Notification request failed");
    return body;
  }, [baseUrl, token]);
  const refresh = useCallback(async (includeList = false) => {
    try {
      const result = await request("/notifications/unread-count");
      setCount(Number(result.count || 0));
      if (includeList) {
        const notifications = await request("/notifications");
        setItems(Array.isArray(notifications) ? notifications : []);
      }
      setError("");
    } catch (e) { setError(e.message); }
  }, [request]);
  useEffect(() => {
    if (!token) return;
    refresh(true);
    const interval = setInterval(() => refresh(open), 30000);
    return () => clearInterval(interval);
  }, [token, refresh, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const markRead = async (id) => {
    setBusy(true);
    try { await request(`/notifications/${id}/read`, { method: "PATCH" }); await refresh(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const markAll = async () => {
    setBusy(true);
    try { await request("/notifications/read-all", { method: "PATCH" }); await refresh(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="notification-wrap" ref={ref}>
      <button type="button" className="notification-trigger" aria-label={`Notifications, ${count} unread`} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) refresh(true); }}><Bell size={20} />{count > 0 && <span className="notification-count">{count > 99 ? "99+" : count}</span>}</button>
      {open && <div className="notification-popover">
        <div className="notification-head"><strong>Notifications</strong><button type="button" className="notification-close" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={17} /></button></div>
        <div className="notification-subhead"><span>{count} unread</span><button type="button" disabled={!count || busy} onClick={markAll}><CheckCheck size={15} /> Mark all read</button></div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        <div className="notification-list">{items.length ? items.map((n) => <div key={n._id} className={`notification-item ${n.isRead ? "" : "unread"}`}><div className="notification-item-main"><strong>{n.announcement?.title || "Announcement"}</strong><small>{new Date(n.createdAt).toLocaleString("en-IN")}</small><p>{n.announcement?.content || ""}</p></div>{!n.isRead && <button type="button" className="notification-read" disabled={busy} onClick={() => markRead(n._id)}>Mark read</button>}</div>) : <p className="notification-empty">No notifications yet.</p>}</div>
        <button type="button" className="notification-view-all" onClick={() => { setOpen(false); onOpenAnnouncements(); }}>View announcements</button>
      </div>}
    </div>
  );
}
