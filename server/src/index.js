
import "dotenv/config";
import PDFDocument from "pdfkit";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import announcementRouter from "./announcementRoutes.js";
import { z } from "zod";

import {
  User,
  Shift,
  Attendance,
  Leave,
  Payroll,
  EmployeeDocument
} from "./models.js";
import { sendMail } from "./mailer.js";
import {
  analyticsRouter,
  exportRouter
} from "./analyticsRoutes.js";

// ENVIRONMENT CONFIGURATION


if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("Set a JWT_SECRET of at least 32 characters");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5000;

const GPS_ENABLED =
  process.env.GPS_ATTENDANCE_ENABLED === "true";

const OFFICE_LATITUDE = Number(process.env.OFFICE_LATITUDE);
const OFFICE_LONGITUDE = Number(process.env.OFFICE_LONGITUDE);

const OFFICE_RADIUS = Number(
  process.env.OFFICE_RADIUS_METERS || 200
);

const GPS_MAX_ACCURACY = Number(
  process.env.GPS_MAX_ACCURACY_METERS || 100
);

const GPS_MAX_AGE_MS = 60 * 1000;
const SHIFT_TIMEZONE =
  process.env.SHIFT_TIMEZONE || "Asia/Kolkata";

const officeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHIFT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

if (GPS_ENABLED) {
  if (
    !Number.isFinite(OFFICE_LATITUDE) ||
    !Number.isFinite(OFFICE_LONGITUDE) ||
    OFFICE_LATITUDE < -90 ||
    OFFICE_LATITUDE > 90 ||
    OFFICE_LONGITUDE < -180 ||
    OFFICE_LONGITUDE > 180 ||
    !Number.isFinite(OFFICE_RADIUS) ||
    OFFICE_RADIUS <= 0 ||
    !Number.isFinite(GPS_MAX_ACCURACY) ||
    GPS_MAX_ACCURACY <= 0
  ) {
    console.error("Invalid GPS configuration in .env");
    process.exit(1);
  }
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCUMENT_STORAGE_DIR = path.resolve(
  __dirname,
  "../private-documents"
);

const DOCUMENT_MAX_SIZE = 5 * 1024 * 1024;

const allowedDocumentTypes = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DOCUMENT_MAX_SIZE,
    files: 1,
    fields: 3,
    parts: 4
  },
  fileFilter: (req, file, callback) => {
    if (!allowedDocumentTypes[file.mimetype]) {
      const error = new Error(
        "Only PDF, JPG and PNG files are allowed"
      );
      error.status = 400;
      return callback(error);
    }

    callback(null, true);
  }
});

const documentInputSchema = z.object({
  employeeId: z.string().optional(),
  documentType: z.enum([
    "aadhaar",
    "pan",
    "resume",
    "education",
    "experience",
    "offer-letter",
    "other"
  ]),
  title: z.string().trim().min(2).max(150)
});

const documentReviewSchema = z.object({
  status: z.enum(["verified", "rejected"]),
  rejectionReason: z.string().trim().max(500).optional()
}).refine(
  (data) =>
    data.status !== "rejected" ||
    Boolean(data.rejectionReason),
  {
    message: "Rejection reason is required"
  }
);

function detectDocumentType(buffer) {
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return "application/pdf";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
      ])
    )
  ) {
    return "image/png";
  }

  return null;
}

function canAccessDocument(user, document) {
  return (
    user.role === "admin" ||
    user.role === "hr" ||
    String(document.employee) === String(user.id)
  );
}

function safeDocument(document) {
  const result = document.toObject();
  delete result.storageKey;
  return result;
}


const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173"
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(morgan("dev"));

// ==========================================
// COMMON HELPERS
// ==========================================

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const validate = (schema, data) => {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const error = new Error(
      parsed.error.issues
        .map((issue) =>
          `${issue.path.join(".")}: ${issue.message}`
        )
        .join("; ")
    );

    error.status = 400;
    throw error;
  }

  return parsed.data;
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const monthStr = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const money = z
  .number()
  .finite()
  .min(0)
  .max(100000000);

const cents = (n) =>
  Math.round((n + Number.EPSILON) * 100);

const currency = (n) => Math.round(n) / 100;

const today = () => new Date().toISOString().slice(0, 10);

const validDate = (s) => {
  const d = new Date(s + "T00:00:00Z");

  return (
    !isNaN(d) &&
    d.toISOString().slice(0, 10) === s
  );
};

const daysBetween = (a, b) =>
  Math.round(
    (
      new Date(b + "T00:00:00Z") -
      new Date(a + "T00:00:00Z")
    ) / 86400000
  ) + 1;

const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  department: u.department,
  designation: u.designation,
  joiningDate: u.joiningDate,
  baseSalary: u.baseSalary,
  shift: u.shift || null,
  active: u.active
});

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

const auth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || "")
    .replace(/^Bearer /, "");

  if (!token) {
    return res.status(401).json({
      message: "Login required"
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }

  req.user = await User.findById(decoded.id)
    .select("-passwordHash");

  if (!req.user || !req.user.active) {
    return res.status(401).json({
      message: "Account disabled"
    });
  }

  next();
});

const roles = (...allowed) => (req, res, next) =>
  allowed.includes(req.user.role)
    ? next()
    : res.status(403).json({
        message: "Permission denied"
      });



const notify = (to, subject, message) => {
  if (!to) return;

  Promise.resolve()
    .then(() => sendMail(to, subject, message))
    .catch((error) => {
      console.error("Email notification error:", error.message);
    });
};

const notifyHR = async (subject, message) => {
  const managers = await User.find({
    role: { $in: ["admin", "hr"] },
    active: true
  }).select("email");

  for (const manager of managers) {
    notify(manager.email, subject, message);
  }
};

// GPS / HAVERSINE HELPERS


const gpsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0),
  capturedAt: z.number().finite()
});

const toRadians = (degrees) =>
  degrees * Math.PI / 180;

const haversineDistance = (
  lat1,
  lon1,
  lat2,
  lon2
) => {
  const R = 6371000;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    2 *
    R *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(Math.max(0, 1 - a))
    )
  );
};

const verifyGPS = (body) => {
  if (!GPS_ENABLED) {
    return undefined;
  }

  const data = validate(gpsSchema, body);

  const now = Date.now();

  if (
    data.capturedAt > now + 5000 ||
    now - data.capturedAt > GPS_MAX_AGE_MS
  ) {
    const error = new Error(
      "GPS location expired. Please refresh your location."
    );
    error.status = 400;
    throw error;
  }

  if (data.accuracy > GPS_MAX_ACCURACY) {
    const error = new Error(
      `GPS accuracy too low. Required accuracy: ${GPS_MAX_ACCURACY} meters or better.`
    );
    error.status = 400;
    throw error;
  }

  const distance = haversineDistance(
    data.latitude,
    data.longitude,
    OFFICE_LATITUDE,
    OFFICE_LONGITUDE
  );

  if (distance > OFFICE_RADIUS) {
    const error = new Error(
      `You are outside the office attendance area. Distance: ${Math.round(distance)} meters.`
    );

    error.status = 403;
    throw error;
  }

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy,
    distanceMeters: Math.round(distance),
    verifiedAt: new Date()
  };
};




const shiftInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  graceMinutes: z.number().int().min(0).max(180).default(10),
  breakMinutes: z.number().int().min(0).max(1440).default(60),
  overtimeEnabled: z.boolean().default(true),
  active: z.boolean().default(true)
}).refine(
  (s) => s.startTime !== s.endTime,
  { message: "Start and end time cannot be identical" }
).refine(
  (s) => {
    const start = timeToMinutes(s.startTime);
    const end = timeToMinutes(s.endTime);
    const duration = (end - start + 1440) % 1440;
    return s.breakMinutes < duration;
  },
  { message: "Break must be shorter than shift duration" }
);

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function officeParts(date) {
  const parts = Object.fromEntries(
    officeFormatter.formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function officeDate(date) {
  const p = officeParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addCalendarDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function officeDateTimeToUTC(dateString, time) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let i = 0; i < 5; i++) {
    const p = officeParts(new Date(guess));
    const represented = Date.UTC(
      p.year, p.month - 1, p.day, p.hour, p.minute
    );
    const difference = target - represented;
    if (difference === 0) return new Date(guess);
    guess += difference;
  }

  throw Object.assign(
    new Error("Unable to resolve office shift time"),
    { status: 400 }
  );
}

function getShiftWindow(shift, dateString) {
  const start = officeDateTimeToUTC(dateString, shift.startTime);
  const overnight =
    timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime);

  const endDate = overnight
    ? addCalendarDays(dateString, 1)
    : dateString;

  const end = officeDateTimeToUTC(endDate, shift.endTime);

  return { start, end, overnight };
}

function shiftSnapshot(shift) {
  return {
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceMinutes: shift.graceMinutes,
    breakMinutes: shift.breakMinutes,
    overtimeEnabled: shift.overtimeEnabled
  };
}

function getCheckInShiftDate(shift, now) {
  const localDate = officeDate(now);
  const currentMinutes = (() => {
    const p = officeParts(now);
    return p.hour * 60 + p.minute;
  })();

  const overnight =
    timeToMinutes(shift.endTime) < timeToMinutes(shift.startTime);

  if (overnight) {
    const previous = addCalendarDays(localDate, -1);
    const previousWindow = getShiftWindow(shift, previous);

    // After midnight, before previous shift ends.
    if (
      currentMinutes < timeToMinutes(shift.endTime) &&
      now >= previousWindow.start
    ) {
      return previous;
    }
  }

  return localDate;
}

function calculateCheckIn(shift, dateString, checkIn) {
  const window = getShiftWindow(shift, dateString);
  const graceEnd = new Date(
    window.start.getTime() + shift.graceMinutes * 60000
  );

  const lateMinutes = Math.max(
    0,
    Math.floor((checkIn - graceEnd) / 60000)
  );

  return {
    lateMinutes,
    attendanceStatus: lateMinutes > 0 ? "late" : "on-time"
  };
}

function calculateCheckOut(record, checkOut) {
  const worked = Math.max(
    0,
    Math.floor((checkOut - record.checkIn) / 60000)
  );

  const breakMinutes = record.shiftSnapshot?.breakMinutes || 0;
  const workingMinutes = Math.max(0, worked - breakMinutes);

  if (!record.shiftSnapshot?.startTime ||
      !record.shiftSnapshot?.endTime) {
    return { workingMinutes };
  }

  const shift = record.shiftSnapshot;
  const window = getShiftWindow(shift, record.date);

  const earlyExitMinutes = Math.max(
    0,
    Math.ceil((window.end - checkOut) / 60000)
  );

  const overtimeMinutes = shift.overtimeEnabled
    ? Math.max(0, Math.floor((checkOut - window.end) / 60000))
    : 0;

  const late = record.lateMinutes > 0;
  const early = earlyExitMinutes > 0;

  return {
    workingMinutes,
    earlyExitMinutes,
    overtimeMinutes,
    attendanceStatus: late && early
      ? "late-and-early-exit"
      : early
        ? "early-exit"
        : late
          ? "late"
          : "on-time"
  };
}

// RATE LIMITING


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

// HEALTH CHECK


app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "PeopleFlow API"
  });
});


// AUTHENTICATION ROUTES


app.post(
  "/api/auth/login",
  loginLimiter,
  wrap(async (req, res) => {
    const { email, password } = validate(
      z.object({
        email: z.string().email(),
        password: z.string().min(1)
      }),
      req.body
    );

    const user = await User.findOne({
      email: email.toLowerCase(),
      active: true
    });

    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      token,
      user: publicUser(user)
    });
  })
);

app.get("/api/auth/me", auth, (req, res) => {
  res.json(publicUser(req.user));
});

app.patch(
  "/api/auth/password",
  auth,
  wrap(async (req, res) => {
    const { oldPassword, newPassword } = validate(
      z.object({
        oldPassword: z.string(),
        newPassword: z.string().min(8).max(128)
      }),
      req.body
    );

    const user = await User.findById(req.user.id);

    if (
      !(await bcrypt.compare(
        oldPassword,
        user.passwordHash
      ))
    ) {
      return res.status(400).json({
        message: "Incorrect current password"
      });
    }

    user.passwordHash = await bcrypt.hash(
      newPassword,
      12
    );

    await user.save();

    res.json({
      message: "Password updated"
    });
  })
);


// EMPLOYEE MANAGEMENT


app.get(
  "/api/employees",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const employees = await User.find()
      .sort({ createdAt: -1 });

    res.json(employees.map(publicUser));
  })
);

app.post(
  "/api/employees",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const data = validate(
      z.object({
        name: z.string().trim().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        role: z
          .enum(["admin", "hr", "employee"])
          .default("employee"),
        department: z.string().default("General"),
        designation: z.string().default("Staff"),
        baseSalary: money.default(0),
        joiningDate: dateStr.optional()
      }),
      req.body
    );

    if (
      data.role === "admin" &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        message: "Only admin can create admins"
      });
    }

    const user = await User.create({
      ...data,
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(
        data.password,
        12
      )
    });

    res.status(201).json(publicUser(user));

    // Email: Welcome notification
    notify(
      user.email,
      "Welcome to PeopleFlow HRMS",
      `Hello ${user.name},

Your employee account has been created.

Email: ${user.email}
Role: ${user.role}
Department: ${user.department}
Designation: ${user.designation}

Please contact HR for your login credentials.

Regards,
PeopleFlow HRMS`
    );
  })
);

app.patch(
  "/api/employees/:id",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const data = validate(
      z.object({
        name: z.string().min(2).optional(),
        department: z.string().optional(),
        designation: z.string().optional(),
        baseSalary: money.optional(),
        active: z.boolean().optional(),
        role: z
          .enum(["admin", "hr", "employee"])
          .optional()
      }),
      req.body
    );

    const target = await User.findById(req.params.id);

    if (!target) {
      return res.status(404).json({
        message: "Employee not found"
      });
    }

    if (
      req.user.role !== "admin" &&
      (
        target.role === "admin" ||
        data.role === "admin"
      )
    ) {
      return res.status(403).json({
        message: "Admin role restricted"
      });
    }

    if (
      String(target.id) === String(req.user.id) &&
      (
        data.active === false ||
        (data.role && data.role !== "admin")
      )
    ) {
      return res.status(400).json({
        message: "Cannot disable/demote own account"
      });
    }

    Object.assign(target, data);

    await target.save();

    res.json(publicUser(target));
  })
);



 
// ==========================================
// EMPLOYEE DOCUMENT MANAGEMENT
// ==========================================

// UPLOAD DOCUMENT

app.post(
  "/api/documents/upload",
  auth,
  documentUpload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Please select a document"
      });
    }

    const data = validate(
      documentInputSchema,
      req.body
    );

    const isManager = ["admin", "hr"].includes(
      req.user.role
    );

    const employeeId = isManager
      ? data.employeeId || req.user.id
      : req.user.id;

    if (!mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({
        message: "Invalid employee ID"
      });
    }

    const employee = await User.findById(employeeId);

    if (!employee || !employee.active) {
      return res.status(404).json({
        message: "Active employee not found"
      });
    }

    const detectedType = detectDocumentType(
      req.file.buffer
    );

    if (
      !detectedType ||
      detectedType !== req.file.mimetype
    ) {
      return res.status(400).json({
        message: "Invalid file content or file type"
      });
    }

    await fs.mkdir(DOCUMENT_STORAGE_DIR, {
      recursive: true,
      mode: 0o700
    });

    const storageKey =
      randomUUID() + allowedDocumentTypes[detectedType];

    const filePath = path.join(
      DOCUMENT_STORAGE_DIR,
      storageKey
    );

    await fs.writeFile(
      filePath,
      req.file.buffer,
      { flag: "wx", mode: 0o600 }
    );

    let document;

    try {
      document = await EmployeeDocument.create({
        employee: employeeId,
        documentType: data.documentType,
        title: data.title,
        originalFileName: path.basename(
          req.file.originalname.replace(/\\/g, "/")
        ).slice(0, 255),
        storageKey,
        mimeType: detectedType,
        fileSize: req.file.size,
        uploadedBy: req.user.id
      });
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }

    res.status(201).json({
      message: "Document uploaded successfully",
      document: safeDocument(document)
    });
  })
);

// LIST DOCUMENTS

app.get(
  "/api/documents",
  auth,
  wrap(async (req, res) => {
    const isManager = ["admin", "hr"].includes(
      req.user.role
    );

    const query = isManager
      ? {}
      : { employee: req.user.id };

    if (req.query.employeeId) {
      if (!mongoose.isValidObjectId(req.query.employeeId)) {
        return res.status(400).json({
          message: "Invalid employee ID"
        });
      }

      if (
        !isManager &&
        String(req.query.employeeId) !== String(req.user.id)
      ) {
        return res.status(403).json({
          message: "Permission denied"
        });
      }

      query.employee = req.query.employeeId;
    }

    if (req.query.status) {
      const status = validate(
        z.enum(["pending", "verified", "rejected"]),
        req.query.status
      );

      query.status = status;
    }

    const documents = await EmployeeDocument.find(query)
      .populate("employee", "name email department")
      .populate("uploadedBy", "name")
      .populate("reviewedBy", "name")
      .sort({ createdAt: -1 })
      .limit(500);

    res.json(documents.map(safeDocument));
  })
);

// PREVIEW OR DOWNLOAD DOCUMENT

app.get(
  "/api/documents/:id/file",
  auth,
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid document ID"
      });
    }

    const document = await EmployeeDocument.findById(
      req.params.id
    ).select("+storageKey");

    if (!document) {
      return res.status(404).json({
        message: "Document not found"
      });
    }

    if (!canAccessDocument(req.user, document)) {
      return res.status(403).json({
        message: "Permission denied"
      });
    }

    const filePath = path.join(
      DOCUMENT_STORAGE_DIR,
      path.basename(document.storageKey)
    );

    let file;

    try {
      file = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          message: "Stored file not found"
        });
      }

      throw error;
    }

    res.setHeader(
      "Content-Type",
      document.mimeType
    );

    res.setHeader(
      "Content-Length",
      file.length
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; sandbox"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="document-${document.id}${allowedDocumentTypes[document.mimeType]}"`
    );

    res.send(file);
  })
);

// VERIFY OR REJECT DOCUMENT

app.patch(
  "/api/documents/:id/verify",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid document ID"
      });
    }

    const data = validate(
      documentReviewSchema,
      req.body
    );

    const document = await EmployeeDocument.findById(
      req.params.id
    );

    if (!document) {
      return res.status(404).json({
        message: "Document not found"
      });
    }

    if (document.status !== "pending") {
      return res.status(409).json({
        message: "Document already reviewed"
      });
    }

    if (
      String(document.uploadedBy) === String(req.user.id)
    ) {
      return res.status(403).json({
        message: "Cannot verify your own upload"
      });
    }

    document.status = data.status;
    document.rejectionReason =
      data.status === "rejected"
        ? data.rejectionReason
        : "";

    document.reviewedBy = req.user.id;
    document.reviewedAt = new Date();

    await document.save();

    res.json({
      message: `Document ${data.status} successfully`,
      document: safeDocument(document)
    });
  })
);

// DELETE DOCUMENT

app.delete(
  "/api/documents/:id",
  auth,
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid document ID"
      });
    }

    const document = await EmployeeDocument.findById(
      req.params.id
    ).select("+storageKey");

    if (!document) {
      return res.status(404).json({
        message: "Document not found"
      });
    }

    if (!canAccessDocument(req.user, document)) {
      return res.status(403).json({
        message: "Permission denied"
      });
    }

    if (
      req.user.role === "employee" &&
      document.status !== "pending"
    ) {
      return res.status(403).json({
        message: "Reviewed documents can only be deleted by HR/Admin"
      });
    }

    const filePath = path.join(
      DOCUMENT_STORAGE_DIR,
      path.basename(document.storageKey)
    );

    await EmployeeDocument.deleteOne({
      _id: document._id
    });

    await fs.unlink(filePath).catch((error) => {
      if (error.code !== "ENOENT") {
        console.error(
          "Document cleanup failed:",
          error.message
        );
      }
    });

    res.json({
      message: "Document deleted successfully"
    });
  })
);


// ==========================================
// SHIFT MANAGEMENT
// ==========================================

app.get(
  "/api/shifts",
  auth,
  wrap(async (req, res) => {
    const shifts = await Shift.find()
      .sort({ active: -1, name: 1 });

    res.json(shifts);
  })
);

app.post(
  "/api/shifts",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const data = validate(shiftInputSchema, req.body);

    const shift = await Shift.create(data);

    res.status(201).json(shift);
  })
);

app.patch(
  "/api/shifts/:id",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid shift ID"
      });
    }

    const shift = await Shift.findById(req.params.id);

    if (!shift) {
      return res.status(404).json({
        message: "Shift not found"
      });
    }

    const patch = validate(
      shiftInputSchema.partial(),
      req.body
    );

    const merged = {
      ...shift.toObject(),
      ...patch
    };

    const updated = validate(shiftInputSchema, merged);

    Object.assign(shift, updated);
    await shift.save();

    res.json(shift);
  })
);

app.patch(
  "/api/employees/:id/shift",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const { shiftId } = validate(
      z.object({
        shiftId: z.string().nullable()
      }),
      req.body
    );

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid employee ID"
      });
    }

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found"
      });
    }

    if (
      req.user.role !== "admin" &&
      employee.role === "admin"
    ) {
      return res.status(403).json({
        message: "Admin account restricted"
      });
    }

    if (shiftId !== null) {
      if (!mongoose.isValidObjectId(shiftId)) {
        return res.status(400).json({
          message: "Invalid shift ID"
        });
      }

      const shift = await Shift.findById(shiftId);

      if (!shift || !shift.active) {
        return res.status(400).json({
          message: "Shift not found or inactive"
        });
      }
    }

    employee.shift = shiftId;
    await employee.save();

    res.json(publicUser(employee));
  })
);

app.get(
  "/api/attendance/config",
  auth,
  (req, res) => {
    res.json({
      gpsEnabled: GPS_ENABLED,
      officeRadiusMeters: GPS_ENABLED
        ? OFFICE_RADIUS
        : null,
      maxAccuracyMeters: GPS_ENABLED
        ? GPS_MAX_ACCURACY
        : null,
      maxLocationAgeSeconds: GPS_MAX_AGE_MS / 1000
    });
  }
);


app.get(
  "/api/attendance",
  auth,
  wrap(async (req, res) => {
    const query =
      req.user.role === "employee"
        ? { employee: req.user.id }
        : {};

    if (req.query.month) {
      validate(monthStr, req.query.month);

      query.date = {
        $regex: "^" + req.query.month
      };
    }

    const records = await Attendance.find(query)
        .populate("employee", "name email department designation")
        .populate("shift", "name startTime endTime")
        .sort({ date: -1, checkIn: -1 })
        .limit(500);

    res.json(records);
  })
);

// GPS CHECK-IN



app.post(
  "/api/attendance/check-in",
  auth,
  wrap(async (req, res) => {
    const now = new Date();

    const employee = await User.findById(req.user.id)
      .populate("shift");

    const assignedShift =
      employee.shift && employee.shift.active
        ? employee.shift
        : null;

    const date = assignedShift
      ? getCheckInShiftDate(assignedShift, now)
      : officeDate(now);

    const existing = await Attendance.findOne({
      employee: req.user.id,
      date
    });

    if (existing) {
      return res.status(409).json({
        message: "Already checked in for this shift date"
      });
    }

    const openRecord = await Attendance.findOne({
      employee: req.user.id,
      checkOut: null
    });

    if (openRecord) {
      return res.status(409).json({
        message: "Previous attendance is still open. Check out or contact HR."
      });
    }

    const location = verifyGPS(req.body);

    const attendanceData = {
      employee: req.user.id,
      date,
      checkIn: now
    };

    if (location) {
      attendanceData.checkInLocation = location;
    }

    if (assignedShift) {
      attendanceData.shift = assignedShift._id;
      attendanceData.shiftSnapshot =
        shiftSnapshot(assignedShift);

      Object.assign(
        attendanceData,
        calculateCheckIn(assignedShift, date, now)
      );
    }

    const attendance = await Attendance.create(
      attendanceData
    );

    res.status(201).json(attendance);
  })
);


// ==========================================
// GPS CHECK-OUT
// ==========================================


app.post(
  "/api/attendance/check-out",
  auth,
  wrap(async (req, res) => {
    const record = await Attendance.findOne({
      employee: req.user.id,
      checkOut: null
    }).sort({ checkIn: -1 });

    if (!record) {
      return res.status(400).json({
        message: "No open attendance found. Check in first."
      });
    }

    const now = new Date();

    const elapsedHours =
      (now - record.checkIn) / 3600000;

    if (elapsedHours > 36) {
      return res.status(409).json({
        message: "Attendance is older than 36 hours. Contact HR for correction."
      });
    }

    const location = verifyGPS(req.body);

    record.checkOut = now;

    if (location) {
      record.checkOutLocation = location;
    }

    Object.assign(
      record,
      calculateCheckOut(record, now)
    );

    await record.save();

    res.json(record);
  })
);


// ==========================================
// LEAVE MANAGEMENT
// ==========================================

app.get(
  "/api/leaves",
  auth,
  wrap(async (req, res) => {
    const query =
      req.user.role === "employee"
        ? { employee: req.user.id }
        : {};

    const leaves = await Leave.find(query)
      .populate("employee", "name email")
      .sort({ createdAt: -1 })
      .limit(500);

    res.json(leaves);
  })
);

app.post(
  "/api/leaves",
  auth,
  wrap(async (req, res) => {
    const data = validate(
      z.object({
        type: z.enum([
          "annual",
          "sick",
          "casual",
          "unpaid"
        ]),
        from: dateStr,
        to: dateStr,
        reason: z.string().min(3).max(1000)
      }),
      req.body
    );

    const days = daysBetween(data.from, data.to);

    if (
      !validDate(data.from) ||
      !validDate(data.to) ||
      days < 1 ||
      days > 60
    ) {
      return res.status(400).json({
        message:
          "Invalid leave date range (maximum 60 days)"
      });
    }

    const overlap = await Leave.exists({
      employee: req.user.id,
      status: { $in: ["pending", "approved"] },
      from: { $lte: data.to },
      to: { $gte: data.from }
    });

    if (overlap) {
      return res.status(409).json({
        message: "Overlapping leave request"
      });
    }

    const leave = await Leave.create({
      ...data,
      days,
      employee: req.user.id
    });

    res.status(201).json(leave);

    // Email: Notify HR and Admin
    notifyHR(
      "New Leave Request - PeopleFlow",
      `New leave request submitted.

Employee: ${req.user.name}
Email: ${req.user.email}
Leave Type: ${leave.type}
From: ${leave.from}
To: ${leave.to}
Days: ${leave.days}
Reason: ${leave.reason}

Please review this request in PeopleFlow HRMS.`
    ).catch((error) => {
      console.error("HR notification failed:", error.message);
    });
  })
);

app.patch(
  "/api/leaves/:id/status",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const { status } = validate(
      z.object({
        status: z.enum(["approved", "rejected"])
      }),
      req.body
    );

    const leave = await Leave.findById(
      req.params.id
    );

    if (!leave) {
      return res.status(404).json({
        message: "Leave not found"
      });
    }

    if (leave.status !== "pending") {
      return res.status(409).json({
        message: "Already reviewed"
      });
    }

    if (
      String(leave.employee) ===
      String(req.user.id)
    ) {
      return res.status(403).json({
        message: "Cannot approve your own leave"
      });
    }

    leave.status = status;
    leave.reviewedBy = req.user.id;
    leave.reviewedAt = new Date();

    await leave.save();

    res.json(leave);

    // Email: Leave status notification
    const employee = await User.findById(
      leave.employee
    ).select("name email");

    if (employee) {
      notify(
        employee.email,
        `Leave Request ${status.toUpperCase()}`,
        `Hello ${employee.name},

Your leave request has been ${status}.

Leave Type: ${leave.type}
From: ${leave.from}
To: ${leave.to}
Days: ${leave.days}
Status: ${status.toUpperCase()}

Reviewed by: ${req.user.name}

Regards,
PeopleFlow HRMS`
      );
    }
  })
);


const overlapDays = (a, b, start, end) => {
  const from = a > start ? a : start;
  const to = b < end ? b : end;

  return Math.max(0, daysBetween(from, to));
};

const monthRange = (month) => {
  const [year, mo] = month.split("-").map(Number);

  const last = new Date(
    Date.UTC(year, mo, 0)
  ).getUTCDate();

  return {
    start: month + "-01",
    end: month + "-" + String(last).padStart(2, "0"),
    days: last
  };
};



app.get(
  "/api/payroll",
  auth,
  wrap(async (req, res) => {
    const query =
      req.user.role === "employee"
        ? { employee: req.user.id }
        : {};

    if (req.query.month) {
      validate(monthStr, req.query.month);
      query.month = req.query.month;
    }

    if (req.user.role === "employee") {
      query.status = "approved";
    }

    const payrolls = await Payroll.find(query)
      .populate(
        "employee",
        "name email department designation"
      )
      .sort({ month: -1, createdAt: -1 })
      .limit(500);

    res.json(payrolls);
  })
);


app.post(
  "/api/payroll/generate",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const {
      month,
      allowances,
      bonus,
      deductions
    } = validate(
      z.object({
        month: monthStr,
        allowances: money.default(0),
        bonus: money.default(0),
        deductions: money.default(0)
      }),
      req.body
    );

    const { start, end, days } = monthRange(month);

    const employees = await User.find({
      active: true
    });

    let created = 0;
    let skipped = 0;

    for (const employee of employees) {
      const exists = await Payroll.exists({
        employee: employee.id,
        month
      });

      if (exists) {
        skipped++;
        continue;
      }

      const leaves = await Leave.find({
        employee: employee.id,
        status: "approved",
        type: "unpaid",
        from: { $lte: end },
        to: { $gte: start }
      });

      const unpaidDays = Math.min(
        days,
        leaves.reduce(
          (sum, leave) =>
            sum +
            overlapDays(
              leave.from,
              leave.to,
              start,
              end
            ),
          0
        )
      );

      const basic = cents(employee.baseSalary);

      const unpaid = Math.round(
        basic * unpaidDays / days
      );

      const gross =
        basic +
        cents(allowances) +
        cents(bonus);

      const net =
        gross -
        unpaid -
        cents(deductions);

      await Payroll.create({
        employee: employee.id,
        month,
        basic: currency(basic),
        allowances,
        bonus,
        deductions,
        unpaidLeaveDays: unpaidDays,
        unpaidLeaveDeduction: currency(unpaid),
        gross: currency(gross),
        net: currency(net)
      });

      created++;
    }

    res.json({
      created,
      skipped,
      message:
        `Created ${created} payroll drafts. Review before approval.`
    });
  })
);



app.patch(
  "/api/payroll/:id",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const data = validate(
      z.object({
        allowances: money,
        bonus: money,
        deductions: money
      }),
      req.body
    );

    const payroll = await Payroll.findById(
      req.params.id
    );

    if (!payroll) {
      return res.status(404).json({
        message: "Payroll not found"
      });
    }

    if (payroll.status !== "draft") {
      return res.status(409).json({
        message: "Approved payroll is locked"
      });
    }

    Object.assign(payroll, data);

    payroll.gross = currency(
      cents(payroll.basic) +
      cents(payroll.allowances) +
      cents(payroll.bonus)
    );

    payroll.net = currency(
      cents(payroll.gross) -
      cents(payroll.deductions) -
      cents(payroll.unpaidLeaveDeduction)
    );

    await payroll.save();

    res.json(payroll);
  })
);


app.post(
  "/api/payroll/:id/approve",
  auth,
  roles("admin", "hr"),
  wrap(async (req, res) => {
    const payroll = await Payroll.findById(
      req.params.id
    );

    if (!payroll) {
      return res.status(404).json({
        message: "Payroll not found"
      });
    }

    if (payroll.status !== "draft") {
      return res.status(409).json({
        message: "Already approved"
      });
    }

    payroll.status = "approved";
    payroll.approvedBy = req.user.id;
    payroll.approvedAt = new Date();

    await payroll.save();

    res.json(payroll);

    // Email: Payslip ready
    const employee = await User.findById(
      payroll.employee
    ).select("name email");

    if (employee) {
      notify(
        employee.email,
        `Payslip Ready - ${payroll.month}`,
        `Hello ${employee.name},

Your payroll for ${payroll.month} has been approved.

Gross Salary: INR ${payroll.gross.toFixed(2)}
Net Salary: INR ${payroll.net.toFixed(2)}

Your payslip is available in your
PeopleFlow HRMS employee dashboard.

Regards,
PeopleFlow HRMS`
      );
    }
  })
);


app.get(
  "/api/payroll/:id/payslip",
  auth,
  wrap(async (req, res) => {
    const payroll = await Payroll.findById(
      req.params.id
    ).populate(
      "employee",
      "name email department designation"
    );

    if (!payroll) {
      return res.status(404).json({
        message: "Payslip not found"
      });
    }

    if (payroll.status !== "approved") {
      return res.status(403).json({
        message: "Payroll not approved"
      });
    }

    if (
      req.user.role === "employee" &&
      String(payroll.employee._id) !==
        String(req.user.id)
    ) {
      return res.status(403).json({
        message: "Permission denied"
      });
    }

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payslip-${payroll.month}.pdf"`
    );

    const pdf = new PDFDocument({
      margin: 50
    });

    pdf.pipe(res);

    pdf
      .fontSize(22)
      .text("PeopleFlow | PAYSLIP");

    pdf
      .moveDown()
      .fontSize(12)
      .text(`Employee: ${payroll.employee.name}`)
      .text(`Email: ${payroll.employee.email}`)
      .text(
        `Department: ${payroll.employee.department}`
      )
      .text(`Month: ${payroll.month}`)
      .moveDown();

    const details = {
      Basic: payroll.basic,
      Allowances: payroll.allowances,
      Bonus: payroll.bonus,
      "Unpaid leave deduction":
        payroll.unpaidLeaveDeduction,
      "Other deductions": payroll.deductions,
      "Gross earnings": payroll.gross,
      "Net salary": payroll.net
    };

    for (const [key, value] of Object.entries(details)) {
      pdf.text(
        `${key}: INR ${value.toFixed(2)}`
      );
    }

    pdf
      .moveDown()
      .fontSize(9)
      .text(
        "Generated from approved payroll records."
      );

    pdf.end();
  })
);


app.get(
  "/api/dashboard",
  auth,
  wrap(async (req, res) => {
    const isEmployee =
      req.user.role === "employee";

    const query = isEmployee
      ? { employee: req.user.id }
      : {};

    const [
      employees,
      pendingLeaves,
      attendanceToday,
      latestPayroll
    ] = await Promise.all([
      isEmployee
        ? Promise.resolve(1)
        : User.countDocuments({ active: true }),

      Leave.countDocuments({
        ...query,
        status: "pending"
      }),

      Attendance.countDocuments({
        ...query,
        date: officeDate(new Date())
      }),

      Payroll.find({
        ...query,
        ...(isEmployee
          ? { status: "approved" }
          : {})
      })
        .sort({ month: -1 })
        .limit(5)
        .populate("employee", "name")
    ]);

    res.json({
      employees,
      pendingLeaves,
      attendanceToday,
      latestPayroll
    });
  })
);


// HR ANALYTICS & REPORTS


app.use(
  "/api/analytics",
  auth,
  roles("admin", "hr"),
  analyticsRouter
);
app.use("/api", auth, announcementRouter);

app.use(
  "/api/reports/export",
  auth,
  roles("admin", "hr"),
  exportRouter
);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found"
  });
});

// GLOBAL ERROR HANDLER


app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        err.code === "LIMIT_FILE_SIZE"
          ? "File size must not exceed 5 MB"
          : "Invalid document upload: " + err.message
    });
  }

  const status =
    err.status ||
    (err.code === 11000 ? 409 : 500);

  res.status(status).json({
    message:
      err.code === 11000
        ? "Record already exists"
        : err.status
          ? err.message
          : "Server error"
  });
});

// DATABASE CONNECTION + SERVER


mongoose
  .connect(
    process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/peopleflow"
  )
  .then(() => {
    console.log("MongoDB connected successfully");

    app.listen(PORT, () => {
      console.log(
        `PeopleFlow API running at http://localhost:${PORT}`
      );

      console.log(
        `GPS Attendance: ${GPS_ENABLED ? "Enabled" : "Disabled"}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "MongoDB connection failed:",
      error.message
    );

    process.exit(1);
  });
