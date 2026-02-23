require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();

/* ================= CONFIG ================= */

const CONFIG = {
  PORT: process.env.PORT || 8080,
  ADMIN: "@##2588^$$^*O*^%%^",
  SESSION_SECRET: process.env.SESSION_SECRET || "change-this-secret",
  MAX_PER_HOUR: 27
};

/* ================= BASIC SECURITY ================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: CONFIG.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= LIMIT STORE ================= */

const mailLimits = new Map();

function checkLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.timestamp > 3600000) {
    mailLimits.set(email, { count: 1, timestamp: now });
    return true;
  }

  if (record.count >= CONFIG.MAX_PER_HOUR) {
    return false;
  }

  record.count++;
  return true;
}

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === CONFIG.ADMIN) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === CONFIG.ADMIN && password === CONFIG.ADMIN) {
    req.session.user = CONFIG.ADMIN;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid credentials" });
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

/* ================= SEND MAIL ================= */

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
        message: "Email, password and recipients required"
      });
    }

    if (!checkLimit(email)) {
      return res.json({
        success: false,
        message: `Hourly limit reached (${CONFIG.MAX_PER_HOUR})`
      });
    }

    const recipientList = recipients
      .split("\n")
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients found"
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
        from: `"${senderName || "Anonymous"}" <${email}>`,
        to,
        subject: subject || "Quick Note",
        text: message || ""
      });
    }

    return res.json({
      success: true,
      message: `Sent to ${recipientList.length} recipient(s)`
    });

  } catch (err) {
    console.error("Mail Error:", err.message);
    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});
