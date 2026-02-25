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
const MAX_PER_HOUR = 27;

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

/* ================= STATE ================= */

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

function getLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 3600000) {
    const newRecord = { count: 0, startTime: now };
    mailLimits.set(email, newRecord);
    return newRecord;
  }

  return record;
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid credentials" });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

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
        message: `Hourly limit reached`
      });
    }

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

    // Controlled sequential sending (safer than parallel burst)
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
      message: `Sent ${recipientList.length}`
    });

  } catch (err) {
    console.error("Mail error:", err.message);
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
