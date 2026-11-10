import express from "express";
import mongoose from "mongoose";
import {
  Announcement,
  Notification,
  User
} from "./models.js";

const router = express.Router();

const isManager = (req) =>
  ["admin", "hr"].includes(req.user?.role);

const validId = (id) =>
  mongoose.isValidObjectId(id);

const getUserId = (req) =>
  String(req.user?.id || req.user?._id || "");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const managerOnly = (req, res, next) => {
  if (!isManager(req)) {
    return res.status(403).json({
      message: "Admin or HR access required"
    });
  }
  next();
};

const audienceFilter = (user) => ({
  $or: [
    { audience: "all" },
    {
      audience: "department",
      department: user.department
    }
  ]
});

const activeFilter = () => ({
  status: "published",
  publishedAt: { $lte: new Date() },
  $or: [
    { expiresAt: null },
    { expiresAt: { $gt: new Date() } }
  ]
});

const canView = (announcement, user) => {
  if (!announcement) return false;
  if (announcement.status !== "published") return false;
  if (
    announcement.publishedAt &&
    announcement.publishedAt > new Date()
  ) return false;
  if (
    announcement.expiresAt &&
    announcement.expiresAt <= new Date()
  ) return false;

  return (
    announcement.audience === "all" ||
    (
      announcement.audience === "department" &&
      announcement.department === user.department
    )
  );
};

const createNotifications = async (announcement) => {
  const filter = { active: true };

  if (announcement.audience === "department") {
    filter.department = announcement.department;
  }

  const users = await User.find(filter).select("_id").lean();

  if (!users.length) return;

  await Notification.bulkWrite(
    users.map((user) => ({
      updateOne: {
        filter: {
          recipient: user._id,
          announcement: announcement._id
        },
        update: {
          $setOnInsert: {
            recipient: user._id,
            announcement: announcement._id,
            type: "announcement",
            isRead: false,
            readAt: null
          }
        },
        upsert: true
      }
    })),
    { ordered: false }
  );
};

router.post(
  "/announcements",
  managerOnly,
  asyncHandler(async (req, res) => {
    const {
      title,
      content,
      priority = "normal",
      audience = "all",
      department = "",
      status = "draft",
      expiresAt = null
    } = req.body;

    if (
      !["normal", "important", "urgent"].includes(priority) ||
      !["all", "department"].includes(audience) ||
      !["draft", "published"].includes(status)
    ) {
      return res.status(400).json({
        message: "Invalid announcement settings"
      });
    }

    if (
      audience === "department" &&
      !String(department).trim()
    ) {
      return res.status(400).json({
        message: "Department is required"
      });
    }

    const expiry = expiresAt ? new Date(expiresAt) : null;

    if (
      expiry &&
      (Number.isNaN(expiry.getTime()) || expiry <= new Date())
    ) {
      return res.status(400).json({
        message: "Expiry must be a valid future date"
      });
    }

    const announcement = await Announcement.create({
      title,
      content,
      priority,
      audience,
      department:
        audience === "department"
          ? String(department).trim()
          : "",
      status,
      publishedAt:
        status === "published" ? new Date() : null,
      expiresAt: expiry,
      createdBy: getUserId(req)
    });

    if (status === "published") {
      await createNotifications(announcement);
    }

    res.status(201).json(announcement);
  })
);

router.get(
  "/announcements",
  asyncHandler(async (req, res) => {
    const user = await User.findById(getUserId(req))
      .select("department role active")
      .lean();

    if (!user || !user.active) {
      return res.status(403).json({
        message: "Account is inactive"
      });
    }

    const filter = isManager(req)
      ? {}
      : {
          ...activeFilter(),
          ...audienceFilter(user)
        };

    const announcements = await Announcement.find(filter)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name")
      .lean();

    res.json(announcements);
  })
);

router.patch(
  "/announcements/:id",
  managerOnly,
  asyncHandler(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid announcement ID"
      });
    }

    const announcement = await Announcement.findById(
      req.params.id
    );

    if (!announcement) {
      return res.status(404).json({
        message: "Announcement not found"
      });
    }

    if (announcement.status !== "draft") {
      return res.status(409).json({
        message:
          "Only draft announcements can be edited. Archive and create a new announcement for changes."
      });
    }

    const fields = [
      "title",
      "content",
      "priority",
      "audience",
      "department",
      "expiresAt"
    ];

    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        announcement[field] = req.body[field];
      }
    }

    if (announcement.audience === "all") {
      announcement.department = "";
    }

    if (
      announcement.audience === "department" &&
      !String(announcement.department || "").trim()
    ) {
      return res.status(400).json({
        message: "Department is required"
      });
    }

    if (announcement.expiresAt) {
      const expiry = new Date(announcement.expiresAt);

      if (
        Number.isNaN(expiry.getTime()) ||
        expiry <= new Date()
      ) {
        return res.status(400).json({
          message: "Expiry must be a valid future date"
        });
      }
    }

    announcement.updatedBy = getUserId(req);
    await announcement.save();

    res.json(announcement);
  })
);

router.patch(
  "/announcements/:id/publish",
  managerOnly,
  asyncHandler(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid announcement ID"
      });
    }

    const announcement = await Announcement.findById(
      req.params.id
    );

    if (!announcement) {
      return res.status(404).json({
        message: "Announcement not found"
      });
    }

    if (announcement.status !== "draft") {
      return res.status(409).json({
        message: "Only drafts can be published"
      });
    }

    if (
      announcement.expiresAt &&
      announcement.expiresAt <= new Date()
    ) {
      return res.status(400).json({
        message: "Announcement expiry has passed"
      });
    }

    announcement.status = "published";
    announcement.publishedAt = new Date();
    announcement.updatedBy = getUserId(req);

    await announcement.save();
    await createNotifications(announcement);

    res.json(announcement);
  })
);

router.delete(
  "/announcements/:id",
  managerOnly,
  asyncHandler(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid announcement ID"
      });
    }

    const announcement = await Announcement.findById(
      req.params.id
    );

    if (!announcement) {
      return res.status(404).json({
        message: "Announcement not found"
      });
    }

    announcement.status = "archived";
    announcement.updatedBy = getUserId(req);
    await announcement.save();

    await Notification.deleteMany({
      announcement: announcement._id
    });

    res.json({
      message: "Announcement archived successfully"
    });
  })
);

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const user = await User.findById(getUserId(req))
      .select("department active")
      .lean();

    if (!user || !user.active) {
      return res.status(403).json({
        message: "Account is inactive"
      });
    }

    const notifications = await Notification.find({
      recipient: user._id
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("announcement")
      .lean();

    const visible = notifications.filter((notification) =>
      canView(notification.announcement, user)
    );

    res.json(visible);
  })
);

router.get(
  "/notifications/unread-count",
  asyncHandler(async (req, res) => {
    const user = await User.findById(getUserId(req))
      .select("department active")
      .lean();

    if (!user || !user.active) {
      return res.status(403).json({
        message: "Account is inactive"
      });
    }

    const notifications = await Notification.find({
      recipient: user._id,
      isRead: false
    })
      .populate("announcement")
      .lean();

    const count = notifications.filter((notification) =>
      canView(notification.announcement, user)
    ).length;

    res.json({ count });
  })
);
router.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid notification ID"
      });
    }

    const user = await User.findById(getUserId(req))
      .select("department active")
      .lean();

    if (!user || !user.active) {
      return res.status(403).json({
        message: "Account is inactive"
      });
    }

    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: user._id
    }).populate("announcement");

    if (!notification) {
      return res.status(404).json({
        message: "Notification not found"
      });
    }

    if (!canView(notification.announcement, user)) {
      return res.status(404).json({
        message: "Notification not found"
      });
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();
    }

    res.json(notification);
  })
);



router.patch(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const user = await User.findById(getUserId(req))
      .select("department active")
      .lean();

    if (!user || !user.active) {
      return res.status(403).json({
        message: "Account is inactive"
      });
    }

    const notifications = await Notification.find({
      recipient: user._id,
      isRead: false
    }).populate("announcement");

    const ids = notifications
      .filter((notification) =>
        canView(notification.announcement, user)
      )
      .map((notification) => notification._id);

    const result = await Notification.updateMany(
      {
        _id: { $in: ids },
        recipient: user._id
      },
      {
        $set: {
          isRead: true,
          readAt: new Date()
        }
      }
    );

    res.json({
      message: "Notifications marked as read",
      updated: result.modifiedCount
    });
  })
);

export default router;
