require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_KEY = "@##2588^$$^*O*^%%^"; // login id & password same
const SESSION_SECRET = process.env.SESSION_SECRET || "secure-session-key";

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

/* ================= GLOBAL MEMORY ================= */

let senderLimits = {}; // { email: { count, startTime } }

/* ================= MIDDLEWARE ================= */

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
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

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_KEY) return next();
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "Key required" });
  }

  if (username === ADMIN_KEY && password === ADMIN_KEY) {
    req.session.user = ADMIN_KEY;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid key" });
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const batch = mails.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(mail => transporter.sendMail(mail)));
    await delay(BATCH_DELAY);
  }
}

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

    const now = Date.now();

    // Reset limit after 1 hour
    if (
      !senderLimits[email] ||
      now - senderLimits[email].startTime > 60 * 60 * 1000
    ) {
      senderLimits[email] = { count: 0, startTime: now };
    }

    // Clean & unique recipients
    let recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => isValidEmail(r));

    recipientList = [...new Set(recipientList)];

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    // Enforce 27/hour limit
    if (senderLimits[email].count + recipientList.length > MAX_PER_HOUR) {
      return res.json({
        success: false,
        message: "Hourly limit exceeded (27 max)"
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = recipientList.map(r => ({
      from: `"${senderName || "User"}" <${email}>`,
      to: r,
      subject: subject || "Message",
      text: message || ""
    }));

    await sendBatch(transporter, mails);

    senderLimits[email].count += recipientList.length;

    return res.json({
      success: true,
      message: `Sent ${recipientList.length}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Sending failed"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
