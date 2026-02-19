import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const DAILY_LIMIT = 50;        // 🔒 Safe limit
const DELAY_MS = 8000;         // 🔒 8 sec delay

let sentToday = 0;

app.post("/send", async (req, res) => {
  try {
    if (sentToday >= DAILY_LIMIT) {
      return res.json({ success: false, message: "Daily limit reached." });
    }

    const { email, appPassword, subject, message, recipients } = req.body;

    const list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r);

    if (list.length === 0) {
      return res.json({ success: false, message: "No recipients found." });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: email,
        pass: appPassword
      }
    });

    let count = 0;

    for (let to of list) {
      if (sentToday >= DAILY_LIMIT) break;

      await transporter.sendMail({
        from: email,
        to,
        subject,
        text: message
      });

      sentToday++;
      count++;

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    res.json({ success: true, message: `Sent ${count} emails safely.` });

  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.listen(3000, () => {
  console.log("Safe Mail Console running on port 3000");
});
