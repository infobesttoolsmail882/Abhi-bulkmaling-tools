import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Root route fix (Cannot GET / problem solved) */
app.get("/", (req, res) => {
  res.send("✅ Safe Mail Server Running Successfully");
});

/* ================= SETTINGS ================= */

const HOURLY_LIMIT = 28;
const DELAY_MS = 150;
let stats = {};

/* Reset hourly limit */
setInterval(() => {
  stats = {};
}, 3600000);

/* Delay helper */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ================= SEND ROUTE ================= */

app.post("/send", async (req, res) => {
  try {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to) {
      return res.json({ success: false, msg: "Required fields missing" });
    }

    if (!stats[gmail]) stats[gmail] = 0;

    const recipients = to
      .split(/,|\n/)
      .map(r => r.trim())
      .filter(r => r.includes("@"));

    if (recipients.length === 0) {
      return res.json({ success: false, msg: "No valid recipients" });
    }

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

      } catch (err) {
        console.log("Failed to send:", recipient);
      }
    }

    stats[gmail] += sentCount;

    return res.json({
      success: true,
      sent: sentCount
    });

  } catch (error) {
    return res.json({
      success: false,
      msg: "Server error"
    });
  }
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
