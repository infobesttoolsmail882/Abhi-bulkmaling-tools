import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve public folder properly
app.use(express.static(path.join(__dirname, "public")));

// 🔹 ROOT ROUTE FIX
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const LIMIT = 30;        // 🔒 Safe limit
const DELAY = 10000;     // 🔒 10 sec delay

app.post("/send", async (req, res) => {
  try {

    const { email, appPassword, subject, message, recipients } = req.body;

    if (!email || !appPassword) {
      return res.json({ success: false, message: "Email & App Password required" });
    }

    const list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r);

    if (list.length > LIMIT) {
      return res.json({ success: false, message: `Limit is ${LIMIT} emails per run.` });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: appPassword
      }
    });

    let sent = 0;

    for (let to of list) {

      await transporter.sendMail({
        from: email,
        to,
        subject,
        text: message
      });

      sent++;

      await new Promise(r => setTimeout(r, DELAY));
    }

    res.json({ success: true, message: `Safely sent ${sent} emails.` });

  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
