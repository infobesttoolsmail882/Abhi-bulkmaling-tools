require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

/* ===================================================
   CONFIG
=================================================== */

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(64).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_BODY_SIZE = "8kb";
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_TIME = 15 * 60 * 1000;
const MAX_IP_REQUESTS = 60;

/* ===================================================
   IN-MEMORY STORE
=================================================== */

const mailLimits = new Map();
const loginAttempts = new Map();
const ipRateLimit = new Map();

/* ===================================================
   BASIC HARDENING
=================================================== */

app.disable("x-powered-by");

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY_SIZE }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=()");
  next();
});

/* ===================================================
   GLOBAL RATE LIMIT
=================================================== */

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = ipRateLimit.get(ip);

  if (!record || now - record.start > 60000) {
    ipRateLimit.set(ip, { count: 1, start: now });
    return next();
  }

  if (record.count >= MAX_IP_REQUESTS) {
    return res.status(429).send("Too many requests");
  }

  record.count++;
  next();
});

/* ===================================================
   HELPERS
=================================================== */

const delay = ms => new Promise(r => setTimeout(r, ms));

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function cleanText(text = "", max = 500) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, max);
}

function checkHourlyLimit(email, count) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 3600000) {
    mailLimits.set(email, { count: 0, start: now });
  }

  const updated = mailLimits.get(email);

  if (updated.count + count > MAX_PER_HOUR) return false;

  updated.count += count;
  return true;
}

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    for (const mail of chunk) {
      try {
        await transporter.sendMail(mail);
      } catch (err) {
        console.error("Send error:", err.message);
      }
    }

    await delay(BATCH_DELAY);
  }
}

/* ===================================================
   AUTH
=================================================== */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

/* ===================================================
   ROUTES
=================================================== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record && record.blockUntil > now) {
    return res.json({ success: false, message: "Try later" });
  }

  if (username === ADMIN_CREDENTIAL && password === ADMIN_CREDENTIAL) {
    loginAttempts.delete(ip);
    req.session.user = ADMIN_CREDENTIAL;
    return res.json({ success: true });
  }

  if (!record) {
    loginAttempts.set(ip, { count: 1 });
  } else {
    record.count++;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.blockUntil = now + LOGIN_BLOCK_TIME;
    }
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

/* ===================================================
   SEND MAIL
=================================================== */

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

    if (!email || !password || !recipients)
      return res.json({ success: false });

    if (!isValidEmail(email))
      return res.json({ success: false });

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!recipientList.length)
      return res.json({ success: false });

    if (!checkHourlyLimit(email, recipientList.length))
      return res.json({ success: false });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
      tls: { rejectUnauthorized: true }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${cleanText(senderName, 40) || "Sender"}" <${email}>`,
      to,
      subject: cleanText(subject, 120) || "Message",
      text: cleanText(message, 1000)
    }));

    await sendBatch(transporter, mails);

    return res.json({
      success: true,
      sent: recipientList.length
    });

  } catch (err) {
    console.error("Fatal:", err.message);
    return res.json({ success: false });
  }
});

/* ===================================================
   START
=================================================== */

app.listen(PORT, () => {
  console.log("Secure mail server running on port " + PORT);
});
