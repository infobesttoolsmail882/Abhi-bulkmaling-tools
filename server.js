const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

/* ================= CONFIG ================= */

const ADMIN = "@##2588^$$^O^%%^";

const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const DAILY_LIMIT = 9500;

const SESSION_SECRET = crypto.randomBytes(64).toString("hex");

/* ================= STATE ================= */

const usageMap = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000 // 1 hour
    }
  })
);

app.disable("x-powered-by");

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(text = "", max = 1000) {
  return text.replace(/<[^>]*>?/gm, "").trim().slice(0, max);
}

function checkDailyLimit(sender, count) {
  const now = Date.now();
  const record = usageMap.get(sender);

  if (!record || now - record.start > 86400000) {
    usageMap.set(sender, { count: 0, start: now });
  }

  const updated = usageMap.get(sender);

  if (updated.count + count > DAILY_LIMIT) {
    return false;
  }

  updated.count += count;
  return true;
}

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) {
    return next();
  }
  return res.status(401).json({
    success: false,
    message: "Unauthorized"
  });
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN && password === ADMIN) {
    req.session.user = ADMIN;

    return res.json({
      success: true,
      message: "Login successful"
    });
  }

  return res.json({
    success: false,
    message: "Invalid credentials"
  });
});

app.get("/launcher", (req, res) => {
  if (req.session.user !== ADMIN) {
    return res.redirect("/");
  }

  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({
      success: true,
      message: "Logged out"
    });
  });
});

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, subject, message, recipients } =
      req.body;

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

    const list = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(e => e.trim())
          .filter(isValidEmail)
      )
    ];

    if (!list.length) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    if (!checkDailyLimit(email, list.length)) {
      return res.json({
        success: false,
        message: "24 hour limit reached"
      });
    }

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
            from: `"${sanitize(senderName, 40) || "Sender"}" <${email}>`,
            to,
            subject: sanitize(subject, 120) || "Message",
            text: sanitize(message, 3000)
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

  } catch (error) {
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
