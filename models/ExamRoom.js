const mongoose = require("mongoose");

const ExamRoomSchema = new mongoose.Schema(
  {
    pin: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    formTitle: {
      type: String,
      default: "Google Form Exam",
      trim: true,
    },
    formLink: {
      type: String,
      required: true,
      trim: true,
    },
    formId: {
      type: String,
      trim: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional for backward compatibility
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ExamRoom", ExamRoomSchema);
