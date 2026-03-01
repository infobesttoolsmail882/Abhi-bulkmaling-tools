require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CORE ================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

/* ================= CONFIG ================= */

const ADMIN = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");

const DAILY_LIMIT = 500;
const SESSION_LIMIT = 300;

const BATCH_SIZE = 5;   // original speed
const BATCH_DELAY = 300; // original delay

const LOGIN_LIMIT = 5;
const LOGIN_BLOCK = 15 * 60 * 1000;

/* ================= STATE ================= */

const dailyTracker = new Map();
const loginTracker = new Map();
const ipTracker = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
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

/* ================= IP RATE LIMIT ================= */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowTime = 60 * 1000;

  if (!ipTracker.has(ip)) ipTracker.set(ip, []);

  const hits = ipTracker.get(ip).filter(t => now - t < windowTime);

  if (hits.length > 100)
    return res.status(429).send("Too many requests");

  hits.push(now);
  ipTracker.set(ip, hits);
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitize(text = "", max = 1000) {
  return text
    .replace(/[\r\n]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkDaily(email, amount) {
  const now = Date.now();
  const record = dailyTracker.get(email);

  if (!record || now - record.start > 24 * 60 * 60 * 1000) {
    dailyTracker.set(email, { count: 0, start: now });
  }

  const updated = dailyTracker.get(email);
  if (updated.count + amount > DAILY_LIMIT) return false;

  updated.count += amount;
  return true;
}

function auth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* LOGIN */

app.post("/login", (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const attempt = loginTracker.get(ip);

  if (attempt && attempt.block > now)
    return res.json({ success: false });

  const { username, password } = req.body || {};

  if (username === ADMIN && password === ADMIN) {
    loginTracker.delete(ip);

    req.session.user = ADMIN;
    req.session.sent = 0;

    return req.session.save(() =>
      res.json({ success: true, redirect: "/launcher" })
    );
  }

  if (!attempt) {
    loginTracker.set(ip, { count: 1, block: 0 });
  } else {
    attempt.count++;
    if (attempt.count >= LOGIN_LIMIT) {
      attempt.block = now + LOGIN_BLOCK;
      attempt.count = 0;
    }
  }

  return res.json({ success: false });
});

app.get("/launcher", auth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure-session");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", auth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body || {};

    if (!validEmail(email)) return res.json({ success: false });

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(validEmail)
      )
    ];

    if (!list.length) return res.json({ success: false });

    if (req.session.sent + list.length > SESSION_LIMIT)
      return res.json({ success: false });

    if (!checkDaily(email, list.length))
      return res.json({ success: false });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 2,
      maxMessages: 100
    });

    await transporter.verify();

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 120),
            text: sanitize(message, 2000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sent++;
      });

      await delay(BATCH_DELAY);
    }

    req.session.sent += sent;

    return res.json({
      success: true,
      message: `Sent ${sent}`
    });

  } catch {
    return res.json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server Running on Port " + PORT);
});
