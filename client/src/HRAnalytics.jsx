import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Users, Clock3, CalendarDays, Wallet, Download, RefreshCw, FileText } from "lucide-react";

const reports = [
  ["employees", "Employee Directory"],
  ["attendance", "Monthly Attendance"],
  ["leaves", "Leave Summary"],
  ["payroll", "Payroll Summary"]
];
const number = value => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const money = value => `₹${number(value)}`;
const count = (source, key) => {
  if (Array.isArray(source)) return Number(source.find(x => x.name === key)?.count || 0);
  return Number(source?.[key] || 0);
};
function Bars({ rows, color = "#6976e2", empty = "No records for the selected month" }) {
  const entries = Array.isArray(rows) ? rows : Object.entries(rows || {}).map(([name, count]) => ({ name, count }));
  if (!entries.length) return <p className="muted">{empty}</p>;
  const max = Math.max(1, ...entries.map(x => Number(x.count || 0)));
  return <div className="analytics-bars">{entries.map((item, index) => <div className="analytics-bar-row" key={`${item.name}-${index}`}>
    <span title={item.name}>{item.name}</span>
    <div className="analytics-bar-track"><div style={{ width: `${Number(item.count || 0) / max * 100}%`, background: color }} /></div>
    <strong>{number(item.count)}</strong>
  </div>)}</div>;
}
function Stat({ icon: Icon, label, value, detail }) {
  return <div className="analytics-stat"><div className="analytics-stat-icon"><Icon size={20} /></div><div><p>{label}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div></div>;
}
export default function HRAnalytics({ token, baseUrl, initialMonth }) {
  const [month, setMonth] = useState(initialMonth);
  const [department, setDepartment] = useState("");
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [overview, setOverview] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [leaves, setLeaves] = useState(null);
  const [payroll, setPayroll] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");
  const [revision, setRevision] = useState(0);
  const params = useMemo(() => {
    const q = new URLSearchParams({ month });
    if (department) q.set("department", department);
    return q.toString();
  }, [month, department]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const endpoints = ["overview", "employees", "attendance", "leaves", "payroll"];
        const result = await Promise.all(endpoints.map(async name => {
          const response = await fetch(`${baseUrl}/analytics/${name}?${params}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.message || `Unable to load ${name} analytics (${response.status})`);
          return body;
        }));
        if (!controller.signal.aborted) {
          setOverview(result[0]); setEmployees(result[1]); setAttendance(result[2]);
          setLeaves(result[3]); setPayroll(result[4]);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    if (token && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) load();
    return () => controller.abort();
  }, [baseUrl, token, params, revision]);

  async function exportCSV(type) {
    setExporting(type);
    setError("");
    try {
      // Supports both /api/reports/export and /api/analytics/export router configurations.
      let response = await fetch(`${baseUrl}/reports/export?type=${type}&${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 404) {
        response = await fetch(`${baseUrl}/analytics/export?type=${type}&${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `CSV export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `peopleflow-${type}-${month}.csv`;
      document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { setError(err.message); }
    finally { setExporting(""); }
  }

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`${baseUrl}/analytics/employees?month=${encodeURIComponent(month)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
    }).then(async response => {
      if (!response.ok) return;
      const body = await response.json();
      const raw = body.byDepartment || body.departments || {};
      const names = Array.isArray(raw) ? raw.map(x => x.name) : Object.keys(raw);
      if (!controller.signal.aborted) setDepartmentOptions(names.filter(Boolean).sort());
    }).catch(() => {});
    return () => controller.abort();
  }, [baseUrl, token, month]);
  const departments = departmentOptions;
  const trend = attendance?.dailyTrend || attendance?.daily || [];
  const leaveStatuses = leaves?.byStatus || {
    pending: leaves?.pending || 0, approved: leaves?.approved || 0, rejected: leaves?.rejected || 0
  };
  const payrollNet = payroll?.approved?.net ?? payroll?.approvedTotals?.net ?? overview?.payroll?.approvedNet ?? 0;
  const payrollGross = payroll?.approved?.gross ?? payroll?.approvedTotals?.gross ?? 0;
  const payrollDraft = payroll?.draftRecords ?? payroll?.draftCount ?? overview?.payroll?.draftRecords ?? 0;

  return <div className="analytics-page">
    <div className="analytics-toolbar panel">
      <div><h3><BarChart3 size={20} /> Workforce Insights</h3><p className="muted">Live reports from PeopleFlow HRMS</p></div>
      <div className="analytics-controls">
        <label>Month<input aria-label="Analytics month" type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
        <label>Department<select aria-label="Department filter" value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(name => <option key={name} value={name}>{name}</option>)}
          {department && !departments.includes(department) && <option value={department}>{department}</option>}
        </select></label>
        <button className="small" type="button" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} /> Refresh</button>
      </div>
    </div>
    {error && <div className="analytics-error" role="alert">{error}</div>}
    {loading && <p className="muted" role="status">Loading analytics…</p>}
    {!overview && !loading && !error && <p className="muted">No analytics available.</p>}
    {overview && <>
      <div className="analytics-stats">
        <Stat icon={Users} label="Total employees" value={number(overview.employees?.total)} detail={`${number(overview.employees?.active)} active`} />
        <Stat icon={Clock3} label="Monthly check-ins" value={number(overview.attendance?.checkIns)} detail={`${number(overview.attendance?.lateCheckIns)} late arrivals`} />
        <Stat icon={CalendarDays} label="Pending leave requests" value={number(overview.leaves?.pending)} />
        <Stat icon={Wallet} label="Approved net payroll" value={money(payrollNet)} detail={`${number(payrollDraft)} draft records excluded`} />
      </div>
      <div className="analytics-two-col">
        <section className="panel"><h3>Attendance trend</h3><p className="muted">Daily recorded check-ins</p>
          {trend.length ? <div className="analytics-trend" aria-label="Daily attendance chart">{trend.map(day => <div className="analytics-trend-item" key={day.date} title={`${day.date}: ${day.checkIns} check-ins, ${day.late} late`}><div className="analytics-trend-bar" style={{ height: `${Math.max(3, Number(day.checkIns || 0) / Math.max(1, ...trend.map(x => Number(x.checkIns || 0))) * 100)}%` }} /><span>{day.date?.slice(-2)}</span></div>)}</div> : <p className="muted">No attendance recorded for this month.</p>}
        </section>
        <section className="panel"><h3>Employee distribution</h3><p className="muted">Employees by department</p><Bars rows={employees?.byDepartment || employees?.departments} /></section>
        <section className="panel"><h3>Leave requests</h3><p className="muted">Requests overlapping the selected month</p><Bars rows={leaveStatuses} color="#10a67e" /><p className="analytics-footnote">Approved leave days: {number(leaves?.approvedDaysInMonth ?? leaves?.approvedDays)}</p></section>
        <section className="panel"><h3>Payroll summary</h3><div className="analytics-payroll-rows">
          <div><span>Approved gross</span><strong>{money(payrollGross)}</strong></div>
          <div><span>Approved net</span><strong>{money(payrollNet)}</strong></div>
          <div><span>Draft payrolls</span><strong>{number(payrollDraft)}</strong></div>
          <div><span>Approved payrolls</span><strong>{number(payroll?.approvedRecords ?? payroll?.approvedCount ?? overview.payroll?.approvedRecords)}</strong></div>
        </div><p className="analytics-footnote">Draft payroll amounts are not included in approved totals.</p></section>
      </div>
      <section className="panel"><h3>Attendance performance</h3><div className="analytics-stats analytics-mini-stats">
        <Stat icon={Clock3} label="Punctuality" value={attendance?.punctualityRate == null ? "—" : `${number(attendance.punctualityRate)}%`} />
        <Stat icon={Clock3} label="Early exits" value={number(attendance?.earlyExits)} />
        <Stat icon={Clock3} label="Overtime hours" value={number(attendance?.overtimeHours)} />
        <Stat icon={Clock3} label="Completed shifts" value={number(attendance?.completedShifts)} />
      </div><p className="analytics-footnote">Punctuality is based on recorded check-ins. It is not an overall attendance rate because working-day and holiday schedules are not configured.</p></section>
      <section className="panel"><h3><FileText size={19} /> Export reports</h3><p className="muted">Download filtered CSV files for the selected month and department.</p><div className="analytics-export-grid">{reports.map(([type, label]) => <button className="analytics-export-btn" key={type} disabled={Boolean(exporting)} onClick={() => exportCSV(type)}><Download size={17} /> {exporting === type ? "Downloading…" : label}</button>)}</div></section>
    </>}
  </div>;
}
