const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================================
   LOGIN CREDENTIALS (SAME ID/PASS)
================================ */
const ADMIN_USERNAME = "@##2588^$$^O^%%^";
const ADMIN_PASSWORD = "@##2588^$$^O^%%^";

/* ================================
   MIDDLEWARE
================================ */
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(
  session({
    secret: "super_secure_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 60 * 60 * 1000 // 1 hour
    }
  })
);

/* ================================
   AUTH CHECK
================================ */
function isAuthenticated(req, res, next) {
  if (req.session.user === ADMIN_USERNAME) {
    return next();
  }
  return res.redirect("/login");
}

/* ================================
   ROUTES
================================ */

// Root Route
app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  res.redirect("/login");
});

// Login Page
app.get("/login", (req, res) => {
  const error = req.query.error ? "<p style='color:red;'>Invalid Credentials</p>" : "";

  res.send(`
    <html>
    <head>
      <title>Login</title>
      <style>
        body { font-family: Arial; background:#f4f6f9; text-align:center; padding-top:100px; }
        .box { background:white; padding:30px; display:inline-block; border-radius:10px; box-shadow:0 0 10px rgba(0,0,0,0.1); }
        input { padding:8px; margin:5px; width:250px; }
        button { padding:8px 15px; cursor:pointer; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>🔐 Secure Login</h2>
        ${error}
        <form method="POST" action="/login">
          <input type="text" name="username" placeholder="Username" required /><br/>
          <input type="password" name="password" placeholder="Password" required /><br/>
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Login POST
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = ADMIN_USERNAME;
    return res.redirect("/dashboard");
  }

  return res.redirect("/login?error=1");
});

// Dashboard
app.get("/dashboard", isAuthenticated, (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Dashboard</title>
    </head>
    <body style="font-family:Arial;text-align:center;padding-top:100px;">
      <h2>✅ Login Successful</h2>
      <p>Welcome Admin</p>
      <a href="/logout">Logout</a>
    </body>
    </html>
  `);
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* ================================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
