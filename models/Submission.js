const mongoose = require("mongoose");

const SubmissionSchema = new mongoose.Schema(
  {
    pin: {
      type: String,
      trim: true,
      index: true,
    },
    examRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamRoom",
      required: false,
    },
    studentName: {
      type: String,
      default: "Anonymous Student",
      trim: true,
    },
    studentEmail: {
      type: String,
      trim: true,
    },
    targetForm: {
      type: String,
      required: true,
    },
    answersCount: {
      type: Number,
      default: 0,
    },
    reason: {
      type: String,
      default: "Normal Submission",
    },
    submittedVia: {
      type: String,
      default: "SafeTest Anti-Cheating Portal",
    },
    verified: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Submission", SubmissionSchema);
