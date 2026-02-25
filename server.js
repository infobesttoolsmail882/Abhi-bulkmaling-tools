require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

// 🔐 Login ID & Password SAME
const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300;

/* ================= STATE ================= */

const mailLimits = new Map();

/* ================= MIDDLEWARE ================= */

app.use(express.json());
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
  if (req.session && req.session.user === ADMIN_CREDENTIAL) {
    return next();
  }
  return res.redirect("/");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

/* ===== LOGIN FIXED (USERNAME + PASSWORD) ===== */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({
      success: false,
      message: "Both fields required"
    });
  }

  if (
    username === ADMIN_CREDENTIAL &&
    password === ADMIN_CREDENTIAL
  ) {
    req.session.user = ADMIN_CREDENTIAL;

    return res.json({
      success: true,
      message: "Login successful"
    });
  }

  return res.json({
    success: false,
    message: "Invalid credentials"
  });
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

function getLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.start > 60 * 60 * 1000) {
    const fresh = { count: 0, start: now };
    mailLimits.set(email, fresh);
    return fresh;
  }

  return record;
}

async function sendBatches(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const batch = mails.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(mail => transporter.sendMail(mail))
    );

    if (i + BATCH_SIZE < mails.length) {
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
      return res.json({
        success: false,
        message: "Missing required fields"
      });
    }

    const cleanList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));

    if (!cleanList.length) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    const limit = getLimit(email);

    if (limit.count + cleanList.length > MAX_PER_HOUR) {
      return res.json({
        success: false,
        message: "Hourly limit reached"
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    await transporter.verify();

    const mails = cleanList.map(to => ({
      from: `"${senderName || "Sender"}" <${email}>`,
      to,
      subject: subject?.trim() || "Message",
      text: message?.trim() || ""
    }));

    await sendBatches(transporter, mails);

    limit.count += cleanList.length;

    return res.json({
      success: true,
      message: `Sent ${cleanList.length}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: "Server error"
    });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
