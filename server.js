require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_KEY = process.env.ADMIN_KEY || "CHANGE_ADMIN_KEY";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session?.auth === true) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { key } = req.body;

  if (key && key === ADMIN_KEY) {
    req.session.auth = true;
    return res.json({ success: true });
  }

  return res.status(401).json({ success: false });
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

/* ================= HELPERS ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSenderLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 60 * 60 * 1000) {
    mailLimits.set(email, { count: 0, start: now });
    return mailLimits.get(email);
  }

  return record;
}

async function sendInBatches(transporter, messages) {
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(msg => transporter.sendMail(msg))
    );

    if (i + BATCH_SIZE < messages.length) {
      await sleep(BATCH_DELAY);
    }
  }
}

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } =
      req.body;

    if (!email || !password || !recipients) {
      return res.status(400).json({ success: false });
    }

    const cleanRecipients = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));

    if (!cleanRecipients.length) {
      return res.status(400).json({ success: false });
    }

    const limit = getSenderLimit(email);

    if (limit.count + cleanRecipients.length > MAX_PER_HOUR) {
      return res.status(429).json({ success: false });
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

    const safeSubject = subject?.trim() || "Message";
    const safeText = message?.trim() || "";

    const messages = cleanRecipients.map(to => ({
      from: `"${senderName || "Sender"}" <${email}>`,
      to,
      subject: safeSubject,
      text: safeText,
      headers: {
        "X-Mailer": "NodeMailer"
      }
    }));

    await sendInBatches(transporter, messages);

    limit.count += cleanRecipients.length;

    return res.json({
      success: true,
      message: `Sent ${cleanRecipients.length}`
    });

  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
