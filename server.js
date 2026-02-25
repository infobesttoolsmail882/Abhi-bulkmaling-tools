require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN = "@##2588^$$^*O*^%%^";
const MAX_PER_HOUR = 27;

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "app_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= SECURITY HEADERS ================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

/* ================= HELPERS ================= */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 3600000) {
    mailLimits.set(email, { count: 0, start: now });
  }

  return mailLimits.get(email);
}

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

// Login Page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login API
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN && password === ADMIN) {
    req.session.user = ADMIN;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid credentials" });
});

// Launcher Page (FIXED)
app.get("/launcher", requireAuth, (req, res) => {
  const filePath = path.join(__dirname, "public", "launcher.html");
  res.sendFile(filePath);
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("app_session");
    res.json({ success: true });
  });
});

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body;

    if (!email || !password || !recipients) {
      return res.json({
        success: false,
        message: "Required fields missing"
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

    const limit = getLimit(email);

    if (limit.count + recipientList.length > MAX_PER_HOUR) {
      return res.json({
        success: false,
        message: `Limit exceeded. Remaining: ${
          MAX_PER_HOUR - limit.count
        }`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    for (const to of recipientList) {
      await transporter.sendMail({
        from: `"${senderName || "Sender"}" <${email}>`,
        to,
        subject: subject || "Message",
        text: message || ""
      });
    }

    limit.count += recipientList.length;

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} | Used ${limit.count}/${MAX_PER_HOUR}`
    });

  } catch (err) {
    console.error(err);
    return res.json({
      success: false,
      message: "Mail sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
