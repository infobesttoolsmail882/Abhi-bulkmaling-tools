import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));


// 🔐 SIMPLE LOGIN (NO .env)
const ADMIN_USER = "admin";
const ADMIN_PASS = "12345";

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true });
  }

  res.json({ success: false });
});


// 📧 SEND MAIL ROUTE
app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, subject, message, to } = req.body;

    if (!gmail || !apppass || !subject || !message || !to) {
      return res.json({ success: false, msg: "All fields required" });
    }

    const recipients = to
      .split(/[\n,]+/)
      .map(e => e.trim())
      .filter(e => e);

    if (recipients.length === 0) {
      return res.json({ success: false, msg: "No recipients found" });
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
    res.json({ success: false, msg: "Server error" });
  }
});


app.listen(3000, () => {
  console.log("Server running on port 3000");
});
