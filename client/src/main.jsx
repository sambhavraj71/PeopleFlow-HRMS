
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarDays,
  CalendarClock,
  Wallet,
  LogOut,
  Menu,
  CheckCircle2,
  Plus,
  Download,
  ShieldCheck,
  MapPin
} from "lucide-react";
import "./style.css";

const BASE =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      })
    : "—";

const formatMinutes = (value) => {
  const minutes = Number(value || 0);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

function App() {
  const [token, setToken] = useState(
    localStorage.getItem("pf_token") || ""
  );

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pf_user") || "null");
    } catch {
      return null;
    }
  });

  const [page, setPage] = useState("Dashboard");
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(false);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit"
    }).format(now);
  });

  const [gpsConfig, setGpsConfig] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("");

  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [myShift, setMyShift] = useState(null);
  const [editingShift, setEditingShift] = useState(null);

  const manager =
    user?.role === "admin" || user?.role === "hr";

  const api = async (path, options = {}) => {
    const response = await fetch(BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: "Bearer " + token }
          : {}),
        ...(options.headers || {})
      }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.message || "Request failed");
    }

    return body;
  };

  const notify = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 4500);
  };

  const refresh = async (target = page) => {
    try {
      if (target === "Shifts") {
        const [shiftResult, employeeResult] =
          await Promise.all([
            api("/shifts"),
            api("/employees")
          ]);

        setShifts(shiftResult);
        setEmployees(employeeResult);
        return;
      }

      if (target === "Attendance") {
        const [records, availableShifts] =
          await Promise.all([
            api("/attendance?month=" + month),
            api("/shifts")
          ]);

        setData(records);
        setShifts(availableShifts);
        return;
      }

      if (target === "Dashboard") {
        const result = await api("/dashboard");
        setStats(result);

        if (!manager) {
          const [profile, availableShifts] =
            await Promise.all([
              api("/auth/me"),
              api("/shifts")
            ]);

          setUser(profile);
          localStorage.setItem(
            "pf_user",
            JSON.stringify(profile)
          );

          setMyShift(
            availableShifts.find(
              (shift) =>
                shift._id ===
                (typeof profile.shift === "object"
                  ? profile.shift?._id
                  : profile.shift)
            ) || null
          );
        }

        return;
      }

      const path =
        target === "Employees"
          ? "/employees"
          : target === "Leaves"
          ? "/leaves"
          : "/payroll?month=" + month;

      setData(await api(path));
    } catch (error) {
      notify(error.message);
    }
  };

  useEffect(() => {
    if (token) {
      refresh();
    }
  }, [page, token, month]);

  useEffect(() => {
    if (!token || page !== "Attendance") return;

    api("/attendance/config")
      .then(setGpsConfig)
      .catch((error) => notify(error.message));
  }, [page, token]);

  const login = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const f = new FormData(event.currentTarget);

      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password")
        })
      });

      localStorage.setItem("pf_token", result.token);
      localStorage.setItem(
        "pf_user",
        JSON.stringify(result.user)
      );

      setToken(result.token);
      setUser(result.user);
      setPage("Dashboard");

      notify("Welcome back!");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("pf_token");
    localStorage.removeItem("pf_user");

    setToken("");
    setUser(null);
    setPage("Dashboard");
    setData([]);
    setStats(null);
    setShifts([]);
    setEmployees([]);
    setMyShift(null);
  };

  const act = async (
    path,
    body,
    method = "POST"
  ) => {
    setBusy(true);

    try {
      await api(path, {
        method,
        body: body
          ? JSON.stringify(body)
          : undefined
      });

      notify("Saved successfully");
      await refresh();
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ==========================================
  // GPS LOCATION
  // ==========================================

  const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "Your browser does not support GPS location."
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: position.timestamp
          });
        },
        (error) => {
          if (error.code === 1) {
            reject(
              new Error(
                "Please allow location permission."
              )
            );
          } else if (error.code === 2) {
            reject(
              new Error(
                "Location unavailable. Enable location services."
              )
            );
          } else {
            reject(
              new Error(
                "Location request timed out. Try again."
              )
            );
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0
        }
      );
    });
  };

  const gpsAttendance = async (action) => {
    setBusy(true);
    setGpsStatus("Getting current location...");

    try {
      const location = gpsConfig?.gpsEnabled === false
        ? {}
        : await getCurrentLocation();

      setGpsStatus("Submitting attendance...");

      const result = await api(
        `/attendance/${action}`,
        {
          method: "POST",
          body: JSON.stringify(location)
        }
      );

      notify(
        action === "check-in"
          ? "Checked in successfully."
          : "Checked out successfully."
      );

      await refresh("Attendance");
      return result;
    } catch (error) {
      notify(error.message);
    } finally {
      setGpsStatus("");
      setBusy(false);
    }
  };

  // ==========================================
  // EMPLOYEE MANAGEMENT
  // ==========================================

  const addEmployee = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const f = new FormData(form);

    const success = await act("/employees", {
      name: f.get("name"),
      email: f.get("email"),
      password: f.get("password"),
      role: f.get("role"),
      department: f.get("department"),
      designation: f.get("designation"),
      baseSalary: Number(f.get("baseSalary"))
    });

    if (success) form.reset();
  };

  // ==========================================
  // SHIFT MANAGEMENT
  // ==========================================

  const addShift = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const f = new FormData(form);

    const shiftData = {
      name: f.get("name"),
      startTime: f.get("startTime"),
      endTime: f.get("endTime"),
      graceMinutes: Number(f.get("graceMinutes")),
      breakMinutes: Number(f.get("breakMinutes")),
      overtimeEnabled:
        f.get("overtimeEnabled") === "on",
      active: true
    };

    setBusy(true);

    try {
      await api("/shifts", {
        method: "POST",
        body: JSON.stringify(shiftData)
      });

      notify("Shift created successfully");
      form.reset();
      await refresh("Shifts");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const assignShift = async (event) => {
    event.preventDefault();

    const f = new FormData(event.currentTarget);

    setBusy(true);

    try {
      await api(
        `/employees/${f.get("employeeId")}/shift`,
        {
          method: "PATCH",
          body: JSON.stringify({
            shiftId: f.get("shiftId") || null
          })
        }
      );

      notify("Employee shift updated successfully");
      await refresh("Shifts");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const updateShiftStatus = async (shift) => {
    setBusy(true);

    try {
      await api(`/shifts/${shift._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          active: !shift.active
        })
      });

      notify("Shift status updated");
      await refresh("Shifts");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveShiftEdit = async (event) => {
    event.preventDefault();

    if (!editingShift) return;

    const f = new FormData(event.currentTarget);

    setBusy(true);

    try {
      await api(`/shifts/${editingShift._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: f.get("name"),
          startTime: f.get("startTime"),
          endTime: f.get("endTime"),
          graceMinutes: Number(f.get("graceMinutes")),
          breakMinutes: Number(f.get("breakMinutes")),
          overtimeEnabled:
            f.get("overtimeEnabled") === "on"
        })
      });

      setEditingShift(null);
      notify("Shift updated successfully");
      await refresh("Shifts");
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const getEmployeeShift = (employee) => {
    const shiftId =
      typeof employee.shift === "object"
        ? employee.shift?._id
        : employee.shift;

    return shifts.find(
      (shift) => shift._id === shiftId
    );
  };

  // ==========================================
  // LEAVE MANAGEMENT
  // ==========================================

  const addLeave = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const f = new FormData(form);

    const success = await act("/leaves", {
      type: f.get("type"),
      from: f.get("from"),
      to: f.get("to"),
      reason: f.get("reason")
    });

    if (success) form.reset();
  };

  // ==========================================
  // PAYROLL MANAGEMENT
  // ==========================================

  const generate = async (event) => {
    event.preventDefault();

    const f = new FormData(event.currentTarget);

    await act("/payroll/generate", {
      month,
      allowances: Number(f.get("allowances") || 0),
      bonus: Number(f.get("bonus") || 0),
      deductions: Number(f.get("deductions") || 0)
    });
  };

  const payslip = async (id) => {
    try {
      const response = await fetch(
        BASE + `/payroll/${id}/payslip`,
        {
          headers: {
            Authorization: "Bearer " + token
          }
        }
      );

      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          body.message || "Download failed"
        );
      }

      const url = URL.createObjectURL(
        await response.blob()
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = "payslip.pdf";
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(error.message);
    }
  };

  // ==========================================
  // NAVIGATION
  // ==========================================

  const nav = [
    ["Dashboard", LayoutDashboard],
    ...(manager
      ? [
          ["Employees", Users],
          ["Shifts", CalendarClock]
        ]
      : []),
    ["Attendance", Clock],
    ["Leaves", CalendarDays],
    ["Payroll", Wallet]
  ];

  // ==========================================
  // LOGIN PAGE
  // ==========================================

  if (!token) {
    return (
      <div className="login-bg">
        <div className="login-card">
          <div className="brand">
            <div className="brand-mark">P</div>
            <span>PeopleFlow</span>
          </div>

          <h1>Welcome back</h1>

          <p className="muted">
            Sign in to your HR workspace
          </p>

          <form
            onSubmit={login}
            className="stack"
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                placeholder="admin@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                placeholder="Your password"
                required
              />
            </label>

            <button
              disabled={busy}
              className="primary"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="hint">
            First time? Run the server seed command
            to create your admin account.
          </p>

          {message && (
            <div className="toast">{message}</div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN APPLICATION
  // ==========================================

  return (
    <div className="app">
      <aside
        className={
          "sidebar " + (sidebar ? "show" : "")
        }
      >
        <div className="brand">
          <div className="brand-mark">P</div>
          <span>PeopleFlow</span>
        </div>

        <p className="side-label">WORKSPACE</p>

        <nav>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={
                "nav-item " +
                (page === label ? "active" : "")
              }
              onClick={() => {
                setPage(label);
                setSidebar(false);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">
              {user?.name?.[0]}
            </div>

            <div>
              <strong>{user?.name}</strong>
              <small>{user?.role}</small>
            </div>
          </div>

          <button
            className="nav-item"
            onClick={logout}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header>
          <button
            className="menu-btn"
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={22} />
          </button>

          <div>
            <div className="eyebrow">
              HR MANAGEMENT
            </div>
            <h1>{page}</h1>
          </div>

          <div className="header-right">
            <span className="role-pill">
              <ShieldCheck size={14} />
              {user?.role}
            </span>

            <div className="avatar">
              {user?.name?.[0]}
            </div>
          </div>
        </header>

        <div className="content">
          {message && (
            <div className="notice">{message}</div>
          )}

          {/* ===================================
              DASHBOARD
          =================================== */}

          {page === "Dashboard" && (
            <>
              <div className="welcome">
                <div>
                  <p>WORKFORCE OVERVIEW</p>

                  <h2>
                    Hello, {user?.name?.split(" ")[0]} 👋
                  </h2>

                  <span>
                    Here's what's happening across
                    your workspace today.
                  </span>
                </div>

                <div className="welcome-art">✦</div>
              </div>

              <div className="metrics">
                <Metric
                  title={
                    manager
                      ? "Active employees"
                      : "Your profile"
                  }
                  value={stats?.employees || 0}
                  icon={<Users />}
                />

                <Metric
                  title="Pending leave requests"
                  value={stats?.pendingLeaves || 0}
                  icon={<CalendarDays />}
                />

                <Metric
                  title={
                    manager
                      ? "Checked in today"
                      : "Your check-ins today"
                  }
                  value={stats?.attendanceToday || 0}
                  icon={<Clock />}
                />
              </div>

              {!manager && (
                <section className="panel">
                  <h3>
                    <CalendarClock size={19} />
                    My Assigned Shift
                  </h3>

                  {myShift ? (
                    <div className="metrics">
                      <Metric
                        title="Shift Name"
                        value={myShift.name}
                        icon={<CalendarClock />}
                      />

                      <Metric
                        title="Working Hours"
                        value={`${myShift.startTime} - ${myShift.endTime}`}
                        icon={<Clock />}
                      />

                      <Metric
                        title="Grace Period"
                        value={`${myShift.graceMinutes} min`}
                        icon={<CheckCircle2 />}
                      />
                    </div>
                  ) : (
                    <p className="muted">
                      No shift assigned yet.
                      Please contact HR.
                    </p>
                  )}
                </section>
              )}

              <section className="panel">
                <h3>Recent payroll</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Month</th>
                        <th>Net salary</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {stats?.latestPayroll?.map((p) => (
                        <tr key={p._id}>
                          <td>{p.employee?.name}</td>
                          <td>{p.month}</td>
                          <td>{fmt(p.net)}</td>
                          <td>
                            <Status value={p.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!stats?.latestPayroll?.length && (
                  <Empty />
                )}
              </section>
            </>
          )}

          {/* ===================================
              EMPLOYEES
          =================================== */}

          {page === "Employees" && manager && (
            <>
              <section className="panel">
                <h3>
                  <Plus size={19} />
                  Add employee
                </h3>

                <form
                  className="form-grid"
                  onSubmit={addEmployee}
                >
                  <input
                    name="name"
                    placeholder="Full name"
                    required
                    minLength={2}
                  />

                  <input
                    name="email"
                    type="email"
                    placeholder="Email address"
                    required
                  />

                  <input
                    name="password"
                    type="password"
                    placeholder="Initial password (8+ chars)"
                    required
                    minLength={8}
                  />

                  <select name="role">
                    <option value="employee">
                      Employee
                    </option>
                    <option value="hr">HR</option>
                    {user.role === "admin" && (
                      <option value="admin">
                        Admin
                      </option>
                    )}
                  </select>

                  <input
                    name="department"
                    placeholder="Department"
                    defaultValue="General"
                  />

                  <input
                    name="designation"
                    placeholder="Designation"
                    defaultValue="Staff"
                  />

                  <input
                    name="baseSalary"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Monthly basic salary"
                    required
                  />

                  <button
                    className="primary"
                    disabled={busy}
                  >
                    Create employee
                  </button>
                </form>
              </section>

              <section className="panel">
                <h3>
                  Employee directory
                  <span className="count">
                    {data.length}
                  </span>
                </h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Department</th>
                        <th>Role</th>
                        <th>Basic salary</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <strong>{u.name}</strong>
                            <small className="subtext">
                              {u.designation}
                            </small>
                          </td>
                          <td>{u.email}</td>
                          <td>{u.department}</td>
                          <td>{u.role}</td>
                          <td>{fmt(u.baseSalary)}</td>
                          <td>
                            <Status
                              value={
                                u.active
                                  ? "active"
                                  : "inactive"
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!data.length && <Empty />}
              </section>
            </>
          )}

          {/* ===================================
              SHIFT MANAGEMENT
          =================================== */}

          {page === "Shifts" && manager && (
            <>
              <section className="panel">
                <h3>
                  <Plus size={19} />
                  Create New Shift
                </h3>

                <p className="muted">
                  Configure employee working hours,
                  grace period and overtime.
                </p>

                <form
                  className="form-grid"
                  onSubmit={addShift}
                >
                  <input
                    name="name"
                    placeholder="Shift Name"
                    minLength={2}
                    required
                  />

                  <label>
                    Start Time
                    <input
                      type="time"
                      name="startTime"
                      defaultValue="09:00"
                      required
                    />
                  </label>

                  <label>
                    End Time
                    <input
                      type="time"
                      name="endTime"
                      defaultValue="18:00"
                      required
                    />
                  </label>

                  <label>
                    Grace Period (Minutes)
                    <input
                      type="number"
                      name="graceMinutes"
                      min="0"
                      max="180"
                      defaultValue="10"
                      required
                    />
                  </label>

                  <label>
                    Break Duration (Minutes)
                    <input
                      type="number"
                      name="breakMinutes"
                      min="0"
                      max="1440"
                      defaultValue="60"
                      required
                    />
                  </label>

                  <label className="shift-check">
                    <input
                      type="checkbox"
                      name="overtimeEnabled"
                      defaultChecked
                    />
                    Enable Overtime
                  </label>

                  <button
                    className="primary"
                    disabled={busy}
                  >
                    <Plus size={16} />
                    Create Shift
                  </button>
                </form>
              </section>

              <section className="panel">
                <h3>
                  Available Shifts
                  <span className="count">
                    {shifts.length}
                  </span>
                </h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Shift Name</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Grace</th>
                        <th>Break</th>
                        <th>Overtime</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {shifts.map((shift) => (
                        <tr key={shift._id}>
                          <td>
                            <strong>{shift.name}</strong>
                          </td>
                          <td>{shift.startTime}</td>
                          <td>{shift.endTime}</td>
                          <td>
                            {shift.graceMinutes} min
                          </td>
                          <td>
                            {shift.breakMinutes} min
                          </td>
                          <td>
                            {shift.overtimeEnabled
                              ? "Enabled"
                              : "Disabled"}
                          </td>
                          <td>
                            <Status
                              value={
                                shift.active
                                  ? "active"
                                  : "inactive"
                              }
                            />
                          </td>
                          <td>
                            <div className="actions">
                              <button
                                className="small"
                                disabled={busy}
                                onClick={() =>
                                  setEditingShift(shift)
                                }
                              >
                                Edit
                              </button>

                              <button
                                className="small"
                                disabled={busy}
                                onClick={() =>
                                  updateShiftStatus(shift)
                                }
                              >
                                {shift.active
                                  ? "Deactivate"
                                  : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!shifts.length && <Empty />}
              </section>

              {editingShift && (
                <section className="panel">
                  <div className="section-heading">
                    <h3>
                      Edit Shift: {editingShift.name}
                    </h3>

                    <button
                      className="small"
                      onClick={() =>
                        setEditingShift(null)
                      }
                    >
                      Cancel
                    </button>
                  </div>

                  <form
                    key={editingShift._id}
                    className="form-grid"
                    onSubmit={saveShiftEdit}
                  >
                    <input
                      name="name"
                      defaultValue={editingShift.name}
                      required
                    />

                    <label>
                      Start Time
                      <input
                        type="time"
                        name="startTime"
                        defaultValue={
                          editingShift.startTime
                        }
                        required
                      />
                    </label>

                    <label>
                      End Time
                      <input
                        type="time"
                        name="endTime"
                        defaultValue={
                          editingShift.endTime
                        }
                        required
                      />
                    </label>

                    <label>
                      Grace Minutes
                      <input
                        type="number"
                        name="graceMinutes"
                        defaultValue={
                          editingShift.graceMinutes
                        }
                        min="0"
                        required
                      />
                    </label>

                    <label>
                      Break Minutes
                      <input
                        type="number"
                        name="breakMinutes"
                        defaultValue={
                          editingShift.breakMinutes
                        }
                        min="0"
                        required
                      />
                    </label>

                    <label className="shift-check">
                      <input
                        type="checkbox"
                        name="overtimeEnabled"
                        defaultChecked={
                          editingShift.overtimeEnabled
                        }
                      />
                      Enable Overtime
                    </label>

                    <button
                      className="primary"
                      disabled={busy}
                    >
                      Save Changes
                    </button>
                  </form>
                </section>
              )}

              <section className="panel">
                <h3>
                  <Users size={19} />
                  Assign Employee Shift
                </h3>

                <form
                  className="form-grid"
                  onSubmit={assignShift}
                >
                  <label>
                    Select Employee
                    <select
                      name="employeeId"
                      required
                      defaultValue=""
                    >
                      <option value="">
                        Choose Employee
                      </option>

                      {employees.map((employee) => (
                        <option
                          key={employee.id}
                          value={employee.id}
                        >
                          {employee.name} -{" "}
                          {employee.department}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Select Shift
                    <select
                      name="shiftId"
                      required
                      defaultValue=""
                    >
                      <option value="">
                        Choose Shift
                      </option>

                      {shifts
                        .filter((shift) => shift.active)
                        .map((shift) => (
                          <option
                            key={shift._id}
                            value={shift._id}
                          >
                            {shift.name} (
                            {shift.startTime} -{" "}
                            {shift.endTime})
                          </option>
                        ))}
                    </select>
                  </label>

                  <button
                    className="primary"
                    disabled={busy}
                  >
                    Assign Shift
                  </button>
                </form>
              </section>

              <section className="panel">
                <h3>Employee Shift Directory</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Assigned Shift</th>
                        <th>Working Hours</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {employees.map((employee) => {
                        const shift =
                          getEmployeeShift(employee);

                        return (
                          <tr key={employee.id}>
                            <td>
                              <strong>
                                {employee.name}
                              </strong>
                            </td>

                            <td>
                              {employee.department}
                            </td>

                            <td>
                              {shift?.name ||
                                "Not Assigned"}
                            </td>

                            <td>
                              {shift
                                ? `${shift.startTime} - ${shift.endTime}`
                                : "—"}
                            </td>

                            <td>
                              <Status
                                value={
                                  shift
                                    ? "assigned"
                                    : "unassigned"
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {!employees.length && <Empty />}
              </section>
            </>
          )}

          {/* ===================================
              GPS ATTENDANCE
          =================================== */}

          {page === "Attendance" && (
            <>
              <section className="panel action-bar">
                <div>
                  <h3>Attendance Tracker</h3>

                  <p className="muted">
                    Check in and out to record
                    your workday.
                  </p>

                  <p className="muted">
                    <MapPin
                      size={14}
                      style={{
                        verticalAlign: "middle",
                        marginRight: 5
                      }}
                    />

                    {gpsConfig
                      ? gpsConfig.gpsEnabled
                        ? `GPS required • Office radius ${gpsConfig.officeRadiusMeters} m • Maximum accuracy ${gpsConfig.maxAccuracyMeters} m`
                        : "GPS verification disabled"
                      : "Loading GPS policy..."}
                  </p>

                  {gpsStatus && (
                    <p
                      className="muted"
                      role="status"
                    >
                      {gpsStatus}
                    </p>
                  )}
                </div>

                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      gpsAttendance("check-in")
                    }
                  >
                    Check In
                  </button>

                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      gpsAttendance("check-out")
                    }
                  >
                    Check Out
                  </button>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading">
                  <h3>Attendance Records</h3>

                  <input
                    type="month"
                    value={month}
                    onChange={(event) =>
                      setMonth(event.target.value)
                    }
                  />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Date</th>
                        <th>Shift</th>
                        <th>Check In</th>
                        <th>Check Out</th>
                        <th>Late</th>
                        <th>Early Exit</th>
                        <th>Working Hours</th>
                        <th>Overtime</th>
                        <th>GPS</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.map((a) => (
                        <tr key={a._id}>
                          <td>
                            {a.employee?.name ||
                              "Employee"}
                          </td>

                          <td>{a.date}</td>

                          <td>
                            {a.shiftSnapshot?.name ||
                              a.shift?.name ||
                              "Not Assigned"}
                          </td>

                          <td>
                            {formatTime(a.checkIn)}
                          </td>

                          <td>
                            {formatTime(a.checkOut)}
                          </td>

                          <td>
                            {a.lateMinutes || 0} min
                          </td>

                          <td>
                            {a.earlyExitMinutes || 0} min
                          </td>

                          <td>
                            {a.checkOut
                              ? formatMinutes(
                                  a.workingMinutes
                                )
                              : "—"}
                          </td>

                          <td>
                            {a.overtimeMinutes || 0} min
                          </td>

                          <td>
                            {a.checkInLocation
                              ? `Verified (${a.checkInLocation.distanceMeters} m)`
                              : "Not recorded"}
                          </td>

                          <td>
                            <Status
                              value={
                                a.attendanceStatus &&
                                a.attendanceStatus !==
                                  "unassigned"
                                  ? a.attendanceStatus
                                  : a.checkOut
                                  ? "completed"
                                  : "checked in"
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!data.length && <Empty />}
              </section>
            </>
          )}

          {/* ===================================
              LEAVE MANAGEMENT
          =================================== */}

          {page === "Leaves" && (
            <>
              <section className="panel">
                <h3>
                  <Plus size={19} />
                  Request Leave
                </h3>

                <form
                  className="form-grid"
                  onSubmit={addLeave}
                >
                  <select name="type">
                    <option value="annual">
                      Annual
                    </option>
                    <option value="sick">
                      Sick
                    </option>
                    <option value="casual">
                      Casual
                    </option>
                    <option value="unpaid">
                      Unpaid
                    </option>
                  </select>

                  <input
                    name="from"
                    type="date"
                    required
                  />

                  <input
                    name="to"
                    type="date"
                    required
                  />

                  <input
                    name="reason"
                    placeholder="Reason for leave"
                    minLength={3}
                    required
                  />

                  <button
                    className="primary"
                    disabled={busy}
                  >
                    Submit Request
                  </button>
                </form>
              </section>

              <section className="panel">
                <h3>Leave Requests</h3>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Type</th>
                        <th>Dates</th>
                        <th>Days</th>
                        <th>Status</th>
                        {manager && (
                          <th>Review</th>
                        )}
                      </tr>
                    </thead>

                    <tbody>
                      {data.map((l) => (
                        <tr key={l._id}>
                          <td>
                            {l.employee?.name}
                          </td>

                          <td className="capitalize">
                            {l.type}
                          </td>

                          <td>
                            {l.from} → {l.to}
                          </td>

                          <td>{l.days}</td>

                          <td>
                            <Status value={l.status} />
                          </td>

                          {manager && (
                            <td>
                              {l.status === "pending" &&
                              l.employee?._id !==
                                user.id ? (
                                <div className="actions">
                                  <button
                                    className="small green"
                                    disabled={busy}
                                    onClick={() =>
                                      act(
                                        `/leaves/${l._id}/status`,
                                        {
                                          status:
                                            "approved"
                                        },
                                        "PATCH"
                                      )
                                    }
                                  >
                                    Approve
                                  </button>

                                  <button
                                    className="small"
                                    disabled={busy}
                                    onClick={() =>
                                      act(
                                        `/leaves/${l._id}/status`,
                                        {
                                          status:
                                            "rejected"
                                        },
                                        "PATCH"
                                      )
                                    }
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!data.length && <Empty />}
              </section>
            </>
          )}

          {/* ===================================
              PAYROLL
          =================================== */}

          {page === "Payroll" && (
            <>
              {manager && (
                <section className="panel">
                  <h3>
                    <Plus size={19} />
                    Generate Monthly Payroll
                  </h3>

                  <p className="muted">
                    Generates draft payroll for
                    active employees. Approved unpaid
                    leave reduces pay.
                  </p>

                  <form
                    className="form-grid"
                    onSubmit={generate}
                  >
                    <input
                      type="month"
                      value={month}
                      onChange={(event) =>
                        setMonth(event.target.value)
                      }
                      required
                    />

                    <input
                      type="number"
                      name="allowances"
                      placeholder="Allowances (₹)"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                    />

                    <input
                      type="number"
                      name="bonus"
                      placeholder="Bonus (₹)"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                    />

                    <input
                      type="number"
                      name="deductions"
                      placeholder="Other deductions (₹)"
                      min="0"
                      step="0.01"
                      defaultValue="0"
                    />

                    <button
                      className="primary"
                      disabled={busy}
                    >
                      Generate Drafts
                    </button>
                  </form>
                </section>
              )}

              <section className="panel">
                <div className="section-heading">
                  <h3>Payroll Records</h3>

                  <input
                    type="month"
                    value={month}
                    onChange={(event) =>
                      setMonth(event.target.value)
                    }
                  />
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Month</th>
                        <th>Gross</th>
                        <th>Deductions</th>
                        <th>Net Pay</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>

                    <tbody>
                      {data.map((p) => (
                        <tr key={p._id}>
                          <td>
                            {p.employee?.name}
                          </td>

                          <td>{p.month}</td>

                          <td>
                            {fmt(p.gross)}
                          </td>

                          <td>
                            {fmt(
                              Number(
                                p.deductions || 0
                              ) +
                                Number(
                                  p.unpaidLeaveDeduction ||
                                    0
                                )
                            )}
                          </td>

                          <td>
                            <strong>
                              {fmt(p.net)}
                            </strong>
                          </td>

                          <td>
                            <Status value={p.status} />
                          </td>

                          <td>
                            {p.status === "approved" ? (
                              <button
                                className="small"
                                onClick={() =>
                                  payslip(p._id)
                                }
                              >
                                <Download size={14} />
                                Payslip
                              </button>
                            ) : manager ? (
                              <button
                                className="small green"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    `/payroll/${p._id}/approve`
                                  )
                                }
                              >
                                Approve
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!data.length && <Empty />}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ==========================================
// REUSABLE COMPONENTS
// ==========================================

function Metric({ title, value, icon }) {
  return (
    <div className="metric">
      <div className="metric-icon">
        {icon}
      </div>

      <div>
        <p>{title}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function Status({ value }) {
  const good = [
    "approved",
    "active",
    "completed",
    "on-time",
    "assigned"
  ];

  const bad = [
    "rejected",
    "inactive",
    "late",
    "early-exit",
    "late-and-early-exit"
  ];

  const type = good.includes(value)
    ? "good"
    : bad.includes(value)
    ? "bad"
    : "pending";

  return (
    <span className={"status " + type}>
      {value || "pending"}
    </span>
  );
}

function Empty() {
  return (
    <div className="empty">
      <CheckCircle2 size={24} />
      <p>No records to show yet.</p>
    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);
