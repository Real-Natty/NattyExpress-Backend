const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

const initializePayment = async (req, res) => {
  try {
    const { customer, paymentMethod, items } = req.body;

    // Validate customer information
    const requiredFields = [
      "fullName",
      "phone",
      "email",
      "address",
      "city",
      "state",
    ];

    if (
      !customer ||
      requiredFields.some(
        (field) =>
          typeof customer[field] !== "string" || !customer[field].trim(),
      )
    ) {
      return res.status(400).json({
        message: "Please provide complete customer information.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Your cart is empty.",
      });
    }

    const selectedMethod = ["card", "paypal", "bank"].includes(paymentMethod)
      ? paymentMethod
      : "card";

    let totalAmount = 0;
    const verifiedItems = [];
    const quantities = new Map();

    // Validate products and calculate prices from the database
    for (const item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        return res.status(400).json({
          message: "Invalid product ID.",
        });
      }

      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          message: "Invalid product quantity.",
        });
      }

      const productId = item.productId.toString();
      const combinedQuantity = (quantities.get(productId) || 0) + quantity;

      quantities.set(productId, combinedQuantity);
    }

    for (const [productId, quantity] of quantities) {
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({
          message: "One or more products could not be found.",
        });
      }

      if (product.stock < quantity) {
        return res.status(400).json({
          message: `${product.name} does not have enough stock.`,
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          message: `Invalid price for ${product.name}.`,
        });
      }

      verifiedItems.push({
        productId: product._id.toString(),
        quantity,
      });

      totalAmount += price * quantity;
    }

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({
        message: "Invalid order total.",
      });
    }

    // Initialize the transaction with Paystack
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: customer.email.trim().toLowerCase(),
          amount: Math.round(totalAmount * 100),
          currency: "NGN",
          callback_url:
            "https://natty-express-frontend-951u.vercel.app/payment-success",

          // Associate this transaction with the authenticated user
          // and the intended order details.
          metadata: {
            userId: req.user._id.toString(),
            customer: {
              fullName: customer.fullName.trim(),
              phone: customer.phone.trim(),
              email: customer.email.trim().toLowerCase(),
              address: customer.address.trim(),
              city: customer.city.trim(),
              state: customer.state.trim(),
            },
            paymentMethod: selectedMethod,
            items: verifiedItems,
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      console.error("Paystack initialization error:", data);

      return res.status(400).json({
        message: data.message || "Failed to initialize payment.",
      });
    }

    return res.json({
      message: "Payment initialized successfully.",
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
      amount: totalAmount,
    });
  } catch (error) {
    console.error("Initialize payment error:", error);

    return res.status(500).json({
      message: "Failed to initialize payment.",
    });
  }
};

const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        message: "Payment reference is required.",
      });
    }

    // Check for an existing order before attempting to reduce stock.
    const existingOrder = await Order.findOne({
      paymentReference: reference,
    });

    if (existingOrder) {
      if (
        !existingOrder.user ||
        existingOrder.user.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message: "You are not authorized to access this order.",
        });
      }

      return res.json({
        message: "Payment already verified.",
        order: existingOrder,
      });
    }

    // Verify the transaction directly with Paystack.
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const data = await response.json();

    if (!response.ok || !data.status || !data.data) {
      return res.status(400).json({
        message: data.message || "Payment verification failed.",
      });
    }

    const payment = data.data;

    if (payment.status !== "success") {
      return res.status(400).json({
        message: `Payment status is ${payment.status}.`,
      });
    }

    if (payment.currency !== "NGN") {
      return res.status(400).json({
        message: "Invalid payment currency.",
      });
    }

    // Use the metadata recorded during initialization, not the
    // customer and item details supplied again by the frontend.
    const metadata = payment.metadata;

    if (
      !metadata ||
      metadata.userId !== req.user._id.toString() ||
      !metadata.customer ||
      !Array.isArray(metadata.items) ||
      metadata.items.length === 0
    ) {
      return res.status(403).json({
        message: "This payment is not associated with your account or order.",
      });
    }

    const customer = metadata.customer;
    const paymentMethod = ["card", "paypal", "bank"].includes(
      metadata.paymentMethod,
    )
      ? metadata.paymentMethod
      : "card";

    const quantities = new Map();

    for (const item of metadata.items) {
      if (
        !mongoose.Types.ObjectId.isValid(item.productId) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1
      ) {
        return res.status(400).json({
          message: "Invalid order information associated with this payment.",
        });
      }

      const productId = item.productId.toString();

      quantities.set(
        productId,
        (quantities.get(productId) || 0) + Number(item.quantity),
      );
    }

    const orderItems = [];
    let totalAmount = 0;

    // Start a MongoDB transaction so stock changes and order creation
    // succeed together or are rolled back together.
    session.startTransaction();

    for (const [productId, quantity] of quantities) {
      const product = await Product.findById(productId).session(session);

      if (!product) {
        await session.abortTransaction();

        return res.status(404).json({
          message: "One or more products could not be found.",
        });
      }

      if (product.stock < quantity) {
        await session.abortTransaction();

        return res.status(400).json({
          message: `${product.name} does not have enough stock.`,
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        await session.abortTransaction();

        return res.status(400).json({
          message: `Invalid price for ${product.name}.`,
        });
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        price,
        quantity,
        image: product.image,
      });

      totalAmount += price * quantity;
    }

    // Paystack reports the transaction amount in kobo.
    const expectedAmount = Math.round(totalAmount * 100);

    if (Number(payment.amount) !== expectedAmount) {
      await session.abortTransaction();

      return res.status(400).json({
        message: "Payment amount does not match the order total.",
      });
    }

    // Reduce stock only when sufficient stock remains.
    for (const [productId, quantity] of quantities) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: productId,
          stock: { $gte: quantity },
        },
        {
          $inc: { stock: -quantity },
        },
        {
          new: true,
          session,
        },
      );

      if (!updatedProduct) {
        await session.abortTransaction();

        return res.status(400).json({
          message:
            "One or more products are no longer available in the requested quantity.",
        });
      }
    }

    // Create the order and link it to the authenticated customer.
    const createdOrders = await Order.create(
      [
        {
          user: req.user._id,
          customer,
          items: orderItems,
          totalAmount,
          paymentReference: reference,
          paymentStatus: "Paid",
          paymentMethod,
          status: "Processing",
        },
      ],
      { session },
    );

    const order = createdOrders[0];

    await session.commitTransaction();

    return res.json({
      message: "Payment verified and order created successfully.",
      order,
      payment,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Verify payment error:", error);

    return res.status(500).json({
      message: "Failed to verify payment.",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
};
