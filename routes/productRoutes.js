const express = require("express");

const {
  getProducts,
  getFeaturedProducts,
  getProduct,
} = require("../controllers/productController");

const router = express.Router();

router.get("/", getProducts);
router.get("/featured", getFeaturedProducts);
router.get("/:id", getProduct);

module.exports = router;
