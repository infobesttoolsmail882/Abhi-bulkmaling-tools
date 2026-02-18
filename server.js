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

// --- Fixed Limits & Config ---
const HOURLY_LIMIT = 28;
const PARALLEL_BATCH = 3;
const DELAY_MS = 120; // Fast speed as requested

let stats = {};
setInterval(() => { stats = {}; }, 3600000); // Reset every hour

/**
 * 🛡️ INBOX GUARDIAN LOGIC
 * Yeh function har mail ke content mein invisible technical noise add karta hai
 * jisse Gmail ka filter bypass ho sake.
 */
const prepareSafeBody = (text) => {
    const uniqueID = crypto.randomBytes(16).toString('hex');
    const zeroWidthChars = ["\u200b", "\u200c", "\u200d"]; 
    const noise = zeroWidthChars[Math.floor(Math.random() * 3)].repeat(5);

    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #222;">
        ${text.replace(/\n/g, '<br>')}
        <div style="display:none; color:transparent; font-size:0px; line-height:0;">
            TRK-${uniqueID} ${noise}
        </div>
    </div>`;
};

/**
 * 🚀 FAST PARALLEL DELIVERY ENGINE
 */
async function sendParallelBatch(transporter, mailItems) {
    let sentCount = 0;
    for (let i = 0; i < mailItems.length; i += PARALLEL_BATCH) {
        const batch = mailItems.slice(i, i + PARALLEL_BATCH);
        
        const results = await Promise.allSettled(
            batch.map(m => transporter.sendMail(m))
        );

        results.forEach(res => {
            if (res.status === "fulfilled") sentCount++;
        });

        // 120ms delay + small random jitter for human-like behavior
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 30));
    }
    return sentCount;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message) {
        return res.json({ success: false, msg: "Missing Fields ❌" });
    }

    if (!stats[gmail]) stats[gmail] = 0;
    if (stats[gmail] >= HOURLY_LIMIT) {
        return res.json({ success: false, msg: `Hourly limit (${HOURLY_LIMIT}) reached ❌` });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => emailRegex.test(r));
    const available = HOURLY_LIMIT - stats[gmail];

    if (recipients.length > available) {
        return res.json({ success: false, msg: `Limit error! Only ${available} slots left.` });
    }

    // 🏆 PROFESSIONAL SMTP POOLING
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Reuses connections to prevent frequent login flags
        maxConnections: 3,
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: `${subject} \u200c`, // Added invisible character to unique-ify subject
        html: prepareSafeBody(message),
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0', // Emulates professional software
            'X-Priority': '3 (Normal)',
            'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
            'X-Entity-ID': crypto.randomBytes(10).toString('base64'),
            'Importance': 'normal'
        }
    }));

    try {
        const delivered = await sendParallelBatch(transporter, mails);
        stats[gmail] += delivered;
        res.json({ success: true, sent: delivered });
    } catch (err) {
        res.json({ success: false, msg: "Connection Failure ❌" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⭐ Safe Engine Active on Port ${PORT}`));
