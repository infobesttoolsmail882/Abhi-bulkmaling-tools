import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const HOURLY_LIMIT = 28;
const PARALLEL = 3;
const DELAY_MS = 120;
let stats = {};
setInterval(() => { stats = {}; }, 3600000);

// 🛡️ ANTI-SPAM SPINNER: Risky words ko automatically safe synonyms se badal deta hai
const bypassFilter = (text) => {
    const replacements = {
        "technical error": ["indexing glitch", "display anomaly", "backend discrepancy", "configuration gap"],
        "blocks": ["restricts", "limits", "impacts", "hinders"],
        "Google": ["search engine results", "online visibility", "organic search", "web presence"],
        "screen shot": ["visual report", "capture", "proof", "detailed image"]
    };
    
    let spun = text;
    for (const [key, values] of Object.entries(replacements)) {
        const regex = new RegExp(key, "gi");
        spun = spun.replace(regex, () => values[Math.floor(Math.random() * values.length)]);
    }

    // Har mail ke end mein invisible random code (Gmail pattern todne ke liye)
    const ghostID = crypto.randomBytes(10).toString('hex');
    return `${spun} <div style="display:none; color:transparent; font-size:0px;">ID:${ghostID}</div>`;
};

async function deliverSafeBatch(transporter, mails) {
    let count = 0;
    for (let i = 0; i < mails.length; i += PARALLEL) {
        const batch = mails.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        results.forEach(r => { if (r.status === "fulfilled") count++; });
        
        // Human-like sending delay
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 100));
    }
    return count;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;
    
    if (!gmail || !apppass || !to) return res.json({ success: false, msg: "Missing fields ❌" });

    if (!stats[gmail]) stats[gmail] = 0;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));
    
    if (stats[gmail] + recipients.length > HOURLY_LIMIT) 
        return res.json({ success: false, msg: "Limit (28/hr) reached ❌" });

    // 🏆 PROFESSIONAL SMTP HANDSHAKE
    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Reuses connections for higher trust
        maxConnections: 3,
        maxMessages: 28,
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: bypassFilter(subject || "Important site update"),
        html: `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #202124;">
                ${bypassFilter(message).replace(/\n/g, '<br>')}
               </div>`,
        headers: { 
            'X-Mailer': 'Microsoft Outlook 16.0',
            'X-Priority': '3',
            'Message-ID': `<${crypto.randomUUID()}@mail.gmail.com>`,
            'X-Entity-ID': crypto.randomBytes(8).toString('hex')
        }
    }));

    try {
        const sentCount = await deliverSafeBatch(transporter, mails);
        stats[gmail] += sentCount;
        res.json({ success: true, sent: sentCount });
    } catch (e) {
        res.json({ success: false, msg: "SMTP Auth Failed ❌" });
    }
});

app.listen(3000, () => console.log("🚀 Safe Engine Online at Port 3000"));
