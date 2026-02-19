import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
const MAX_EMAIL_LIMIT = 20;       // max recipients per request
const DELAY_BETWEEN_EMAILS = 2000; // 2 sec delay
const LOGIN_USER = "2026";
const LOGIN_PASS = "2026";

// ====== MIDDLEWARE ======
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ====== SIMPLE RATE LIMIT (Memory Based) ======
let requestCount = 0;
setInterval(() => {
  requestCount = 0;
}, 60000); // reset every 1 minute

app.use((req, res, next) => {
  if (requestCount > 60) {
    return res.status(429).json({ error: "Too many requests. Try later." });
  }
  requestCount++;
  next();
});

// ====== ROOT FIX ======
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ====== LOGIN ROUTE ======
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === LOGIN_USER && password === LOGIN_PASS) {
    return res.json({ success: true });
  }

  return res.status(401).json({ success: false, error: "Invalid login" });
});

// ====== EMAIL VALIDATION ======
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// ====== SEND MAIL ROUTE ======
app.post("/send", async (req, res) => {
  try {
    const { email, appPassword, subject, message, recipients, senderName } = req.body;

    if (!email || !appPassword || !subject || !message || !recipients) {
      return res.status(400).json({ error: "All fields required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid sender email" });
    }

    let list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => isValidEmail(r));

    if (list.length === 0) {
      return res.status(400).json({ error: "No valid recipients found" });
    }

    if (list.length > MAX_EMAIL_LIMIT) {
      return res.status(400).json({
        error: `Max ${MAX_EMAIL_LIMIT} emails allowed per request`
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: appPassword
      }
    });

    for (let recipient of list) {
      await transporter.sendMail({
        from: `"${senderName || "Mailer"}" <${email}>`,
        to: recipient,
        subject: subject,
        text: message
      });

      await new Promise(resolve =>
        setTimeout(resolve, DELAY_BETWEEN_EMAILS)
      );
    }

    return res.json({
      success: true,
      sent: list.length
    });

  } catch (error) {
    console.error("Mail Error:", error.message);
    return res.status(500).json({ error: "Email sending failed" });
  }
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
