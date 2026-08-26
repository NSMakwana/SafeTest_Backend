const mongoose = require("mongoose");

const ExamSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    pin: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    examRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamRoom",
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
      default: "Anonymous Student",
    },
    studentEmail: {
      type: String,
      trim: true,
    },
    formId: {
      type: String,
      required: true,
      trim: true,
    },
    formLink: {
      type: String,
      required: true,
      trim: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    lastAnswerSnapshotAt: {
      type: Date,
    },
    answers: {
      type: Object,
      default: {},
    },
    violationDetected: {
      type: Boolean,
      default: false,
    },
    violationReason: {
      type: String,
      default: null,
    },
    submissionStatus: {
      type: String,
      enum: [
        "IN_PROGRESS",
        "SUBMITTED",
        "SUBMISSION_FAILED",
        "ANSWER_CAPTURE_FAILED",
        "ANSWER_CAPTURE_TIMEOUT",
        "SUBMISSION_UNVERIFIED",
        "UNSUPPORTED",
      ],
      default: "IN_PROGRESS",
    },
    googleResponseStatus: {
      type: Number,
      default: null,
    },
    googleResponseId: {
      type: String,
      default: null,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    submissionError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ExamSession", ExamSessionSchema);
