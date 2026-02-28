// ======================================================
// 🚀 SAFE PRODUCTION MAIL SERVER
// Fully Secure & Stable Version
// ======================================================

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();

// ======================================================
// 🔐 SECURITY MIDDLEWARE
// ======================================================

app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// ======================================================
// 🔐 RATE LIMITS (SAFE)
// ======================================================

// Login Protection
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/login", loginLimiter);

// API Protection
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

app.use("/send-mail", apiLimiter);

// ======================================================
// 🔐 SESSION CONFIG
// ======================================================

app.use(
  session({
    secret: process.env.SESSION_SECRET || "ChangeThisSecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 1000 * 60 * 30,
    },
  })
);

// ======================================================
// 🔐 ADMIN LOGIN
// ======================================================

const ADMIN_USER = "@##2588^$$^O^%%^";
const ADMIN_HASH = bcrypt.hashSync("@##2588^$$^O^%%^", 12);

// ======================================================
// 🔐 AUTH CHECK
// ======================================================

function isAuth(req, res, next) {
  if (!req.session.user) return res.status(401).send("Unauthorized");
  next();
}

// ======================================================
// 📧 MAIL TRANSPORTER (SAFE SMTP)
// ======================================================

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ======================================================
// 📬 SAFE MAIL QUEUE SYSTEM
// ======================================================

let mailQueue = [];
let sending = false;
const SAFE_DELAY = 3000; // 3 second delay between emails

async function processQueue() {
  if (sending || mailQueue.length === 0) return;

  sending = true;

  const mailData = mailQueue.shift();

  try {
    await transporter.sendMail(mailData);
    console.log("Mail Sent:", mailData.to);
  } catch (err) {
    console.log("Mail Error:", err.message);
  }

  setTimeout(() => {
    sending = false;
    processQueue();
  }, SAFE_DELAY);
}

// ======================================================
// 🌐 ROUTES
// ======================================================

app.get("/", (req, res) => {
  res.send(`
    <h2>Secure Mail Server</h2>
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" required />
      <input name="password" type="password" placeholder="Password" required />
      <button>Login</button>
    </form>
  `);
});

// LOGIN
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER) return res.send("Invalid");

  const match = await bcrypt.compare(password, ADMIN_HASH);
  if (!match) return res.send("Invalid");

  req.session.user = username;
  res.redirect("/dashboard");
});

// DASHBOARD
app.get("/dashboard", isAuth, (req, res) => {
  res.send(`
    <h3>Welcome Admin ✅</h3>
    <form method="POST" action="/send-mail">
      <input name="to" placeholder="Recipient Email" required />
      <input name="subject" placeholder="Subject" required />
      <textarea name="text" placeholder="Message"></textarea>
      <button>Send</button>
    </form>
    <a href="/logout">Logout</a>
  `);
});

// SEND MAIL (SAFE THROTTLED)
app.post("/send-mail", isAuth, async (req, res) => {
  const { to, subject, text } = req.body;

  if (!to || !subject) {
    return res.send("Missing fields");
  }

  const mailOptions = {
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
  };

  mailQueue.push(mailOptions);
  processQueue();

  res.send("Mail added to queue (safe mode)");
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ======================================================
// 🛑 GLOBAL ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).send("Server Error");
});

// ======================================================
// 🚀 START SERVER
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Secure Mail Server Running on Port", PORT);
});
