import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* LIMITS & SPEED SETTINGS */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120; // Fast response delay

let stats = {};
// Hourly Reset Logic
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Clean Formatting Logic (Bypasses Spam Fingerprinting) */
const getSafeHTML = (msg) => {
    const ghostID = crypto.randomBytes(8).toString('hex');
    return `<html><body style="font-family: Arial, sans-serif;">${msg.replace(/\n/g, '<br>')}<div style="display:none; color:transparent; font-size:0px;">${ghostID}</div></body></html>`;
};

/* High-Speed Parallel Engine */
async function sendParallel(transporter, mails) {
    let successCount = 0;
    for (let i = 0; i < mails.length; i += PARALLEL) {
        const batch = mails.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        
        results.forEach(r => {
            if (r.status === "fulfilled") successCount++;
        });
        
        // Anti-Detection Delay
        await new Promise(res => setTimeout(res, DELAY_MS));
    }
    return successCount;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message) {
        return res.json({ success: false, msg: "All fields required ❌" });
    }

    if (!stats[gmail]) stats[gmail] = { count: 0 };
    if (stats[gmail].count >= HOURLY_LIMIT) {
        return res.json({ success: false, msg: "Limit (28/hr) reached! ❌" });
    }

    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => emailRegex.test(r));
    const remaining = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > remaining) {
        return res.json({ success: false, msg: `Only ${remaining} slots available! ❌` });
    }

    // SMTP Configuration with High-Trust Settings
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmail, pass: apppass },
        pool: true, // Reuses connections for speed
        maxConnections: 3,
        maxMessages: 28
    });

    /* GENERATING INBOX-SAFE MAILS */
    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: subject,
        html: getSafeHTML(message),
        // Professional Headers to prevent Spam/Block
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3 (Normal)',
            'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
            'X-Entity-Ref-ID': crypto.randomBytes(10).toString('hex')
        }
    }));

    try {
        const sent = await sendParallel(transporter, mails);
        stats[gmail].count += sent;
        res.json({ success: true, sent });
    } catch (err) {
        res.json({ success: false, msg: "Delivery Engine Error ❌" });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Inbox-Safe Server running on port ${PORT}`));
