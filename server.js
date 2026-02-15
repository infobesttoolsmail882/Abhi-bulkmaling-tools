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

// Aapki fixed limits
const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120; 

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* 🛡️ ULTRA-SAFE FINGERPRINTING ENGINE */
const bypassFilters = (text) => {
    // Zero-width characters (Invisible to humans, Unique to AI)
    const zwc = ["\u200b", "\u200c", "\u200d", "\uFEFF"];
    let uniqueTail = "";
    for(let i=0; i<15; i++) {
        uniqueTail += zwc[Math.floor(Math.random() * zwc.length)];
    }
    
    // Original content maintained + Invisible uniqueness added
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #202124;">
        ${text.replace(/\n/g, '<br>')}
        <div style="display:none !important; visibility:hidden; mso-hide:all; font-size:0px;">
            ${crypto.randomBytes(16).toString('hex')} ${uniqueTail}
        </div>
    </div>`;
};

async function secureBatchSend(transporter, mailList) {
    let success = 0;
    for (let i = 0; i < mailList.length; i += PARALLEL) {
        const batch = mailList.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        
        results.forEach(res => { if (res.status === "fulfilled") success++; });
        
        // Anti-Bot Delay (Human rhythm)
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 50));
    }
    return success;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;

    if (!gmail || !apppass || !to || !subject || !message)
        return res.json({ success: false, msg: "Missing fields ❌" });

    if (!stats[gmail]) stats[gmail] = { count: 0 };
    if (stats[gmail].count >= HOURLY_LIMIT)
        return res.json({ success: false, msg: "Hourly limit reached ❌" });

    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));
    const quota = HOURLY_LIMIT - stats[gmail].count;

    if (recipients.length > quota)
        return res.json({ success: false, msg: `Limit: Only ${quota} left.` });

    // 🏆 LEGITIMATE SMTP HANDSHAKE
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, 
        maxConnections: 3,
        maxMessages: 28,
        rateDelta: 2000,
        rateLimit: 5,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: `${subject} ${"\u200c".repeat(Math.floor(Math.random() * 5))}`,
        html: bypassFilters(message),
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3',
            'Message-ID': `<${crypto.randomUUID()}@mail.gmail.com>`,
            'X-Report-Abuse-To': `mailto:${gmail}`,
            'Importance': 'normal'
        }
    }));

    try {
        const count = await secureBatchSend(transporter, mails);
        stats[gmail].count += count;
        res.json({ success: true, sent: count });
    } catch (err) {
        res.json({ success: false, msg: "Connection Refused ❌" });
    }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Secure Engine Online: ${PORT}`));
