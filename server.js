"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

/* ======================================================
   BASIC APP CONFIG
====================================================== */

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ======================================================
   SECURITY CONFIG
====================================================== */

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

/* Basic security headers */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/* ======================================================
   SYSTEM LIMIT CONFIG
====================================================== */

const MAX_PER_HOUR = 27;     // per sender
const BATCH_SIZE = 5;        // 5 parallel
const BATCH_DELAY = 300;     // 300ms delay

/* ======================================================
   IN-MEMORY STATE
====================================================== */

const senderLimits = new Map();   // per sender hourly
const ipLimiter = new Map();      // basic anti abuse

/* ======================================================
   HELPER FUNCTIONS
====================================================== */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeText(text = "", max = 1000) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/(.)\1{4,}/g, "$1$1")
    .trim()
    .slice(0, max);
}

function checkSenderLimit(sender, amount) {
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

function basicIpRateLimit(req, res, next) {
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

app.use(basicIpRateLimit);

/* ======================================================
   BATCH MAIL SENDER
====================================================== */

async function sendBatch(transporter, mails) {
  let sentCount = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(mail => transporter.sendMail(mail))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") {
        sentCount++;
      }
    });

    await delay(BATCH_DELAY);
  }

  return sentCount;
}

/* ======================================================
   ROUTES
====================================================== */

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

    if (!checkSenderLimit(email, recipientList.length)) {
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
      maxMessages: 100,
      auth: {
        user: email,
        pass: password
      }
    });

    await transporter.verify();

    const cleanSubject = sanitizeText(subject, 150) || "Message";
    const cleanMessage = sanitizeText(message, 2000);
    const cleanName = sanitizeText(senderName, 50) || email;

    const mails = recipientList.map(to => ({
      from: `"${cleanName}" <${email}>`,
      to,
      subject: cleanSubject,
      text: cleanMessage
    }));

    const sentCount = await sendBatch(transporter, mails);

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

/* ======================================================
   SERVER START
====================================================== */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
