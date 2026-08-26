const express = require("express");
const ExamRoom = require("../models/ExamRoom");
const Submission = require("../models/Submission");
const ExamSession = require("../models/ExamSession");
const { protect, requireRole } = require("../middleware/auth");
const { extractFormId, fetchFormDetails, submitFormResponse } = require("../googleFormHelper");

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
    if (!pin || pin.trim() === "") {
      pin = await generateUniquePin();
    } else {
      pin = pin.trim();
      const existing = await ExamRoom.findOne({ pin });
      if (existing) {
        return res.status(400).json({ error: `PIN ${pin} is already in use.` });
      }
    }

    const formId = extractFormId(formLink);

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
    console.error("[SafeTest Backend] Error creating exam room:", error);
    res.status(500).json({ error: "Failed to create exam room: " + error.message });
  }
});

// GET /api/exams (Teacher gets all their exams with submission counts)
router.get("/", protect, requireRole("teacher", "admin"), async (req, res) => {
  try {
    const exams = await ExamRoom.find({ teacher: req.user._id }).sort({ createdAt: -1 });

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
    console.error("[SafeTest Backend] Error fetching teacher exams:", error);
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
    console.error("[SafeTest Backend] Error fetching exam room by PIN:", error);
    res.status(500).json({ error: "Failed to retrieve exam room: " + error.message });
  }
});

// POST /api/exams/session/start (Student initializes proctored session)
router.post("/session/start", async (req, res) => {
  const { pin, studentName, studentEmail } = req.body;

  if (!pin) {
    return res.status(400).json({ error: "Exam PIN is required." });
  }

  try {
    const room = await ExamRoom.findOne({ pin: pin.trim() });
    if (!room) {
      return res.status(404).json({ error: "Invalid PIN. Exam room not found." });
    }

    if (!room.isActive) {
      return res.status(403).json({ error: "Exam room is currently closed." });
    }

    const sessionId = `sess_${room.pin}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const session = await ExamSession.create({
      sessionId,
      pin: room.pin,
      examRoom: room._id,
      studentName: studentName || "Anonymous Student",
      studentEmail: studentEmail || null,
      formId: room.formId || extractFormId(room.formLink),
      formLink: room.formLink,
      startedAt: new Date(),
      submissionStatus: "IN_PROGRESS",
    });

    console.log(`[SafeTest Backend] Exam session started: ${sessionId} for ${session.studentName}`);

    res.json({
      success: true,
      sessionId: session.sessionId,
      pin: room.pin,
      formId: session.formId,
      formLink: session.formLink,
      formTitle: room.formTitle,
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error starting session:", error);
    res.status(500).json({ error: "Failed to start session: " + error.message });
  }
});

// POST /api/exams/session/snapshot (Continuous debounced answer snapshot update)
router.post("/session/snapshot", async (req, res) => {
  const { sessionId, pin, answers } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required." });
  }

  try {
    const session = await ExamSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired." });
    }

    // Verify PIN matches session
    if (pin && session.pin !== pin.trim()) {
      return res.status(403).json({ error: "PIN mismatch for session." });
    }

    session.answers = answers || session.answers || {};
    session.lastAnswerSnapshotAt = new Date();
    await session.save();

    console.log(`[SafeTest Backend] Answer snapshot saved for ${sessionId}: ${Object.keys(answers || {}).length} item(s)`);

    res.json({
      success: true,
      sessionId: session.sessionId,
      savedCount: Object.keys(session.answers).length,
      timestamp: session.lastAnswerSnapshotAt,
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error updating answer snapshot:", error);
    res.status(500).json({ error: "Failed to update answer snapshot: " + error.message });
  }
});

// POST /api/exams/session/submit-violation (Submit final answers & record violation)
router.post("/session/submit-violation", async (req, res) => {
  const { sessionId, pin, reason, answers, studentName } = req.body;

  try {
    let session = null;
    if (sessionId) {
      session = await ExamSession.findOne({ sessionId });
    }

    // Fallback if no sessionId session found
    if (!session && pin) {
      const room = await ExamRoom.findOne({ pin: pin.trim() });
      if (room) {
        session = await ExamSession.create({
          sessionId: `sess_fallback_${Date.now()}`,
          pin: room.pin,
          examRoom: room._id,
          studentName: studentName || "Anonymous Student",
          formId: room.formId || extractFormId(room.formLink),
          formLink: room.formLink,
          submissionStatus: "IN_PROGRESS",
        });
      }
    }

    if (!session) {
      return res.status(404).json({ error: "Exam session not found." });
    }

    // Prevent duplicate violation submissions
    if (session.violationDetected && session.submissionStatus === "SUBMITTED") {
      return res.json({
        success: true,
        alreadyProcessed: true,
        sessionId: session.sessionId,
        submissionStatus: session.submissionStatus,
        googleResponseStatus: session.googleResponseStatus,
        submittedAt: session.submittedAt,
        reason: session.violationReason,
      });
    }

    session.violationDetected = true;
    session.violationReason = reason || "Cheating Violation Detected";

    // Merge answers snapshot
    const finalAnswers = { ...(session.answers || {}), ...(answers || {}) };
    session.answers = finalAnswers;
    session.lastAnswerSnapshotAt = new Date();

    const formId = session.formId || extractFormId(session.formLink);
    const answersCount = Object.keys(finalAnswers).length;

    console.log(`[SafeTest Backend] Processing violation submission for session ${session.sessionId}: ${answersCount} answer(s)`);

    let result = {
      success: false,
      submissionStatus: "ANSWER_CAPTURE_TIMEOUT",
      googleResponseStatus: null,
      error: "No answers captured",
    };

    if (answersCount > 0) {
      result = await submitFormResponse(formId, finalAnswers);
    } else {
      result = {
        success: false,
        submissionStatus: "ANSWER_CAPTURE_FAILED",
        googleResponseStatus: null,
        error: "No answered questions were captured prior to violation",
      };
    }

    session.submissionStatus = result.submissionStatus;
    session.googleResponseStatus = result.googleResponseStatus || null;
    session.submittedAt = new Date();
    session.submissionError = result.error || null;
    await session.save();

    // Log to Submission collection for Teacher Audit Dashboard
    await Submission.create({
      pin: session.pin,
      examRoom: session.examRoom,
      studentName: session.studentName,
      studentEmail: session.studentEmail,
      targetForm: session.formLink,
      answersCount,
      reason: `Violation: ${session.violationReason} [Status: ${session.submissionStatus}]`,
      submittedVia: "SafeTest Backend Server-Side Submit",
      verified: result.submissionStatus === "SUBMITTED" || result.submissionStatus === "SUBMISSION_UNVERIFIED",
    });

    res.json({
      success: result.success,
      sessionId: session.sessionId,
      submissionStatus: session.submissionStatus,
      googleResponseStatus: session.googleResponseStatus,
      submittedAt: session.submittedAt,
      reason: session.violationReason,
      answersSubmittedCount: answersCount,
      error: result.error,
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error submitting violation response:", error);
    res.status(500).json({
      success: false,
      submissionStatus: "SUBMISSION_FAILED",
      error: "Failed to submit violation: " + error.message,
    });
  }
});

// POST /api/exams/violation (Legacy endpoint backward compatibility)
router.post("/violation", async (req, res) => {
  const { pin, studentName, reason, formLink, answers } = req.body;

  try {
    let examRoomId = null;
    let formId = extractFormId(formLink);
    if (pin) {
      const room = await ExamRoom.findOne({ pin: pin.trim() });
      if (room) {
        examRoomId = room._id;
        if (!formId) formId = room.formId || extractFormId(room.formLink);
      }
    }

    let result = { submissionStatus: "IN_PROGRESS", googleResponseStatus: null };
    if (formId && answers && Object.keys(answers).length > 0) {
      result = await submitFormResponse(formId, answers);
    }

    const violation = await Submission.create({
      pin: pin || "DIRECT",
      examRoom: examRoomId,
      studentName: studentName || "Anonymous Student",
      targetForm: formLink || "Google Form",
      answersCount: Object.keys(answers || {}).length,
      reason: reason || "Cheating Violation: Fullscreen Exited / Tab Switched",
      submittedVia: "SafeTest Anti-Cheating Portal",
      verified: result.submissionStatus === "SUBMITTED" || result.submissionStatus === "SUBMISSION_UNVERIFIED",
    });

    res.json({
      success: true,
      message: "Violation logged to teacher audit.",
      violationId: violation._id,
      submissionStatus: result.submissionStatus,
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error logging violation:", error);
    res.status(500).json({ error: "Failed to record violation: " + error.message });
  }
});

// GET /api/exams/:pin/submissions (Teacher views submission audit log for an exam)
router.get("/:pin/submissions", protect, requireRole("teacher", "admin"), async (req, res) => {
  const { pin } = req.params;

  try {
    const exam = await ExamRoom.findOne({ pin: pin.trim(), teacher: req.user._id });
    if (!exam) {
      return res.status(404).json({ error: "Exam room not found or you are not authorized." });
    }

    const submissions = await Submission.find({ pin: pin.trim() }).sort({ createdAt: -1 });
    const sessions = await ExamSession.find({ pin: pin.trim() }).sort({ createdAt: -1 });

    res.json({
      success: true,
      pin,
      formTitle: exam.formTitle,
      submissions,
      sessions,
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error fetching submissions:", error);
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
    console.error("[SafeTest Backend] Error toggling exam status:", error);
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

    await ExamSession.deleteMany({ pin: pin.trim() });
    await Submission.deleteMany({ pin: pin.trim() });

    res.json({
      success: true,
      message: "Exam room deleted successfully.",
    });
  } catch (error) {
    console.error("[SafeTest Backend] Error deleting exam:", error);
    res.status(500).json({ error: "Failed to delete exam: " + error.message });
  }
});

module.exports = router;
