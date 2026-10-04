const express = require("express");

const {
  createOrder,
  getOrders,
  getMyOrders,
  updateOrderStatus,
  deleteOrder,
} = require("../controllers/orderController");

const { protect } = require("../middleware/authMiddleware");
const { admin } = require("../middleware/adminMiddleware");

const router = express.Router();

// Create a new order
router.post("/", protect, createOrder);

// Get logged-in user's orders
router.get("/my-orders", protect, getMyOrders);

// Admin: get all orders
router.get("/", protect, admin, getOrders);

// Admin: update order status
router.put("/:id/status", protect, admin, updateOrderStatus);

router.delete("/:id", protect, admin, deleteOrder);

module.exports = router;
