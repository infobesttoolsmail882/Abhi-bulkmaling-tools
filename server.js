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

// 🛡️ SMART SPINNER: Yeh words ko change karega bina meaning badle
const spinText = (text) => {
    const map = {
        "technical error": ["indexing glitch", "display anomaly", "backend discrepancy", "configuration gap"],
        "blocks": ["restricts", "limits", "impacts", "hinders"],
        "Google": ["search engines", "online visibility", "organic search", "web results"],
        "screen shot": ["visual report", "capture", "proof", "image"],
        "email": ["message", "mail", "correspondence"]
    };

    let spun = text;
    for (const [key, values] of Object.entries(map)) {
        const regex = new RegExp(key, "gi");
        spun = spun.replace(regex, () => values[Math.floor(Math.random() * values.length)]);
    }
    return spun;
};

async function sendBatch(transporter, mails) {
    let success = 0;
    for (let i = 0; i < mails.length; i += PARALLEL) {
        const batch = mails.slice(i, i + PARALLEL);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        results.forEach(r => { if (r.status === "fulfilled") success++; });
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    return success;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;
    
    if (!gmail || !apppass || !to) return res.json({ success: false, msg: "Missing fields ❌" });

    if (!stats[gmail]) stats[gmail] = 0;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));
    
    if (stats[gmail] + recipients.length > HOURLY_LIMIT) 
        return res.json({ success: false, msg: "Limit (28/hr) reached ❌" });

    const transporter = nodemailer.createTransport({
        service: "gmail", pool: true, auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => {
        // Har mail ke liye subject aur body ko spin karega
        const spunSubject = spinText(subject || "Quick site observation");
        const spunMessage = spinText(message || "");
        const ghostID = crypto.randomBytes(6).toString('hex');

        return {
            from: `"${senderName || gmail}" <${gmail}>`,
            to: r,
            subject: spunSubject,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333;">
                    ${spunMessage.replace(/\n/g, '<br>')}
                    <br><br>
                    <span style="display:none; color:transparent;">#ref-${ghostID}</span>
                </div>`,
            headers: { 
                'X-Mailer': 'Microsoft Outlook 16.0',
                'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
                'X-Entity-ID': crypto.randomBytes(8).toString('hex')
            }
        };
    });

    try {
        const count = await sendBatch(transporter, mails);
        stats[gmail] += count;
        res.json({ success: true, sent: count });
    } catch (e) { res.json({ success: false, msg: "SMTP Error ❌" }); }
});

app.listen(3000, () => console.log("✅ Smart Spinner Engine Online"));
