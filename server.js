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

const HOURLY_LIMIT = 28;
const PARALLEL = 3; 
const DELAY_MS = 120; 

let stats = {};
setInterval(() => { stats = {}; }, 3600000);

// Root Route fix for Render error
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "launcher.html"));
});

/* 🛡️ INBOX PROTECTION: Dynamic DNA Injection */
const injectTrustDNA = (text) => {
    const ghostID = crypto.randomBytes(16).toString('hex');
    // Invisible characters to break Gmail's content fingerprinting
    const noise = "\u200b\u200c\u200d".repeat(Math.floor(Math.random() * 5));
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #202124;">
        ${text.replace(/\n/g, '<br>')}
        <div style="display:none; color:transparent; font-size:0px; opacity:0; mso-hide:all;">
            Ref: ${ghostID} ${noise}
        </div>
    </div>`;
};

async function deliverMails(transporter, mailQueue) {
    let success = 0;
    for (let i = 0; i < mailQueue.length; i += PARALLEL) {
        const batch = mailQueue.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        results.forEach(r => { if (r.status === "fulfilled") success++; });
        
        // Fast but human-like jitter
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 80));
    }
    return success;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;
    if (!gmail || !apppass || !to) return res.json({ success: false, msg: "Fill all fields ❌" });

    if (!stats[gmail]) stats[gmail] = 0;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));

    if (stats[gmail] + recipients.length > HOURLY_LIMIT)
        return res.json({ success: false, msg: `Limit reached (${HOURLY_LIMIT}/hr) ❌` });

    // 🏆 HIGH-TRUST SMTP POOLING (Essential for Inbox)
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, 
        maxConnections: 3,
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: `${subject} \u200c`, // Invisible subject variation
        html: injectTrustDNA(message),
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3',
            'Message-ID': `<${crypto.randomUUID()}@mail.gmail.com>`,
            'X-Entity-Ref-ID': crypto.randomBytes(10).toString('hex'),
            'Importance': 'normal'
        }
    }));

    try {
        const count = await deliverMails(transporter, mails);
        stats[gmail] += count;
        res.json({ success: true, sent: count });
    } catch (e) {
        res.json({ success: false, msg: "SMTP Handshake Failed ❌" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⭐ Real Inbox Engine running on port ${PORT}`));
