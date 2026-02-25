require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";
const MAX_PER_HOUR = 27; // SAME LIMIT AS BEFORE

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

/* ================= STATE ================= */

// { email: { count, startTime } }
const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure_session",
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

// Basic security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

/* ================= HELPERS ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getSenderLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 3600000) {
    mailLimits.set(email, { count: 0, startTime: now });
  }

  return mailLimits.get(email);
}

/* ================= ROUTES ================= */

// Login Page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login API
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  return res.json({
    success: false,
    message: "Invalid credentials"
  });
});

// Launcher Page
app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure_session");
    res.json({ success: true });
  });
});

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body;

    // Basic validation
    if (!email || !password || !recipients) {
      return res.json({
        success: false,
        message: "Email, password and recipients required"
      });
    }

    if (!isValidEmail(email)) {
      return res.json({
        success: false,
        message: "Invalid sender email"
      });
    }

    // Clean & unique recipient list
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

    // Hourly limit check (SAME 27/hour)
    const limit = getSenderLimit(email);

    if (limit.count + recipientList.length > MAX_PER_HOUR) {
      return res.json({
        success: false,
        message: `Max ${MAX_PER_HOUR}/hour exceeded | Remaining: ${
          MAX_PER_HOUR - limit.count
        }`
      });
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password
      }
    });

    await transporter.verify();

    // SAME simple sending speed (no aggressive batching)
    for (const to of recipientList) {
      await transporter.sendMail({
        from: `"${senderName || "Sender"}" <${email}>`,
        to,
        subject: subject || "Message",
        text: message || ""
      });
    }

    // Update limit
    limit.count += recipientList.length;

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} | Used ${limit.count}/${MAX_PER_HOUR}`
    });

  } catch (err) {
    console.error("Send error:", err.message);
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
