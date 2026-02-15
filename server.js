import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* 🔒 SAFE LIMIT SETTINGS */
const HOURLY_LIMIT = 28;   // Gmail safety
const DELAY_MS = 150;      // Slow & natural
let stats = {};

/* Reset hourly stats */
setInterval(() => {
  stats = {};
}, 3600000);

/* Delay helper */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!gmail || !apppass || !to) {
    return res.json({ success: false, msg: "Required fields missing" });
  }

  if (!stats[gmail]) stats[gmail] = 0;

  const recipients = to
    .split(/,|\n/)
    .map(r => r.trim())
    .filter(r => r.includes("@"));

  if (stats[gmail] + recipients.length > HOURLY_LIMIT) {
    return res.json({
      success: false,
      msg: `Hourly limit reached (${HOURLY_LIMIT})`
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

  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: recipient,
        subject: subject || "Hello",
        html: `
          <div style="font-family: Arial, sans-serif; color:#333;">
            ${(message || "").replace(/\n/g, "<br>")}
          </div>
        `
      });

      sentCount++;
      await delay(DELAY_MS);

    } catch (error) {
      console.log("Failed:", recipient);
    }
  }

  stats[gmail] += sentCount;

  return res.json({
    success: true,
    sent: sentCount
  });
});

app.listen(3000, () => {
  console.log("✅ Safe Mail Server Running on port 3000");
});
