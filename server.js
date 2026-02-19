const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "secureSecretKey123",
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, "public")));


// 🔐 HARDCODED LOGIN
const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }

  res.json({ success: false });
});


app.get("/launcher.html", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(__dirname, "public/launcher.html"));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
