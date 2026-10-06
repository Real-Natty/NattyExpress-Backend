const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

const initializePayment = async (req, res) => {
  try {
    const { customer, paymentMethod, items } = req.body;

    if (!customer || !customer.email) {
      return res.status(400).json({
        message: "Customer information is required.",
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        message: "Your cart is empty.",
      });
    }

    let totalAmount = 0;

    for (const item of items) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(404).json({
          message: `Product not found: ${item.productId}`,
        });
      }

      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          message: "Invalid product quantity.",
        });
      }

      if (product.stock < quantity) {
        return res.status(400).json({
          message: `${product.name} does not have enough stock.`,
        });
      }

      totalAmount += Number(product.price) * quantity;
    }

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: customer.email,
          amount: Math.round(totalAmount * 100),
          currency: "NGN",
          callback_url:
            "https://natty-express-frontend-951u.vercel.app/payment-success",
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

    res.json({
      message: "Payment initialized successfully.",
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
      amount: totalAmount,
    });
  } catch (error) {
    console.error("Initialize payment error:", error);

    res.status(500).json({
      message: "Failed to initialize payment.",
    });
  }
};

const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { reference } = req.params;
    const { customer, paymentMethod, items } = req.body;

    if (!reference) {
      return res.status(400).json({
        message: "Payment reference is required.",
      });
    }

    if (!customer || !customer.email) {
      return res.status(400).json({
        message: "Customer information is required.",
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        message: "Your cart is empty.",
      });
    }

    // Check if this payment has already created an order
    const existingOrder = await Order.findOne({
      paymentReference: reference,
    });

    if (existingOrder) {
      return res.json({
        message: "Payment already verified.",
        order: existingOrder,
      });
    }

    // Verify transaction with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference,
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      return res.status(400).json({
        message: data.message || "Payment verification failed.",
      });
    }

    const payment = data.data;

    // Payment must actually be successful
    if (payment.status !== "success") {
      return res.status(400).json({
        message: `Payment status is ${payment.status}.`,
      });
    }

    // Payment must be in Nigerian Naira
    if (payment.currency !== "NGN") {
      return res.status(400).json({
        message: "Invalid payment currency.",
      });
    }

    let totalAmount = 0;
    const orderItems = [];

    // Start MongoDB transaction
    session.startTransaction();

    // Check products and calculate the real order total
    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        await session.abortTransaction();

        return res.status(400).json({
          message: "Invalid product quantity.",
        });
      }

      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        await session.abortTransaction();

        return res.status(404).json({
          message: `Product not found: ${item.productId}`,
        });
      }

      if (product.stock < quantity) {
        await session.abortTransaction();

        return res.status(400).json({
          message: `${product.name} does not have enough stock.`,
        });
      }

      const price = Number(product.price);

      orderItems.push({
        product: product._id,
        name: product.name,
        price,
        quantity,
        image: product.image,
      });

      totalAmount += price * quantity;
    }

    // Paystack amount is stored in kobo
    const expectedAmount = Math.round(totalAmount * 100);

    if (Number(payment.amount) !== expectedAmount) {
      await session.abortTransaction();

      return res.status(400).json({
        message: "Payment amount does not match the order total.",
      });
    }

    // Reduce stock atomically
    for (const item of items) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          stock: {
            $gte: Number(item.quantity),
          },
        },
        {
          $inc: {
            stock: -Number(item.quantity),
          },
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

    // Create order inside the same transaction
    const createdOrders = await Order.create(
      [
        {
          user: req.user ? req.user._id : null,
          customer,
          items: orderItems,
          totalAmount,
          paymentReference: reference,
          paymentStatus: "Paid",
          paymentMethod: paymentMethod || "card",
          status: "Processing",
        },
      ],
      {
        session,
      },
    );

    const order = createdOrders[0];

    // Commit everything together
    await session.commitTransaction();

    res.json({
      message: "Payment verified and order created successfully.",
      order,
      payment,
    });
  } catch (error) {
    // Roll back everything if something fails
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Verify payment error:", error);

    res.status(500).json({
      message: "Failed to verify payment.",
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
};
