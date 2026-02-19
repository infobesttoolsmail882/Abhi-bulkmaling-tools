const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= BASIC SECURITY ================= */

app.disable("x-powered-by");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= SESSION CONFIG ================= */

app.use(session({
  name: "secure_session",
  secret: process.env.SESSION_SECRET || "abhi_secure_key_2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Render HTTP use karta hai
    sameSite: "lax",
    maxAge: 30 * 60 * 1000 // 30 min
  }
}));

/* ================= RATE LIMIT ================= */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Try again later."
  }
});

/* ================= STATIC FILES ================= */

app.use(express.static(path.join(__dirname, "public")));

/* ================= ROOT FIX ================= */

app.get("/", (req, res) => {
  return res.redirect("/login.html");
});

/* ================= LOGIN ================= */

app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "All fields required" });
  }

  // CHANGE THESE CREDENTIALS IF NEEDED
  if (username === "admin" && password === "1234") {
    req.session.authenticated = true;
    return res.json({ success: true });
  }

  return res.json({ success: false, message: "Invalid credentials" });
});

/* ================= AUTH CHECK ================= */

app.get("/check-auth", (req, res) => {
  if (req.session.authenticated) {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
});

/* ================= PROTECT LAUNCHER ================= */

app.get("/launcher.html", (req, res, next) => {
  if (!req.session.authenticated) {
    return res.redirect("/login.html");
  }
  next();
});

/* ================= LOGOUT ================= */

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
