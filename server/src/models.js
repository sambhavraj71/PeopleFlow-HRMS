
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const schemaOptions = {
  timestamps: true
};

const shiftSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },

    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/
    },

    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/
    },

    graceMinutes: {
      type: Number,
      default: 10,
      min: 0,
      max: 180
    },

    breakMinutes: {
      type: Number,
      default: 60,
      min: 0,
      max: 1440
    },

    overtimeEnabled: {
      type: Boolean,
      default: true
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  schemaOptions
);

export const Shift = model("Shift", shiftSchema);

// ==============================
// USER MODEL
// ==============================

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    role: {
      type: String,
      enum: ["admin", "hr", "employee"],
      default: "employee"
    },

    department: {
      type: String,
      default: "General"
    },

    designation: {
      type: String,
      default: "Staff"
    },

    joiningDate: {
      type: Date,
      default: Date.now
    },

    baseSalary: {
      type: Number,
      default: 0,
      min: 0
    },

    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      default: null
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  schemaOptions
);

export const User = model("User", userSchema);


const gpsLocationSchema = new Schema(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90
    },

    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180
    },

    accuracy: {
      type: Number,
      required: true,
      min: 0
    },

    distanceMeters: {
      type: Number,
      required: true,
      min: 0
    },

    verifiedAt: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  {
    _id: false
  }
);

const attendanceSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    date: {
      type: String,
      required: true
    },

    checkIn: {
      type: Date,
      required: true
    },

    checkOut: {
      type: Date,
      default: null
    },

    checkInLocation: {
      type: gpsLocationSchema,
      default: undefined
    },

    checkOutLocation: {
      type: gpsLocationSchema,
      default: undefined
    },

    shift: {
      type: Schema.Types.ObjectId,
      ref: "Shift",
      default: null
    },

    shiftSnapshot: {
      name: {
        type: String,
        default: ""
      },

      startTime: {
        type: String,
        default: ""
      },

      endTime: {
        type: String,
        default: ""
      },

      graceMinutes: {
        type: Number,
        default: 0
      },

      breakMinutes: {
        type: Number,
        default: 0
      },

      overtimeEnabled: {
        type: Boolean,
        default: false
      }
    },

    attendanceStatus: {
      type: String,
      enum: [
        "unassigned",
        "on-time",
        "late",
        "early-exit",
        "late-and-early-exit"
      ],
      default: "unassigned"
    },

    lateMinutes: {
      type: Number,
      default: 0,
      min: 0
    },

    earlyExitMinutes: {
      type: Number,
      default: 0,
      min: 0
    },

    workingMinutes: {
      type: Number,
      default: 0,
      min: 0
    },

    overtimeMinutes: {
      type: Number,
      default: 0,
      min: 0
    },

    notes: {
      type: String,
      default: ""
    }
  },
  schemaOptions
);

attendanceSchema.index(
  { employee: 1, date: 1 },
  { unique: true }
);

export const Attendance = model(
  "Attendance",
  attendanceSchema
);

const leaveSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    type: {
      type: String,
      enum: ["annual", "sick", "casual", "unpaid"],
      required: true
    },

    from: {
      type: String,
      required: true
    },

    to: {
      type: String,
      required: true
    },

    days: {
      type: Number,
      required: true,
      min: 1
    },

    reason: {
      type: String,
      required: true
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },

    reviewedAt: {
      type: Date
    }
  },
  schemaOptions
);

export const Leave = model("Leave", leaveSchema);
const payrollSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    month: {
      type: String,
      required: true
    },

    basic: {
      type: Number,
      required: true
    },

    allowances: {
      type: Number,
      default: 0
    },

    bonus: {
      type: Number,
      default: 0
    },

    deductions: {
      type: Number,
      default: 0
    },

    unpaidLeaveDays: {
      type: Number,
      default: 0
    },

    unpaidLeaveDeduction: {
      type: Number,
      default: 0
    },

    gross: {
      type: Number,
      required: true
    },

    net: {
      type: Number,
      required: true
    },

    status: {
      type: String,
      enum: ["draft", "approved"],
      default: "draft"
    },

    approvedAt: {
      type: Date
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User"
    }
  },
  schemaOptions
);

payrollSchema.index(
  { employee: 1, month: 1 },
  { unique: true }
);

const employeeDocumentSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    documentType: {
      type: String,
      enum: [
        "aadhaar",
        "pan",
        "resume",
        "education",
        "experience",
        "offer-letter",
        "other"
      ],
      required: true
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },

    originalFileName: {
      type: String,
      required: true
    },

    storageKey: {
      type: String,
      required: true,
      unique: true,
      select: false
    },

    mimeType: {
      type: String,
      enum: [
        "application/pdf",
        "image/jpeg",
        "image/png"
      ],
      required: true
    },

    fileSize: {
      type: Number,
      required: true,
      min: 1,
      max: 5 * 1024 * 1024
    },

    status: {
      type: String,
      enum: [
        "pending",
        "verified",
        "rejected"
      ],
      default: "pending"
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    reviewedAt: {
      type: Date,
      default: null
    }
  },
  schemaOptions
);

employeeDocumentSchema.index({
  employee: 1,
  createdAt: -1
});

employeeDocumentSchema.index({
  status: 1,
  createdAt: -1
});

export const EmployeeDocument = model(
  "EmployeeDocument",
  employeeDocumentSchema
);

export const Payroll = model("Payroll", payrollSchema);

const announcementSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 150
    },

    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 5000
    },

    priority: {
      type: String,
      enum: ["normal", "important", "urgent"],
      default: "normal"
    },

    audience: {
      type: String,
      enum: ["all", "department"],
      default: "all"
    },

    department: {
      type: String,
      trim: true,
      default: ""
    },

    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft"
    },

    publishedAt: {
      type: Date,
      default: null
    },

    expiresAt: {
      type: Date,
      default: null
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  schemaOptions
);

announcementSchema.index({
  status: 1,
  publishedAt: -1
});

announcementSchema.index({
  audience: 1,
  department: 1
});

export const Announcement = model(
  "Announcement",
  announcementSchema
);

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    announcement: {
      type: Schema.Types.ObjectId,
      ref: "Announcement",
      required: true
    },

    type: {
      type: String,
      enum: ["announcement"],
      default: "announcement"
    },

    isRead: {
      type: Boolean,
      default: false
    },

    readAt: {
      type: Date,
      default: null
    }
  },
  schemaOptions
);

notificationSchema.index(
  {
    recipient: 1,
    announcement: 1
  },
  {
    unique: true
  }
);

notificationSchema.index({
  recipient: 1,
  isRead: 1,
  createdAt: -1
});

export const Notification = model(
  "Notification",
  notificationSchema
);
