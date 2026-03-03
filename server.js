"use strict";

const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

/* ================= CONFIG ================= */

const ADMIN_LOGIN = "@##2588^$$^O^%%^";

const SESSION_SECRET = crypto.randomBytes(64).toString("hex");
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour

const BATCH_SIZE = 5;      // fixed speed
const BATCH_DELAY = 300;   // 300ms
const DAILY_LIMIT = 200;   // safe cap (adjust carefully)

/* ================= SECURITY ================= */

app.disable("x-powered-by");

app.use(express.json({ limit: "25kb" }));
app.use(express.urlencoded({ extended: false, limit: "25kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: SESSION_TIMEOUT
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= HELPERS ================= */

const delay = ms => new Promise(r => setTimeout(r, ms));

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanHeader(value = "", max = 120) {
  return value.replace(/[\r\n]/g, "").trim().slice(0, max);
}

function cleanBody(text = "", max = 10000) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .slice(0, max);
}

const dailyTracker = new Map();

function checkDailyLimit(sender, count) {
  const now = Date.now();
  const record = dailyTracker.get(sender);

  if (!record || now - record.start >= 86400000) {
    dailyTracker.set(sender, { count: 0, start: now });
  }

  const updated = dailyTracker.get(sender);

  if (updated.count + count > DAILY_LIMIT) {
    return false;
  }

  updated.count += count;
  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_LOGIN) return next();
  return res.redirect("/");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN_LOGIN && password === ADMIN_LOGIN) {
    req.session.user = ADMIN_LOGIN;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid login" });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure.sid");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients)
      return res.json({ success: false, message: "Missing fields" });

    if (!emailRegex.test(email))
      return res.json({ success: false, message: "Invalid sender email" });

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(r => emailRegex.test(r))
      )
    ];

    if (!recipientList.length)
      return res.json({ success: false, message: "No valid recipients" });

    if (!checkDailyLimit(email, recipientList.length))
      return res.json({ success: false, message: "Daily limit reached" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    let sentCount = 0;

    const finalSubject = cleanHeader(subject || "Message");
    const finalText = cleanBody(message || "");
    const finalName = cleanHeader(senderName || email, 80);

    for (let i = 0; i < recipientList.length; i += BATCH_SIZE) {
      const batch = recipientList.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${finalName}" <${email}>`,
            to,
            subject: finalSubject,
            text: finalText
          })
        )
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
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Secure server running on port " + PORT);
});
