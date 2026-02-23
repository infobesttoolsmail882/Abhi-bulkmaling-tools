require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// ================= CONFIG =================

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "change-this-session-secret";

// Per sender hourly limit
const MAX_PER_HOUR = 27;
const BATCH_SIZE = 5;          // same speed
const BATCH_DELAY = 300;       // same delay

// ================= GLOBAL STATE =================

let mailLimits = {}; // { email: { count, startTime } }

// ================= MIDDLEWARE =================

app.use(bodyParser.urlencoded({ extended: true }));
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

// ================= AUTH =================

function requireAuth(req, res, next) {
  if (req.session.user === ADMIN_CREDENTIAL) return next();
  return res.redirect("/");
}

// ================= ROUTES =================

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

// ================= HELPERS =================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    await Promise.allSettled(
      mails.slice(i, i + BATCH_SIZE).map(mail =>
        transporter.sendMail(mail)
      )
    );
    await delay(BATCH_DELAY);
  }
}

// ================= SEND MAIL =================

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

    const now = Date.now();

    // Reset hourly limit if needed
    if (
      !mailLimits[email] ||
      now - mailLimits[email].startTime > 60 * 60 * 1000
    ) {
      mailLimits[email] = { count: 0, startTime: now };
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.json({
        success: false,
        message: "No valid recipients"
      });
    }

    // Check limit
    if (
      mailLimits[email].count + recipientList.length >
      MAX_PER_HOUR
    ) {
      return res.json({
        success: false,
        message: `Max ${MAX_PER_HOUR}/hour exceeded | Remaining: ${
          MAX_PER_HOUR - mailLimits[email].count
        }`
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
      from: `"${senderName || "Anonymous"}" <${email}>`,
      to: r,
      subject: subject || "Quick Note",
      text: message || ""
    }));

    await sendBatch(transporter, mails);

    mailLimits[email].count += recipientList.length;

    return res.json({
      success: true,
      message: `Sent ${recipientList.length} | Used ${mailLimits[email].count}/${MAX_PER_HOUR}`
    });

  } catch (err) {
    return res.json({
      success: false,
      message: err.message
    });
  }
});

// ================= START =================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
