import { Router } from "express";
import { z } from "zod";
import {
  User,
  Attendance,
  Leave,
  Payroll,
  Shift,
  EmployeeDocument
} from "./models.js";

const router = Router();

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const reportTypes = [
  "employees",
  "attendance",
  "late-overtime",
  "leaves",
  "payroll"
];

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.SHIFT_TIMEZONE || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;

  return `${year}-${month}`;
}

function getFilters(req) {
  const month = req.query.month || currentMonth();

  if (!monthSchema.safeParse(month).success) {
    throw badRequest("Invalid month. Use YYYY-MM format.");
  }

  const department =
    typeof req.query.department === "string"
      ? req.query.department.trim()
      : "";

  if (department.length > 100) {
    throw badRequest("Department name is too long");
  }

  const [year, monthNumber] = month.split("-").map(Number);

  const lastDay = new Date(
    Date.UTC(year, monthNumber, 0)
  ).getUTCDate();

  return {
    month,
    department,
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`
  };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sum(records, field) {
  return records.reduce(
    (total, record) => total + (Number(record[field]) || 0),
    0
  );
}

function countBy(records, field) {
  const result = {};

  for (const record of records) {
    const key = String(record[field] || "Unknown");
    result[key] = (result[key] || 0) + 1;
  }

  return Object.entries(result)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function getMonthDays(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return Array.from({ length: days }, (_, index) => {
    return `${month}-${String(index + 1).padStart(2, "0")}`;
  });
}

function overlappingDays(from, to, start, end) {
  const a = from > start ? from : start;
  const b = to < end ? to : end;

  if (a > b) return 0;

  return (
    Math.round(
      (
        Date.parse(`${b}T00:00:00Z`) -
        Date.parse(`${a}T00:00:00Z`)
      ) / 86400000
    ) + 1
  );
}

async function loadAnalyticsData(filters) {
  const userFilter = filters.department
    ? { department: filters.department }
    : {};

  const users = await User.find(userFilter)
    .select("name email role department designation joiningDate active shift")
    .lean();

  const ids = users.map(user => user._id);

  const employeeFilter = {
    employee: { $in: ids }
  };

  const [attendance, leaves, payroll, documents, shifts] =
    await Promise.all([
      Attendance.find({
        ...employeeFilter,
        date: { $gte: filters.start, $lte: filters.end }
      }).lean(),

      Leave.find({
        ...employeeFilter,
        from: { $lte: filters.end },
        to: { $gte: filters.start }
      }).lean(),

      Payroll.find({
        ...employeeFilter,
        month: filters.month
      }).lean(),

      EmployeeDocument.find(employeeFilter)
        .select("employee status documentType")
        .lean(),

      Shift.find()
        .select("name active")
        .lean()
    ]);

  return {
    users,
    attendance,
    leaves,
    payroll,
    documents,
    shifts
  };
}

function employeeAnalytics(data, filters) {
  const users = data.users;

  const active = users.filter(user => user.active).length;
  const inactive = users.length - active;

  const newJoiners = users.filter(user => {
    if (!user.joiningDate) return false;

    const joiningDate = new Date(user.joiningDate)
      .toISOString()
      .slice(0, 10);

    return (
      joiningDate >= filters.start &&
      joiningDate <= filters.end
    );
  }).length;

  const shiftCounts = new Map();

  for (const user of users) {
    if (!user.shift) continue;

    const key = String(user.shift);

    shiftCounts.set(
      key,
      (shiftCounts.get(key) || 0) + 1
    );
  }

  const shiftDistribution = data.shifts.map(shift => ({
    shiftId: String(shift._id),
    name: shift.name,
    active: shift.active,
    employees: shiftCounts.get(String(shift._id)) || 0
  }));

  return {
    total: users.length,
    active,
    inactive,
    newJoiners,
    departments: countBy(users, "department"),
    roles: countBy(users, "role"),
    designations: countBy(users, "designation"),
    shiftDistribution,
    unassignedShift: users.filter(user => !user.shift).length
  };
}

function attendanceAnalytics(data, filters) {
  const records = data.attendance;

  const lateRecords = records.filter(
    record => (record.lateMinutes || 0) > 0
  );

  const earlyRecords = records.filter(
    record => (record.earlyExitMinutes || 0) > 0
  );

  const completed = records.filter(
    record => record.checkOut != null
  );

  const assigned = records.filter(
    record => record.shiftSnapshot?.startTime
  );

  const onTime = assigned.filter(
    record => (record.lateMinutes || 0) === 0
  ).length;

  const punctualityRate = assigned.length
    ? round((onTime / assigned.length) * 100)
    : null;

  const days = getMonthDays(filters.month);

  const daily = days.map(date => {
    const dayRecords = records.filter(
      record => record.date === date
    );

    return {
      date,
      checkIns: dayRecords.length,
      late: dayRecords.filter(
        record => (record.lateMinutes || 0) > 0
      ).length,
      earlyExits: dayRecords.filter(
        record => (record.earlyExitMinutes || 0) > 0
      ).length,
      completed: dayRecords.filter(
        record => record.checkOut != null
      ).length
    };
  });

  const byEmployee = new Map();

  for (const record of records) {
    const key = String(record.employee);

    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employeeId: key,
        checkIns: 0,
        lateCheckIns: 0,
        earlyExits: 0,
        workingMinutes: 0,
        overtimeMinutes: 0
      });
    }

    const item = byEmployee.get(key);

    item.checkIns++;

    if ((record.lateMinutes || 0) > 0) {
      item.lateCheckIns++;
    }

    if ((record.earlyExitMinutes || 0) > 0) {
      item.earlyExits++;
    }

    item.workingMinutes += record.workingMinutes || 0;
    item.overtimeMinutes += record.overtimeMinutes || 0;
  }

  const userMap = new Map(
    data.users.map(user => [String(user._id), user])
  );

  const employeeBreakdown = [...byEmployee.values()].map(item => {
    const user = userMap.get(item.employeeId);

    return {
      employeeId: item.employeeId,
      name: user?.name || "Unknown",
      department: user?.department || "Unknown",
      checkIns: item.checkIns,
      lateCheckIns: item.lateCheckIns,
      earlyExits: item.earlyExits,
      workingHours: round(item.workingMinutes / 60),
      overtimeHours: round(item.overtimeMinutes / 60)
    };
  });

  return {
    checkIns: records.length,
    uniqueEmployeesPresent: byEmployee.size,
    completedShifts: completed.length,
    openShifts: records.length - completed.length,
    lateCheckIns: lateRecords.length,
    earlyExits: earlyRecords.length,
    lateMinutes: sum(records, "lateMinutes"),
    earlyExitMinutes: sum(records, "earlyExitMinutes"),
    workingHours: round(sum(records, "workingMinutes") / 60),
    overtimeHours: round(sum(records, "overtimeMinutes") / 60),
    punctualityRate,
    punctualityDenominator: assigned.length,
    daily,
    employeeBreakdown
  };
}

function leaveAnalytics(data, filters) {
  const records = data.leaves;

  const statusCounts = {
    pending: 0,
    approved: 0,
    rejected: 0
  };

  const typeCounts = {
    annual: 0,
    sick: 0,
    casual: 0,
    unpaid: 0
  };

  let approvedDays = 0;
  let pendingDays = 0;
  let rejectedDays = 0;

  for (const leave of records) {
    const days = overlappingDays(
      leave.from,
      leave.to,
      filters.start,
      filters.end
    );

    if (leave.status in statusCounts) {
      statusCounts[leave.status]++;
    }

    if (leave.type in typeCounts) {
      typeCounts[leave.type]++;
    }

    if (leave.status === "approved") {
      approvedDays += days;
    } else if (leave.status === "pending") {
      pendingDays += days;
    } else if (leave.status === "rejected") {
      rejectedDays += days;
    }
  }

  return {
    totalRequests: records.length,
    ...statusCounts,
    approvedDays,
    pendingDays,
    rejectedDays,
    byType: Object.entries(typeCounts).map(
      ([name, count]) => ({ name, count })
    )
  };
}

function payrollAnalytics(data) {
  const records = data.payroll;

  const approved = records.filter(
    record => record.status === "approved"
  );

  const draft = records.filter(
    record => record.status === "draft"
  );

  const totals = records => ({
    basic: round(sum(records, "basic")),
    allowances: round(sum(records, "allowances")),
    bonus: round(sum(records, "bonus")),
    deductions: round(sum(records, "deductions")),
    unpaidLeaveDeduction: round(
      sum(records, "unpaidLeaveDeduction")
    ),
    gross: round(sum(records, "gross")),
    net: round(sum(records, "net"))
  });

  const userMap = new Map(
    data.users.map(user => [String(user._id), user])
  );

  const departments = new Map();

  for (const record of records) {
    const user = userMap.get(String(record.employee));
    const department = user?.department || "Unknown";

    if (!departments.has(department)) {
      departments.set(department, {
        department,
        employees: 0,
        gross: 0,
        net: 0
      });
    }

    const item = departments.get(department);

    item.employees++;
    item.gross += record.gross || 0;
    item.net += record.net || 0;
  }

  return {
    totalRecords: records.length,
    approvedCount: approved.length,
    draftCount: draft.length,
    totals: totals(records),
    approvedTotals: totals(approved),
    draftTotals: totals(draft),
    byDepartment: [...departments.values()].map(item => ({
      ...item,
      gross: round(item.gross),
      net: round(item.net)
    }))
  };
}

function documentAnalytics(data) {
  const documents = data.documents;

  return {
    total: documents.length,
    pending: documents.filter(
      document => document.status === "pending"
    ).length,
    verified: documents.filter(
      document => document.status === "verified"
    ).length,
    rejected: documents.filter(
      document => document.status === "rejected"
    ).length,
    byType: countBy(documents, "documentType")
  };
}

async function getReportData(req) {
  const filters = getFilters(req);
  const data = await loadAnalyticsData(filters);

  return {
    filters,
    data,
    employees: employeeAnalytics(data, filters),
    attendance: attendanceAnalytics(data, filters),
    leaves: leaveAnalytics(data, filters),
    payroll: payrollAnalytics(data),
    documents: documentAnalytics(data)
  };
}

function csvCell(value) {
  let text = String(value ?? "");

  // Prevent spreadsheet formula injection.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function makeCSV(headers, rows) {
  return [
    headers.map(csvCell).join(","),
    ...rows.map(row => row.map(csvCell).join(","))
  ].join("\r\n");
}

function createExport(type, report) {
  const { data, filters } = report;

  const users = new Map(
    data.users.map(user => [String(user._id), user])
  );

  if (type === "employees") {
    return makeCSV(
      [
        "Name", "Email", "Role", "Department",
        "Designation", "Joining Date", "Status"
      ],
      data.users.map(user => [
        user.name,
        user.email,
        user.role,
        user.department,
        user.designation,
        user.joiningDate
          ? new Date(user.joiningDate).toISOString().slice(0, 10)
          : "",
        user.active ? "Active" : "Inactive"
      ])
    );
  }

  if (type === "attendance" || type === "late-overtime") {
    const records = type === "late-overtime"
      ? data.attendance.filter(record =>
          (record.lateMinutes || 0) > 0 ||
          (record.earlyExitMinutes || 0) > 0 ||
          (record.overtimeMinutes || 0) > 0
        )
      : data.attendance;

    return makeCSV(
      [
        "Employee", "Department", "Date",
        "Check In", "Check Out", "Status",
        "Late Minutes", "Early Exit Minutes",
        "Working Minutes", "Overtime Minutes"
      ],
      records.map(record => {
        const user = users.get(String(record.employee));

        return [
          user?.name || "Unknown",
          user?.department || "Unknown",
          record.date,
          record.checkIn?.toISOString() || "",
          record.checkOut?.toISOString() || "",
          record.attendanceStatus,
          record.lateMinutes,
          record.earlyExitMinutes,
          record.workingMinutes,
          record.overtimeMinutes
        ];
      })
    );
  }

  if (type === "leaves") {
    return makeCSV(
      [
        "Employee", "Department", "Type",
        "From", "To", "Days In Month",
        "Status"
      ],
      data.leaves.map(leave => {
        const user = users.get(String(leave.employee));

        return [
          user?.name || "Unknown",
          user?.department || "Unknown",
          leave.type,
          leave.from,
          leave.to,
          overlappingDays(
            leave.from,
            leave.to,
            filters.start,
            filters.end
          ),
          leave.status
        ];
      })
    );
  }

  if (type === "payroll") {
    return makeCSV(
      [
        "Employee", "Department", "Month",
        "Basic", "Allowances", "Bonus",
        "Deductions", "Unpaid Leave Deduction",
        "Gross", "Net", "Status"
      ],
      data.payroll.map(record => {
        const user = users.get(String(record.employee));

        return [
          user?.name || "Unknown",
          user?.department || "Unknown",
          record.month,
          record.basic,
          record.allowances,
          record.bonus,
          record.deductions,
          record.unpaidLeaveDeduction,
          record.gross,
          record.net,
          record.status
        ];
      })
    );
  }

  throw badRequest("Unsupported report type");
}

// ==========================================
// ANALYTICS ROUTES
// ==========================================

router.get("/overview", async (req, res, next) => {
  try {
    const report = await getReportData(req);

    res.json({
      month: report.filters.month,
      department: report.filters.department || null,
      employees: report.employees,
      attendance: {
        checkIns: report.attendance.checkIns,
        uniqueEmployeesPresent:
          report.attendance.uniqueEmployeesPresent,
        completedShifts: report.attendance.completedShifts,
        lateCheckIns: report.attendance.lateCheckIns,
        punctualityRate: report.attendance.punctualityRate,
        overtimeHours: report.attendance.overtimeHours
      },
      leaves: report.leaves,
      payroll: report.payroll,
      documents: report.documents
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees", async (req, res, next) => {
  try {
    const report = await getReportData(req);

    res.json({
      month: report.filters.month,
      department: report.filters.department || null,
      ...report.employees
    });
  } catch (error) {
    next(error);
  }
});

router.get("/attendance", async (req, res, next) => {
  try {
    const report = await getReportData(req);

    res.json({
      month: report.filters.month,
      department: report.filters.department || null,
      ...report.attendance
    });
  } catch (error) {
    next(error);
  }
});

router.get("/leaves", async (req, res, next) => {
  try {
    const report = await getReportData(req);

    res.json({
      month: report.filters.month,
      department: report.filters.department || null,
      ...report.leaves
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payroll", async (req, res, next) => {
  try {
    const report = await getReportData(req);

    res.json({
      month: report.filters.month,
      department: report.filters.department || null,
      ...report.payroll
    });
  } catch (error) {
    next(error);
  }
});

// CSV export router.
// Mount at /api/reports/export.

const exportRouter = Router();

exportRouter.get("/", async (req, res, next) => {
  try {
    const type = req.query.type || "attendance";

    if (!reportTypes.includes(type)) {
      throw badRequest(
        `Invalid report type. Use: ${reportTypes.join(", ")}`
      );
    }

    const report = await getReportData(req);
    const csv = createExport(type, report);

    const filename =
      `peopleflow-${type}-${report.filters.month}.csv`;

    res.setHeader(
      "Content-Type",
      "text/csv; charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.setHeader("Cache-Control", "no-store");

    res.send("\uFEFF" + csv);
  } catch (error) {
    next(error);
  }
});

export { router as analyticsRouter, exportRouter };
