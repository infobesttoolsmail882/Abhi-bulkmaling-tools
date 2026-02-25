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

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const MAX_PER_HOUR = 27;

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "8kb" }));
app.use(express.urlencoded({ extended: false, limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "secure_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: false, // set true in HTTPS
      maxAge: 60 * 60 * 1000
    }
  })
);

// Basic security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= HELPERS ================= */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeText(text = "") {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function checkHourlyLimit(email, amount) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 3600000) {
    mailLimits.set(email, { count: 0, startTime: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + amount > MAX_PER_HOUR) {
    return {
      allowed: false,
      remaining: MAX_PER_HOUR - updated.count
    };
  }

  updated.count += amount;
  return { allowed: true };
}

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

  return res.json({ success: false, message: "Invalid credentials" });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("secure_session");
    res.json({ success: true });
  });
});

/* ================= SEND ================= */

app.post("/send", requireAuth, async (req, res) => {
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
        message: "Required fields missing"
      });
    }

    if (!isValidEmail(email)) {
      return res.json({
        success: false,
        message: "Invalid sender email"
      });
    }

    // Clean + unique recipients
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

    const limitCheck = checkHourlyLimit(email, recipientList.length);

    if (!limitCheck.allowed) {
      return res.json({
        success: false,
        message: `Limit exceeded. Remaining: ${limitCheck.remaining}`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: {
        user: email,
        pass: password
      },
      tls: {
        rejectUnauthorized: true
      }
    });

    await transporter.verify();

    for (const to of recipientList) {
      await transporter.sendMail({
        from: `"${sanitizeText(senderName) || "Sender"}" <${email}>`,
        to,
        subject: sanitizeText(subject) || "Message",
        text: sanitizeText(message),
        headers: {
          "X-Mailer": "SecureMailer",
          "Precedence": "bulk"
        }
      });
    }

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} | Used ${
        mailLimits.get(email).count
      }/${MAX_PER_HOUR}`
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
  console.log(`Server running on port ${PORT}`);
});
