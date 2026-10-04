const express = require("express");

const {
  initializePayment,
  verifyPayment,
} = require("../controllers/paymentController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/initialize", protect, initializePayment);

router.post("/verify/:reference", protect, verifyPayment);

module.exports = router;
