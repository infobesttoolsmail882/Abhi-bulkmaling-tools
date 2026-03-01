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
  process.env.SESSION_SECRET ||
  crypto.randomBytes(64).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;
const MAX_BODY_SIZE = "8kb";

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= BASIC SECURITY ================= */

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
      sameSite: "strict",
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

const delay = ms => new Promise(r => setTimeout(r, ms));

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function cleanText(text = "", max = 500) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s{3,}/g, " ")
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
  let sentCount = 0;

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const chunk = mails.slice(i, i + BATCH_SIZE);

    for (const mail of chunk) {
      try {
        await transporter.sendMail(mail);
        sentCount++;
      } catch (err) {
        console.error("Send error:", err.message);
      }
    }

    await delay(BATCH_DELAY);
  }

  return sentCount;
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

    if (!email || !password || !recipients)
      return res.json({ success: false, message: "Missing fields" });

    if (!isValidEmail(email))
      return res.json({ success: false, message: "Invalid email" });

    const recipientList = [
      ...new Set(
        recipients
          .split(/[\n,]+/)
          .map(r => r.trim())
          .filter(isValidEmail)
      )
    ];

    if (!recipientList.length)
      return res.json({ success: false, message: "No valid recipients" });

    if (!checkHourlyLimit(email, recipientList.length))
      return res.json({
        success: false,
        message: `Limit ${MAX_PER_HOUR}/hour exceeded`
      });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = recipientList.map(to => ({
      from: `"${cleanText(senderName, 40) || "Sender"}" <${email}>`,
      to,
      subject: cleanText(subject, 120) || "Message",
      text: cleanText(message, 1000)
    }));

    const sentCount = await sendBatch(transporter, mails);

    return res.json({
      success: true,
      message: `Send ${sentCount}`
    });

  } catch (err) {
    console.error(err.message);
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Mail server running on port " + PORT);
});
