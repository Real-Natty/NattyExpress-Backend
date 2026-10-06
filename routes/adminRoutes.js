const express = require("express");
const multer = require("multer");

const {
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const { protect } = require("../middleware/authMiddleware");
const { admin } = require("../middleware/adminMiddleware");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),

  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  },

  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.use(protect, admin);

router.post("/products", upload.single("image"), createProduct);

router.put("/products/:id", upload.single("image"), updateProduct);

router.delete("/products/:id", deleteProduct);

module.exports = router;
