const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= SECURITY ================= */

app.use(helmet());
app.use(compression());

/* ================= LOGIN ================= */

const ADMIN_USER = "2026@#";
const ADMIN_PASS = "2026@#";

/* ================= MIDDLEWARE ================= */

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "ultra-secure-mail-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 60 * 60 * 1000
    }
  })
);

/* ================= AUTH ================= */

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

/* ================= ROUTES ================= */

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

/* ================= RATE LIMIT ================= */

const mailLimits = {};
const HOURLY_LIMIT = 20;

function checkLimit(email, count) {
  const now = Date.now();

  if (!mailLimits[email] || now - mailLimits[email].start > 3600000) {
    mailLimits[email] = { count: 0, start: now };
  }

  if (mailLimits[email].count + count > HOURLY_LIMIT) {
    return false;
  }

  mailLimits[email].count += count;
  return true;
}

/* ================= SAFE SEND SYSTEM ================= */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendControlled(transporter, mails) {
  for (const mail of mails) {
    await transporter.sendMail(mail);
    await delay(1500); // controlled pacing (safe)
  }
}

/* ================= SEND MAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !to)
      return res.json({ success: false, message: "Missing required fields" });

    const recipients = to
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (!checkLimit(gmail, recipients.length))
      return res.json({ success: false, message: "Hourly limit reached" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmail, pass: apppass }
    });

    const safeHTML = `
      <div style="font-family:Arial;padding:20px">
        <h3>${subject || "Message"}</h3>
        <p>${(message || "").replace(/\n/g, "<br>")}</p>
        <br>
        <p style="font-size:12px;color:#666">
          Sent via secure console
        </p>
      </div>
    `;

    const mails = recipients.map(email => ({
      from: `"${senderName || "Sender"}" <${gmail}>`,
      to: email,
      subject: subject || "Message",
      text: message,
      html: safeHTML
    }));

    await sendControlled(transporter, mails);

    res.json({ success: true, sent: recipients.length });

  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Secure Mail Console running on port " + PORT);
});
