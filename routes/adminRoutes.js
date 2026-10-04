const express = require("express");
const multer = require("multer");
const path = require("path");

const {
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const { protect } = require("../middleware/authMiddleware");
const { admin } = require("../middleware/adminMiddleware");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;

    cb(null, filename);
  },
});

const upload = multer({
  storage,

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
