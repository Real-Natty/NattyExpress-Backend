const express = require("express");
const mongoose = require("mongoose");
const Feedback = require("../models/Feedback");
const { protect } = require("../middleware/authMiddleware");
const { admin } = require("../middleware/adminMiddleware");

const router = express.Router();

// Submit feedback
router.post("/", async (req, res) => {
  try {
    const { name, email, category, message } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof message !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !message.trim()
    ) {
      return res.status(400).json({
        message: "Name, email, and message are required.",
      });
    }

    if (name.trim().length > 100 || email.trim().length > 254) {
      return res.status(400).json({
        message: "Name or email is too long.",
      });
    }

    if (message.trim().length > 3000) {
      return res.status(400).json({
        message: "Message cannot exceed 3000 characters.",
      });
    }

    const validCategories = ["Suggestion", "Complaint", "Question", "Other"];

    const feedback = await Feedback.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      category: validCategories.includes(category) ? category : "Other",
      message: message.trim(),
    });

    res.status(201).json({
      message: "Your feedback has been submitted successfully.",
      feedbackId: feedback._id,
    });
  } catch (error) {
    console.error("Feedback submission error:", error);

    res.status(500).json({
      message: "Failed to submit feedback.",
    });
  }
});

// Admin: View all feedback
router.get("/", protect, admin, async (req, res) => {
  try {
    const feedback = await Feedback.find().sort({ createdAt: -1 });

    res.json(feedback);
  } catch (error) {
    console.error("Fetch feedback error:", error);

    res.status(500).json({
      message: "Failed to fetch feedback messages.",
    });
  }
});

// Admin: Mark feedback as read
router.patch("/:id/read", protect, admin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid feedback ID.",
      });
    }

    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true, runValidators: true },
    );

    if (!feedback) {
      return res.status(404).json({
        message: "Feedback message not found.",
      });
    }

    res.json({
      message: "Feedback marked as read.",
      feedback,
    });
  } catch (error) {
    console.error("Mark feedback as read error:", error);

    res.status(500).json({
      message: "Failed to update feedback.",
    });
  }
});

// Admin: Delete feedback
router.delete("/:id", protect, admin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid feedback ID.",
      });
    }

    const feedback = await Feedback.findByIdAndDelete(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        message: "Feedback message not found.",
      });
    }

    res.json({
      message: "Feedback deleted successfully.",
    });
  } catch (error) {
    console.error("Delete feedback error:", error);

    res.status(500).json({
      message: "Failed to delete feedback.",
    });
  }
});

module.exports = router;
