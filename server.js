const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= LOGIN ================= */
const ADMIN_USERNAME = "@##2588^$$^O^%%^";
const ADMIN_PASSWORD = "@##2588^$$^O^%%^";

/* ================= LIMIT SETTINGS ================= */
const DAILY_LIMIT = 9500;
let sentToday = 0;
let lastReset = Date.now();

/* ================= RESET 24 HOURS ================= */
function resetDailyLimit() {
  const now = Date.now();
  if (now - lastReset >= 24 * 60 * 60 * 1000) {
    sentToday = 0;
    lastReset = now;
  }
}

/* ================= MIDDLEWARE ================= */
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(
  session({
    secret: "super_secure_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 60 * 60 * 1000 // 1 hour auto logout
    }
  })
);

/* ================= STATIC FILES ================= */
app.use("/public", express.static(path.join(__dirname, "public")));

/* ================= AUTH CHECK ================= */
function isAuthenticated(req, res, next) {
  if (req.session.user === ADMIN_USERNAME) return next();
  return res.redirect("/login");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/launcher");
  }
  res.redirect("/login");
});

/* LOGIN PAGE */
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.redirect("/launcher");
  }

  res.redirect("/login");
});

/* LAUNCHER PAGE */
app.get("/launcher", isAuthenticated, (req, res) => {
  resetDailyLimit();
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

/* DAILY STATUS API */
app.get("/status", isAuthenticated, (req, res) => {
  resetDailyLimit();
  res.json({
    sentToday,
    dailyLimit: DAILY_LIMIT
  });
});

/* LOGOUT */
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
