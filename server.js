const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= LOGIN ================= */
const ADMIN_USERNAME = "@##2588^$$^O^%%^";
const ADMIN_PASSWORD = "@##2588^$$^O^%%^";

/* ================= LIMIT SETTINGS ================= */
const DAILY_LIMIT = 9500;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300; // ms

let sentToday = 0;
let lastReset = Date.now();

/* ================= RESET EVERY 24 HOURS ================= */
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

function isAuthenticated(req, res, next) {
  if (req.session.user === ADMIN_USERNAME) return next();
  return res.redirect("/login");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  const error = req.query.error ? "<p style='color:red;'>Invalid Credentials</p>" : "";
  res.send(`
    <h2>🔐 Login</h2>
    ${error}
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" required /><br/><br/>
      <input type="password" name="password" placeholder="Password" required /><br/><br/>
      <button>Login</button>
    </form>
  `);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.redirect("/dashboard");
  }
  return res.redirect("/login?error=1");
});

/* ================= DASHBOARD (Launcher) ================= */

app.get("/dashboard", isAuthenticated, (req, res) => {
  resetDailyLimit();

  res.send(`
    <h2>🚀 Email Launcher</h2>
    <p>Daily Limit: ${sentToday} / ${DAILY_LIMIT}</p>

    <form method="POST" action="/send">
      <input type="number" name="count" placeholder="How many emails?" required />
      <button type="submit">Start Sending</button>
    </form>

    <br/>
    <a href="/logout">Logout</a>
  `);
});

/* ================= SEND SIMULATION ================= */

app.post("/send", isAuthenticated, async (req, res) => {
  resetDailyLimit();

  let count = parseInt(req.body.count);

  if (!count || count <= 0) {
    return res.send("Invalid number.");
  }

  if (sentToday + count > DAILY_LIMIT) {
    return res.send("❌ Daily limit exceeded (9500 max per 24h)");
  }

  let sent = 0;

  async function sendBatch() {
    for (let i = 0; i < BATCH_SIZE && sent < count; i++) {
      sent++;
      sentToday++;
    }

    if (sent < count) {
      setTimeout(sendBatch, BATCH_DELAY);
    }
  }

  sendBatch();

  res.send(`
    <h3>✅ Sending Started</h3>
    <p>Requested: ${count}</p>
    <p>Batch Size: ${BATCH_SIZE}</p>
    <p>Batch Delay: ${BATCH_DELAY}ms</p>
    <p>Total Sent Today: ${sentToday}</p>
    <br/>
    <a href="/dashboard">Back</a>
  `);
});

/* ================= LOGOUT ================= */

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
