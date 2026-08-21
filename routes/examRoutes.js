const express = require("express");
const ExamRoom = require("../models/ExamRoom");
const Submission = require("../models/Submission");
const { protect, requireRole } = require("../middleware/auth");
const { extractFormId, fetchFormDetails } = require("../googleFormHelper");

const router = express.Router();

// Helper to generate a random 6-digit numeric PIN
const generateUniquePin = async () => {
  let pin;
  let exists = true;
  while (exists) {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
    const room = await ExamRoom.findOne({ pin });
    if (!room) exists = false;
  }
  return pin;
};

// POST /api/exams (Teacher creates Exam Room with PIN)
router.post("/", protect, requireRole("teacher", "admin"), async (req, res) => {
  let { pin, formLink, title } = req.body;

  if (!formLink) {
    return res.status(400).json({ error: "Google Form link is required." });
  }

  try {
    // Generate PIN if not provided
    if (!pin || pin.trim() === "") {
      pin = await generateUniquePin();
    } else {
      pin = pin.trim();
      const existing = await ExamRoom.findOne({ pin });
      if (existing) {
        return res.status(400).json({ error: `PIN ${pin} is already in use. Please choose another or leave blank for auto-generation.` });
      }
    }

    const formId = extractFormId(formLink);

    // Auto-fetch form title if not provided
    if (!title || title.trim() === "") {
      try {
        const details = await fetchFormDetails(formLink);
        if (details && details.formTitle) {
          title = details.formTitle;
        }
      } catch (e) {
        title = "Google Form Exam";
      }
    }

    const newRoom = await ExamRoom.create({
      pin,
      formLink: formLink.trim(),
      formId,
      formTitle: title || "Google Form Exam",
      teacher: req.user._id,
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: `Exam Room created successfully with PIN: ${pin}`,
      exam: newRoom,
    });
  } catch (error) {
    console.error("Error creating exam room:", error);
    res.status(500).json({ error: "Failed to create exam room: " + error.message });
  }
});

// GET /api/exams (Teacher gets all their exams with submission counts)
router.get("/", protect, requireRole("teacher", "admin"), async (req, res) => {
  try {
    const exams = await ExamRoom.find({ teacher: req.user._id }).sort({ createdAt: -1 });

    // Attach submission counts to each exam
    const examsWithCounts = await Promise.all(
      exams.map(async (exam) => {
        const submissionsCount = await Submission.countDocuments({ pin: exam.pin });
        return {
          ...exam.toObject(),
          submissionsCount,
        };
      })
    );

    res.json({
      success: true,
      exams: examsWithCounts,
    });
  } catch (error) {
    console.error("Error fetching teacher exams:", error);
    res.status(500).json({ error: "Failed to fetch exams: " + error.message });
  }
});

// GET /api/exams/:pin (Public - Student joins exam via PIN)
router.get("/:pin", async (req, res) => {
  const { pin } = req.params;

  try {
    const exam = await ExamRoom.findOne({ pin: pin.trim() });
    if (!exam) {
      return res.status(404).json({ error: "Invalid PIN. No exam room found with this code." });
    }

    if (!exam.isActive) {
      return res.status(403).json({ error: "This exam room is currently closed by the teacher." });
    }

    res.json({
      success: true,
      pin: exam.pin,
      formLink: exam.formLink,
      formId: exam.formId,
      formTitle: exam.formTitle,
    });
  } catch (error) {
    console.error("Error fetching exam room by PIN:", error);
    res.status(500).json({ error: "Failed to retrieve exam room: " + error.message });
  }
});

// POST /api/exams/violation (Record student violation in MongoDB)
router.post("/violation", async (req, res) => {
  const { pin, studentName, reason, formLink } = req.body;

  try {
    let examRoomId = null;
    if (pin) {
      const room = await ExamRoom.findOne({ pin: pin.trim() });
      if (room) examRoomId = room._id;
    }

    const violation = await Submission.create({
      pin: pin || "DIRECT",
      examRoom: examRoomId,
      studentName: studentName || "Anonymous Student",
      targetForm: formLink || "Google Form",
      reason: reason || "Cheating Violation: Fullscreen Exited / Tab Switched",
      submittedVia: "SafeTest Anti-Cheating Portal",
      verified: false,
    });

    res.json({
      success: true,
      message: "Violation logged to teacher audit.",
      violationId: violation._id,
    });
  } catch (error) {
    console.error("Error logging violation:", error);
    res.status(500).json({ error: "Failed to record violation: " + error.message });
  }
});

// POST /api/exams/join-log (Record student joining exam session)
router.post("/join-log", async (req, res) => {
  const { pin, studentName, formLink } = req.body;

  try {
    let examRoomId = null;
    if (pin) {
      const room = await ExamRoom.findOne({ pin: pin.trim() });
      if (room) examRoomId = room._id;
    }

    const log = await Submission.create({
      pin: pin || "DIRECT",
      examRoom: examRoomId,
      studentName: studentName || "Anonymous Student",
      targetForm: formLink || "Google Form",
      reason: "Exam Started (In Progress)",
      submittedVia: "SafeTest Anti-Cheating Portal",
      verified: true,
    });

    res.json({ success: true, logId: log._id });
  } catch (error) {
    console.warn("Join log warning:", error.message);
    res.json({ success: false });
  }
});

// GET /api/exams/:pin/submissions (Teacher views submission audit log for an exam)
router.get("/:pin/submissions", protect, requireRole("teacher", "admin"), async (req, res) => {
  const { pin } = req.params;

  try {
    const exam = await ExamRoom.findOne({ pin: pin.trim(), teacher: req.user._id });
    if (!exam) {
      return res.status(404).json({ error: "Exam room not found or you are not authorized to view its logs." });
    }

    const submissions = await Submission.find({ pin: pin.trim() }).sort({ createdAt: -1 });

    res.json({
      success: true,
      pin,
      formTitle: exam.formTitle,
      submissions,
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ error: "Failed to fetch submissions: " + error.message });
  }
});

// PATCH /api/exams/:pin/toggle (Teacher toggles active/closed status)
router.patch("/:pin/toggle", protect, requireRole("teacher", "admin"), async (req, res) => {
  const { pin } = req.params;

  try {
    const exam = await ExamRoom.findOne({ pin: pin.trim(), teacher: req.user._id });
    if (!exam) {
      return res.status(404).json({ error: "Exam room not found." });
    }

    exam.isActive = !exam.isActive;
    await exam.save();

    res.json({
      success: true,
      message: `Exam is now ${exam.isActive ? "Active (Open)" : "Closed"}.`,
      isActive: exam.isActive,
    });
  } catch (error) {
    console.error("Error toggling exam status:", error);
    res.status(500).json({ error: "Failed to update exam status: " + error.message });
  }
});

// DELETE /api/exams/:pin (Teacher deletes exam room)
router.delete("/:pin", protect, requireRole("teacher", "admin"), async (req, res) => {
  const { pin } = req.params;

  try {
    const exam = await ExamRoom.findOneAndDelete({ pin: pin.trim(), teacher: req.user._id });
    if (!exam) {
      return res.status(404).json({ error: "Exam room not found." });
    }

    res.json({
      success: true,
      message: "Exam room deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting exam:", error);
    res.status(500).json({ error: "Failed to delete exam: " + error.message });
  }
});

module.exports = router;
