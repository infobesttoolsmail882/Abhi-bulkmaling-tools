const express = require("express");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = "CHANGE_THIS_SECRET_KEY_NOW";

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* SERVE PUBLIC FOLDER */
app.use(express.static(path.join(__dirname, "public")));

/* ROOT FIX (Cannot GET / FIXED) */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* LOGIN USER (2026 / 2026) */
const USER = {
  username: "2026",
  password: bcrypt.hashSync("2026", 10)
};

/* RATE LIMIT SYSTEM */
const rateStore = new Map();
const MAX_PER_HOUR = 28;
const ONE_HOUR = 60 * 60 * 1000;

function checkLimit(email, totalToSend) {
  const now = Date.now();

  if (!rateStore.has(email)) {
    rateStore.set(email, { count: 0, start: now });
  }

  const data = rateStore.get(email);

  if (now - data.start > ONE_HOUR) {
    data.count = 0;
    data.start = now;
  }

  if (data.count + totalToSend > MAX_PER_HOUR) {
    return false;
  }

  data.count += totalToSend;
  return true;
}

/* LOGIN ROUTE */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (username !== USER.username) {
    return res.status(401).json({ error: "Login Failed" });
  }

  const valid = await bcrypt.compare(password, USER.password);
  if (!valid) {
    return res.status(401).json({ error: "Login Failed" });
  }

  const token = jwt.sign({ username }, SECRET, { expiresIn: "2h" });
  res.json({ token });
});

/* AUTH MIDDLEWARE */
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = header.split(" ")[1];
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

/* FAST MAIL SENDER */
app.post("/send", auth, async (req, res) => {
  try {
    const { senderName, email, appPassword, subject, message, recipients } = req.body;

    if (!senderName || !email || !appPassword || !subject || !message || !recipients) {
      return res.status(400).json({ error: "All fields required" });
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r.length > 0);

    if (recipientList.length === 0) {
      return res.status(400).json({ error: "No valid recipients" });
    }

    if (!checkLimit(email, recipientList.length)) {
      return res.status(429).json({
        error: "Hourly limit (28) exceeded"
      });
    }

    /* Reusable transporter */
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: appPassword
      }
    });

    /* FAST PARALLEL SENDING */
    await Promise.all(
      recipientList.map(to =>
        transporter.sendMail({
          from: `"${senderName}" <${email}>`,
          to,
          subject,
          text: message
        })
      )
    );

    res.json({
      success: `Sent to ${recipientList.length} recipients successfully`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Sending Failed" });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Secure Mail Server Running on port " + PORT);
});
