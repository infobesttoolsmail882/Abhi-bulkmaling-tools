const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

/* =======================
   SECURITY MIDDLEWARE
======================= */

// Rate limit (5 login attempts per 15 min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many login attempts. Try later." }
});

app.use(express.json());

app.use(session({
  secret: "abhi_secure_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // true if using HTTPS
    maxAge: 30 * 60 * 1000 // 30 minutes
  }
}));

app.use(express.static(path.join(__dirname, "public")));

/* =======================
   AUTH ROUTES
======================= */

// Login Route
app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return res.json({ success: false });
  }

  if (username === "admin" && password === "1234") {
    req.session.authenticated = true;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

// Check Auth
app.get("/check-auth", (req, res) => {
  if (req.session.authenticated) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/* =======================
   PROTECT LAUNCHER
======================= */

app.get("/launcher.html", (req, res, next) => {
  if (!req.session.authenticated) {
    return res.redirect("/login.html");
  }
  next();
});

/* =======================
   START SERVER
======================= */

app.listen(PORT, () => {
  console.log(`Secure Server running on http://localhost:${PORT}`);
});
