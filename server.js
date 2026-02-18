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

// --- Limits & Stats ---
const HOURLY_LIMIT = 28;
const PARALLEL_BATCH = 3;
const DELAY_MS = 120;
let stats = {};
setInterval(() => { stats = {}; }, 3600000);

// --- Fix for "Cannot GET /" ---
// Yeh line batati hai ki jab koi site khole toh login.html dikhao
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// --- Inbox Guard: Invisible Randomization ---
const prepareSafeBody = (text) => {
    const ghostID = crypto.randomBytes(12).toString('hex');
    return `<div style="font-family: Arial; color: #333;">
        ${text.replace(/\n/g, '<br>')}
        <div style="display:none; visibility:hidden; font-size:0px;">ID:${ghostID}</div>
    </div>`;
};

// --- Secure Delivery Engine ---
async function sendSafeParallel(transporter, mails) {
    let sent = 0;
    for (let i = 0; i < mails.length; i += PARALLEL_BATCH) {
        const batch = mails.slice(i, i + PARALLEL_BATCH);
        const results = await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        results.forEach(r => { if (r.status === "fulfilled") sent++; });
        await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 50));
    }
    return sent;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to, subject, message } = req.body;
    if (!gmail || !apppass || !to) return res.json({ success: false, msg: "Missing fields" });

    if (!stats[gmail]) stats[gmail] = 0;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));

    if (stats[gmail] + recipients.length > HOURLY_LIMIT)
        return res.json({ success: false, msg: `Limit reached (${HOURLY_LIMIT}/hr)` });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        pool: true, // Connection reuse for high trust
        auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => ({
        from: `"${senderName || gmail}" <${gmail}>`,
        to: r,
        subject: `${subject} \u200c`,
        html: prepareSafeBody(message),
        headers: {
            'X-Mailer': 'Microsoft Outlook 16.0',
            'Message-ID': `<${crypto.randomUUID()}@gmail.com>`,
            'X-Entity-ID': crypto.randomBytes(10).toString('hex')
        }
    }));

    try {
        const count = await sendSafeParallel(transporter, mails);
        stats[gmail] += count;
        res.json({ success: true, sent: count });
    } catch (e) {
        res.json({ success: false, msg: "SMTP Error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
