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

/* CONFIGURATION (Fixed for Stability) */
const HOURLY_LIMIT = 28;
const PARALLEL_BATCH = 3;
const DELAY_MS = 120; 

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000); // Reset every hour

/* 🛡️ ANTI-SPAM LOGIC: Metadata Injection */
const prepareInboxBody = (content) => {
    // Unique fingerprint jo sirf server ko dikhta hai
    const traceId = crypto.randomBytes(16).toString('hex');
    return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333;">
        ${content.replace(/\n/g, '<br>')}
        <div style="margin-top:20px; padding-top:10px; border-top:1px solid #eee; font-size:10px; color:#aaa;">
            Security Verified: ID-${traceId}
        </div>
        <div style="display:none; white-space:nowrap; font-size:0px; color:transparent;">${crypto.randomUUID()}</div>
    </div>`;
};

/* 🚀 HIGH-SPEED SECURE ENGINE */
async function deliverInParallel(transporter, mailList) {
    let delivered = 0;
    for (let i = 0; i < mailList.length; i += PARALLEL_BATCH) {
        const currentBatch = mailList.slice(i, i + PARALLEL_BATCH);
        
        // Parallel execution within batch
        const tasks = currentBatch.map(mail => transporter.sendMail(mail));
        const results = await Promise.allSettled(tasks);
        
        results.forEach(res => { if (res.status === "fulfilled") delivered++; });
        
        // Fast Human-Delay
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    return delivered;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    // Validation
    if (!gmail || !apppass || !to || !subject || !message) {
        return res.json({ success: false, msg: "Required fields missing ❌" });
    }

    if (!stats[gmail]) stats[gmail] = { count: 0 };
    if (stats[gmail].count >= HOURLY_LIMIT) {
        return res.json({ success: false, msg: `Limit (${HOURLY_LIMIT}) reached for this Gmail ❌` });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => emailPattern.test(r));
    const quotaLeft = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > quotaLeft) {
        return res.json({ success: false, msg: `Quota Alert! You can only send ${quotaLeft} more.` });
    }

    // 🏆 PROFESSIONAL SMTP SETUP
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Reuses the same login session (Inbox Secret)
        maxConnections: 3,
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: subject,
        html: prepareInboxBody(message),
        // Trusted Corporate Headers
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3 (Normal)',
            'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
            'X-Entity-ID': crypto.randomBytes(8).toString('base64'),
            'X-Auto-Response-Suppress': 'OOF, AutoReply'
        }
    }));

    try {
        const finalSentCount = await deliverInParallel(transporter, mails);
        stats[gmail].count += finalSentCount;
        res.json({ success: true, sent: finalSentCount });
    } catch (err) {
        res.json({ success: false, msg: "SMTP Handshake Error ❌" });
    }
});

// Serve Login as Home
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⭐ Engine Started! http://localhost:${PORT}`));
