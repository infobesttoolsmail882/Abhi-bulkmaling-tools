import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const MAX_LIMIT = 25;

// LOGIN CHECK
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "2026" && password === "2026") {
    return res.json({ success: true });
  } else {
    return res.json({ success: false });
  }
});

// SEND MAIL
app.post("/send", async (req, res) => {
  try {
    const { email, appPassword, subject, message, recipients, senderName } = req.body;

    let list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r);

    if (list.length > MAX_LIMIT) {
      return res.json({ error: `Limit exceeded (Max ${MAX_LIMIT})` });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: appPassword
      }
    });

    for (let r of list) {
      await transporter.sendMail({
        from: `"${senderName}" <${email}>`,
        to: r,
        subject: subject,
        text: message
      });

      await new Promise(resolve => setTimeout(resolve, 1500)); // delay
    }

    res.json({ success: true, sent: list.length });

  } catch (err) {
    res.json({ error: "Sending failed" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
