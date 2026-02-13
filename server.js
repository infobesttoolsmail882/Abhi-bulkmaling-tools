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

/* CONFIGURATION (Aapke logic ke mutabiq) */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120;

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000); // Reset every hour

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* INBOX SAFETY: Technical Signature Injection */
const getInboxSafeHTML = (msg) => {
    // Unique ID jo recipient ko nahi dikhegi but Gmail ka pattern break karegi
    const ghostID = crypto.randomBytes(12).toString('hex');
    return `
    <html>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; color: #333;">
            <div style="padding: 10px;">${msg.replace(/\n/g, '<br>')}</div>
            <div style="font-size:0px; color:transparent; opacity:0; mso-hide:all;">RefID-${ghostID}</div>
        </body>
    </html>`;
};

/* Parallel Processing Engine */
async function sendBatch(transporter, mails) {
    let sent = 0;
    for (let i = 0; i < mails.length; i += PARALLEL) {
        const batch = mails.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        
        results.forEach(r => { if (r.status === "fulfilled") sent++; });
        
        // Fast but human-like gap
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
    return sent;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message)
        return res.json({ success: false, msg: "Fields empty ❌" });

    if (!stats[gmail]) stats[gmail] = { count: 0 };
    if (stats[gmail].count >= HOURLY_LIMIT)
        return res.json({ success: false, msg: "Hourly limit (28) reached ❌" });

    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => emailRegex.test(r));
    const remaining = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > remaining)
        return res.json({ success: false, msg: `Limit error! Only ${remaining} left.` });

    // TRANSPORTER: High Trust Settings
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Reuses connections (Very important for Inbox)
        maxConnections: 3,
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: subject,
        html: getInboxSafeHTML(message),
        // Professional SMTP Headers (Bypasses Spam Filters)
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3 (Normal)',
            'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
            'X-Entity-Ref-ID': crypto.randomBytes(10).toString('hex'),
            'List-Unsubscribe': `<mailto:${gmail}?subject=unsubscribe>`
        }
    }));

    try {
        const totalSent = await sendBatch(transporter, mails);
        stats[gmail].count += totalSent;
        res.json({ success: true, sent: totalSent });
    } catch (err) {
        res.json({ success: false, msg: "Engine Error ❌" });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Safe Server running on Port ${PORT}`));
