"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ===================================================
   BASIC MIDDLEWARE
=================================================== */

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===================================================
   SECURITY
=================================================== */

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/* ===================================================
   LIMIT CONFIG
=================================================== */

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

const senderLimits = new Map();
const ipLimiter = new Map();

/* ===================================================
   ROOT FIX (IMPORTANT)
=================================================== */

app.get("/", (req, res) => {
  res.send("Mail Server Running ✅");
});

/* Optional Health Route */
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    uptime: process.uptime()
  });
});

/* ===================================================
   HELPER FUNCTIONS
=================================================== */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(text = "", max = 1000) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/(.)\1{4,}/g, "$1$1")
    .trim()
    .slice(0, max);
}

function checkLimit(sender, amount) {
  const now = Date.now();
  const record = senderLimits.get(sender);

  if (!record || now - record.startTime > 3600000) {
    senderLimits.set(sender, { count: 0, startTime: now });
  }

  const updated = senderLimits.get(sender);

  if (updated.count + amount > MAX_PER_HOUR) {
    return false;
  }

  updated.count += amount;
  return true;
}

function ipRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = ipLimiter.get(ip);

  if (!record || now - record.startTime > 60000) {
    ipLimiter.set(ip, { count: 1, startTime: now });
    return next();
  }

  if (record.count > 100) {
    return res.status(429).json({
      success: false,
      message: "Too many requests"
    });
  }

  record.count++;
  next();
}

app.use(ipRateLimit);

/* ===================================================
   SEND MAIL ROUTE
=================================================== */

app.post("/send", async (req, res) => {
  try {
    const {
      senderName,
      email,
      password,
      recipients,
      subject,
      message
    } = req.body || {};

    if (!email || !password || !recipients) {
      return res.json({
        success: false,
        message: "Missing required fields"
      });
    }

    if (!isValidEmail(email)) {
      return res.json({
        success: false,
        message: "Invalid sender email"
      });
    }

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => isValidEmail(r))
      )
    ];

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    if (!checkLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: `Limit ${MAX_PER_HOUR}/hour exceeded`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 5,
      auth: {
        user: email,
        pass: password
      }
    });

    await transporter.verify();

    const cleanName = sanitize(senderName, 50) || email;
    const cleanSubject = sanitize(subject, 150) || "Message";
    const cleanMessage = sanitize(message, 2000);

    const mails = recipientList.map(to => ({
      from: `"${cleanName}" <${email}>`,
      to,
      subject: cleanSubject,
      text: cleanMessage
    }));

    let sentCount = 0;

    for (let i = 0; i < mails.length; i += BATCH_SIZE) {
      const chunk = mails.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        chunk.map(mail => transporter.sendMail(mail))
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sentCount++;
      });

      await delay(BATCH_DELAY);
    }

    return res.json({
      success: true,
      message: `Send ${sentCount}`
    });

  } catch (err) {
    console.error("Mail Error:", err.message);

    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

/* ===================================================
   START SERVER
=================================================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
