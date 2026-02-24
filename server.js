require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-this-session-secret";

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
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
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/* ================= HELPERS ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeText(text = "") {
  return text
    .replace(/<[^>]*>/g, "")         // remove HTML
    .replace(/[^\x00-\x7F]/g, "")    // remove unicode spam chars
    .replace(/(.)\1{5,}/g, "$1$1")   // remove excessive repeated chars
    .trim()
    .slice(0, 1000);                 // max length control
}

function checkLimit(email, amount) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 3600000) {
    mailLimits.set(email, { count: 0, startTime: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + amount > MAX_PER_HOUR) {
    return false;
  }

  updated.count += amount;
  return true;
}

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    await Promise.allSettled(
      mails.slice(i, i + BATCH_SIZE).map(m =>
        transporter.sendMail(m)
      )
    );
    await delay(BATCH_DELAY);
  }
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
        message: "Email, password and recipients required"
      });
    }

    if (!isValidEmail(email)) {
      return res.json({
        success: false,
        message: "Invalid sender email"
      });
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => isValidEmail(r));

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    if (!checkLimit(email, recipientList.length)) {
      return res.json({
        success: false,
        message: `Max ${MAX_PER_HOUR}/hour exceeded`
      });
    }

    const cleanSubject = sanitizeText(subject || "Quick Note");
    const cleanMessage = sanitizeText(message || "");

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${sanitizeText(senderName) || "Anonymous"}" <${email}>`,
      to,
      subject: cleanSubject,
      text: cleanMessage
    }));

    await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Sent ${recipientList.length}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Email sending failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
