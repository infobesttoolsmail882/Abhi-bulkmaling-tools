import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "150kb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Aapki Limits (Fixed) ---
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120; 

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* 🛡️ INBOX PROTECTION LOGIC */
const buildSecureHTML = (content) => {
    // Har mail ko technical level par unique banane ke liye invisible hash
    const ghostCode = crypto.randomBytes(8).toString('hex');
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #202124; line-height: 1.5;">
        ${content.replace(/\n/g, '<br>')}
        <div style="display:none; color:transparent; font-size:0px;">#${ghostCode}</div>
    </div>`;
};

async function deliverMails(transporter, mailQueue) {
    let successCount = 0;
    for (let i = 0; i < mailQueue.length; i += PARALLEL) {
        const batch = mailQueue.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        
        results.forEach(res => { if (res.status === "fulfilled") successCount++; });
        
        // Safety gap to mimic human speed
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 50));
    }
    return successCount;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message)
        return res.json({ success: false, msg: "Missing Info ❌" });

    if (!stats[gmail]) stats[gmail] = { count: 0 };
    if (stats[gmail].count >= HOURLY_LIMIT)
        return res.json({ success: false, msg: "Limit Reached ❌" });

    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));
    const quotaLeft = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > quotaLeft)
        return res.json({ success: false, msg: `Only ${quotaLeft} slots left.` });

    // 🏆 PROFESSIONAL SMTP CONFIG
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true,           // Important: connection reuse karta hai
        maxConnections: 3,    // Google guidelines ke hisaab se
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: subject,
        html: buildSecureHTML(message),
        // Corporate SMTP Headers
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3',
            'Message-ID': `<${crypto.randomUUID()}@mail.gmail.com>`,
            'X-Entity-ID': crypto.randomBytes(12).toString('base64'),
            'Importance': 'normal'
        }
    }));

    try {
        const sent = await deliverMails(transporter, mails);
        stats[gmail].count += sent;
        res.json({ success: true, sent });
    } catch (err) {
        res.json({ success: false, msg: "Server Error ❌" });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Inbox-Safe Engine Ready: Port ${PORT}`));
