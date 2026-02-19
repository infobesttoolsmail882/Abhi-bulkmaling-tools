const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");

const app = express();

// Render ke liye dynamic port
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: "abhi_secure_key_2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 30 * 60 * 1000
  }
}));

// Rate limit (5 login attempts / 15 min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many attempts. Try later." }
});

// Static
app.use(express.static(path.join(__dirname, "public")));

// 🔥 ROOT FIX (IMPORTANT)
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

/* ================= LOGIN ================= */

app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false });
  }

  if (username === "admin" && password === "1234") {
    req.session.auth = true;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

/* =============== CHECK AUTH =============== */

app.get("/check-auth", (req, res) => {
  res.json({ authenticated: !!req.session.auth });
});

/* =============== LOGOUT =============== */

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* =============== PROTECT LAUNCHER =============== */

app.get("/launcher.html", (req, res, next) => {
  if (!req.session.auth) {
    return res.redirect("/login.html");
  }
  next();
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
