require("dotenv").config();
const express = require("express");
const session = require("express-session");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ✅ ROOT FIX
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

// ✅ LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.user = true;
    return res.json({ success: true });
  }

  res.json({ success: false });
});

// ✅ AUTH CHECK
function checkAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  next();
}

// ✅ SEND MAIL (SAFE LIMIT)
app.post("/send", checkAuth, async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !subject || !message || !to) {
      return res.json({ success: false, msg: "All fields required" });
    }

    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(Boolean);

    // 🔒 SAFE LIMIT (Max 50 per request)
    if (recipients.length > 50) {
      return res.json({
        success: false,
        msg: "Limit: 50 emails per send"
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    let sentCount = 0;

    for (let email of recipients) {
      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: subject,
        text: message
      });

      sentCount++;
    }

    res.json({ success: true, sent: sentCount });

  } catch (err) {
    console.error(err);
    res.json({ success: false, msg: "Sending failed" });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running...")
);
