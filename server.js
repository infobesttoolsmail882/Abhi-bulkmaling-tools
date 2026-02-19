const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ===== LOGIN ===== */

const ADMIN_USER = "2026@#";
const ADMIN_PASS = "2026@#";

/* ===== MIDDLEWARE ===== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "secure-mail-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }
  })
);

/* ===== AUTH ===== */

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

/* ===== ROUTES ===== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid Login ❌" });
});

app.get("/launcher", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* ===== MAIL LIMIT SYSTEM ===== */

let mailLimits = {};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendBatch(transporter, mails) {
  const batchSize = 10;

  for (let i = 0; i < mails.length; i += batchSize) {
    await Promise.allSettled(
      mails.slice(i, i + batchSize).map((m) => transporter.sendMail(m))
    );
    await delay(200);
  }
}

/* ===== SEND MAIL ===== */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !to) {
      return res.json({ success: false, message: "Missing fields" });
    }

    const now = Date.now();

    if (
      !mailLimits[gmail] ||
      now - mailLimits[gmail].startTime > 60 * 60 * 1000
    ) {
      mailLimits[gmail] = { count: 0, startTime: now };
    }

    const recipients = to
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter(Boolean);

    if (mailLimits[gmail].count + recipients.length > 25) {
      return res.json({
        success: false,
        message: "Hourly limit 25 reached"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map((r) => ({
      from: `"${senderName || "Sender"}" <${gmail}>`,
      to: r,
      subject: subject || "Message",
      text: message || ""
    }));

    await sendBatch(transporter, mails);

    mailLimits[gmail].count += recipients.length;

    res.json({
      success: true,
      sent: recipients.length
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

/* ===== START ===== */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
