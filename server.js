require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= IMPORTANT FIX ================= */

// Render / proxy fix
app.set("trust proxy", 1);

/* ================= CONFIG ================= */

const ADMIN = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const DAILY_LIMIT = 9500;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const SESSION_LIMIT = 2000;

/* ================= STATE ================= */

const dailyMap = new Map();

/* ================= MIDDLEWARE ================= */

app.disable("x-powered-by");

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure-session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(text = "", max = 1000) {
  return text
    .replace(/[\r\n]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function checkDaily(email, count) {
  const now = Date.now();
  const record = dailyMap.get(email);

  if (!record || now - record.start > 24 * 60 * 60 * 1000) {
    dailyMap.set(email, { count: 0, start: now });
  }

  const updated = dailyMap.get(email);

  if (updated.count + count > DAILY_LIMIT) return false;

  updated.count += count;
  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN && password === ADMIN) {
    req.session.user = ADMIN;
    req.session.sent = 0;

    // IMPORTANT: wait for session save
    return req.session.save(() => {
      res.json({ success: true, redirect: "/launcher" });
    });
  }

  return res.json({ success: false });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure-session");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!email || !password || !recipients)
      return res.json({ success: false });

    if (!isValidEmail(email))
      return res.json({ success: false });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!list.length) return res.json({ success: false });

    if (req.session.sent + list.length > SESSION_LIMIT)
      return res.json({ success: false, message: "Session limit reached" });

    if (!checkDaily(email, list.length))
      return res.json({ success: false, message: "Daily limit reached" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    let sentCount = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const chunk = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        chunk.map(to =>
          transporter.sendMail({
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 150),
            text: sanitize(message, 3000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sentCount++;
      });

      await delay(BATCH_DELAY);
    }

    req.session.sent += sentCount;

    return res.json({
      success: true,
      message: `Sent ${sentCount}`
    });

  } catch (err) {
    return res.json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
