require("dotenv").config();
const express = require("express");
const session = require("express-session");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.static("public"));

// Login API
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.user = username;
    return res.redirect("/dashboard.html");
  }

  res.send("Invalid Login ❌");
});

// Protect Dashboard
app.get("/dashboard.html", (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on port " + PORT));
