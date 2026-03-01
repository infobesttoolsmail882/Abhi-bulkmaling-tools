const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^O^%%^";

const SESSION_SECRET = crypto.randomBytes(64).toString("hex");

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_BODY = "15kb";

/* ================= STATE ================= */

const dailyLimit = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: MAX_BODY }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY }));
app.use(express.static(path.join(__dirname, "public")));

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

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clean(text = "", max = 1000) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .trim()
    .slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkDailyLimit(email, count) {
  const now = Date.now();
  const record = dailyLimit.get(email);

  if (!record || now - record.start > 86400000) {
    dailyLimit.set(email, { count: 0, start: now });
  }

  const updated = dailyLimit.get(email);

  if (updated.count + count > 9500) return false;

  updated.count += count;
  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  return res.json({ success: false });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
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

    if (!list.length)
      return res.json({ success: false });

    if (!checkDailyLimit(email, list.length))
      return res.json({
        success: false,
        message: "Daily limit reached"
      });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: password },
      pool: true,
      maxConnections: 2
    });

    await transporter.verify();

    let sent = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(to =>
          transporter.sendMail({
            from: `"${clean(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: clean(subject, 120) || "Message",
            text: clean(message, 2000)
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled") sent++;
      });

      await delay(BATCH_DELAY);
    }

    return res.json({
      success: true,
      message: `Send ${sent}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
