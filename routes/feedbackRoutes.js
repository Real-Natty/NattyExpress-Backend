const express = require("express");
const mongoose = require("mongoose");
const Feedback = require("../models/Feedback");
const { protect } = require("../middleware/authMiddleware");
const { admin } = require("../middleware/adminMiddleware");
const { Resend } = require("resend");

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

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

// Admin: Reply to customer feedback by email
router.post("/:id/reply", protect, admin, async (req, res) => {
  try {
    const { message } = req.body;
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid feedback ID.",
      });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        message: "Reply message is required.",
      });
    }

    if (message.trim().length > 3000) {
      return res.status(400).json({
        message: "Reply cannot exceed 3000 characters.",
      });
    }

    const feedback = await Feedback.findById(id);

    if (!feedback) {
      return res.status(404).json({
        message: "Feedback message not found.",
      });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({
        message: "Email service is not configured.",
      });
    }

    const replyMessage = message.trim();

    const emailResult = await resend.emails.send({
      from: "NattyExpress Support <onboarding@resend.dev>",
      to: [feedback.email],
      subject: `Reply to your NattyExpress ${feedback.category.toLowerCase()} feedback`,
      text: `Hello ${feedback.name},\n\nThank you for contacting NattyExpress.\n\nOur response:\n\n${replyMessage}\n\nRegards,\nNattyExpress Support`,
    });

    if (emailResult.error) {
      console.error("Resend email error:", emailResult.error);

      return res.status(502).json({
        message:
          "Your reply could not be emailed. Check your Resend configuration and verified recipient.",
      });
    }

    feedback.replies.push({
      message: replyMessage,
      sentAt: new Date(),
      emailSent: true,
    });

    feedback.isRead = true;

    await feedback.save();

    res.json({
      message: "Reply sent successfully to the customer's email.",
      feedback,
    });
  } catch (error) {
    console.error("Feedback reply error:", error);

    res.status(500).json({
      message: "Failed to send feedback reply.",
    });
  }
});

module.exports = router;
