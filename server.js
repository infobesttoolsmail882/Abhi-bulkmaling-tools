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
  process.env.SESSION_SECRET || "change-this-secret";

const MAX_PER_HOUR = 27;

// In-memory limit store
// { email: { count: number, startTime: timestamp } }
let mailLimits = {};

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

// ================= SEND MAIL =================

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipient, subject, message } =
      req.body;

    if (!email || !password || !recipient) {
      return res.json({
        success: false,
        message: "Email, password and recipient required"
      });
    }

    const now = Date.now();

    // Reset limit after 1 hour
    if (
      !mailLimits[email] ||
      now - mailLimits[email].startTime > 60 * 60 * 1000
    ) {
      mailLimits[email] = { count: 0, startTime: now };
    }

    if (mailLimits[email].count >= MAX_PER_HOUR) {
      return res.json({
        success: false,
        message: `Limit reached: ${MAX_PER_HOUR}/hour`
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

    mailLimits[email].count++;

    return res.json({
      success: true,
      message: `Sent successfully (${mailLimits[email].count}/${MAX_PER_HOUR})`
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
