require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================= CONFIG ================= */

const ADMIN_CREDENTIAL = "@##2588^$$^*O*^%%^";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "replace-this-with-long-random-secret";

const MAX_PER_HOUR = 27;

/* ================= SECURITY MIDDLEWARE ================= */

// Basic security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: "10kb" }));
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

/* ================= IN-MEMORY LIMIT STORE ================= */

const mailLimits = new Map();

function checkAndUpdateLimit(email) {
  const now = Date.now();
  const record = mailLimits.get(email);

  if (!record || now - record.startTime > 60 * 60 * 1000) {
    mailLimits.set(email, { count: 1, startTime: now });
    return { allowed: true, remaining: MAX_PER_HOUR - 1 };
  }

  if (record.count >= MAX_PER_HOUR) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: MAX_PER_HOUR - record.count };
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

/* ================= SEND EMAIL ================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipient, subject, message } =
      req.body || {};

    if (!email || !password || !recipient) {
      return res.json({
        success: false,
        message: "Email, password and recipient required"
      });
    }

    const limit = checkAndUpdateLimit(email);

    if (!limit.allowed) {
      return res.json({
        success: false,
        message: `Limit reached (${MAX_PER_HOUR}/hour)`
      });
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

    await transporter.sendMail({
      from: `"${senderName || "Anonymous"}" <${email}>`,
      to: recipient,
      subject: subject || "Quick Note",
      text: message || ""
    });

    return res.json({
      success: true,
      message: `Email sent. Remaining this hour: ${limit.remaining}`
    });

  } catch (error) {
    return res.json({
      success: false,
      message: "Failed to send email"
    });
  }
});

/* ================= ERROR HANDLER ================= */

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "Server error" });
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
