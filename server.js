import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static folder
app.use(express.static(path.join(__dirname, "public")));


// =============================
// HOME ROUTE (Fix Cannot GET /)
// =============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});


// =============================
// LOGIN SYSTEM
// =============================
const ADMIN_USER = "2026@#";
const ADMIN_PASS = "2026@#";

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true });
  }

  res.json({ success: false });
});


// =============================
// SEND MAIL
// =============================
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !to) {
      return res.json({ success: false, msg: "Missing fields" });
    }

    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => e);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmail,
        pass: apppass
      }
    });

    let sent = 0;

    for (let email of recipients) {
      await transporter.sendMail({
        from: `"${senderName}" <${gmail}>`,
        to: email,
        subject: subject,
        text: message
      });
      sent++;
    }

    res.json({ success: true, sent });

  } catch (err) {
    console.log(err);
    res.json({ success: false, msg: "Server error" });
  }
});


// =============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
