const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

// 🔐 CHANGE THESE VALUES BEFORE DEPLOY
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "StrongPassword123!";

// ⚠️ Use Gmail APP PASSWORD (not normal password)
const SMTP_USER = "yourgmail@gmail.com";
const SMTP_PASS = "your_app_password_here";

/* ================= SECURITY ================= */

app.disable("x-powered-by");
app.use(helmet());

app.use(express.json({ limit: "5kb" }));
app.use(express.urlencoded({ extended: false, limit: "5kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "ultra_secure_random_string_12345",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict"
    }
  })
);

// Global rate limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20
});
app.use(limiter);

/* ================= HELPERS ================= */

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_USERNAME) return next();
  return res.status(401).json({ success: false });
}

/* ================= ROUTES ================= */

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* ================= SAFE EMAIL SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    if (!to || !subject || !message)
      return res.json({ success: false, message: "Missing fields" });

    if (!isValidEmail(to))
      return res.json({ success: false, message: "Invalid email" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    await transporter.verify();

    // Slow sending (reduce abuse risk)
    await new Promise(resolve => setTimeout(resolve, 2000));

    await transporter.sendMail({
      from: SMTP_USER,
      to,
      subject: subject.substring(0, 120),
      text: message.substring(0, 2000)
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Mail error:", err.message);
    res.json({ success: false, message: "Send failed" });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
