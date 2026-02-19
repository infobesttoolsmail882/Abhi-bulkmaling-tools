const express = require("express");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = "SUPER_SECRET_KEY_CHANGE_THIS";

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

const USER = {
  username: "admin",
  password: bcrypt.hashSync("1234", 10)
};

const rateStore = new Map();
const MAX_PER_HOUR = 28;
const ONE_HOUR = 60 * 60 * 1000;

function checkLimit(email) {
  const now = Date.now();

  if (!rateStore.has(email)) {
    rateStore.set(email, { count: 0, startTime: now });
  }

  const data = rateStore.get(email);

  if (now - data.startTime > ONE_HOUR) {
    data.count = 0;
    data.startTime = now;
  }

  if (data.count >= MAX_PER_HOUR) {
    return false;
  }

  data.count++;
  return true;
}

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username !== USER.username) {
    return res.status(401).json({ error: "Invalid login" });
  }

  const valid = await bcrypt.compare(password, USER.password);
  if (!valid) {
    return res.status(401).json({ error: "Invalid login" });
  }

  const token = jwt.sign({ username }, SECRET, { expiresIn: "2h" });
  res.json({ token });
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  try {
    const token = header.split(" ")[1];
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/send", auth, async (req, res) => {
  try {
    const { senderName, email, appPassword, subject, message, recipients } = req.body;

    if (!checkLimit(email)) {
      return res.status(429).json({
        error: "Limit reached (28 per hour)"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: email, pass: appPassword }
    });

    await transporter.sendMail({
      from: `"${senderName}" <${email}>`,
      to: recipients,
      subject,
      text: message
    });

    res.json({ success: "Email sent successfully" });

  } catch (err) {
    res.status(500).json({ error: "Sending failed" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
