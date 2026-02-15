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

// --- 10 SAFE TEMPLATES INTERNAL ---
const templates = [
    { s: "Quick observation regarding your site", b: "Hi, I noticed a minor technical discrepancy on your site that might be affecting its online reach. Would it be okay if I forward a screenshot of what I found?" },
    { s: "Site performance note", b: "Hello, I was reviewing some site metrics and spotted a small indexing glitch on your page. Can I share a quick visual report with you?" },
    { s: "Just a quick heads-up", b: "Hey, I came across a small configuration hurdle on your website that’s hindering its search presence. May I provide a quick capture of the issue?" },
    { s: "Important site visibility update", b: "Greetings, I've identified a specific technical factor that is currently limiting your platform's organic growth. Should I send over the documented evidence?" },
    { s: "Found a small display issue", b: "Hi there, while browsing your portal, I noticed a small backend anomaly that's restricting its full visibility. Can I relay the findings to you?" },
    { s: "Regarding your web presence", b: "Hi, I performed a brief audit and found a small technical gap that's affecting how your site shows up. Can I provide more details and a visual?" },
    { s: "Question about your site's display", b: "Hey, I noticed a small hurdle on your platform today that’s affecting its search results. It’s a simple fix—can I send you a quick report?" },
    { s: "Site visibility report", b: "Hello, I’ve identified a specific indexing incident on your website that might be hindering its search traffic. May I email you the details?" },
    { s: "Quick note for you", b: "Hi, I found a minor technical glitch on your site that’s restricting its online visibility. Would you like me to share the visual proof?" },
    { s: "Observation on your portal", b: "Greetings, I noticed some visibility issues with your online platform that might affect search rankings. May I forward the details by email?" }
];

async function sendBatch(transporter, mails) {
    let sent = 0;
    for (let i = 0; i < mails.length; i += PARALLEL) {
        const batch = mails.slice(i, i + PARALLEL);
        await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
        sent += batch.length;
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    return sent;
}

app.post("/send", async (req, res) => {
    const { senderName, gmail, apppass, to } = req.body;
    if (!gmail || !apppass || !to) return res.json({ success: false, msg: "Missing fields" });

    if (!stats[gmail]) stats[gmail] = 0;
    const recipients = to.split(/,|\n/).map(r => r.trim()).filter(r => r.includes("@"));
    
    if (stats[gmail] + recipients.length > HOURLY_LIMIT) 
        return res.json({ success: false, msg: "Hourly limit (28) exceeded" });

    const transporter = nodemailer.createTransport({
        service: "gmail", pool: true, auth: { user: gmail, pass: apppass }
    });

    const mails = recipients.map(r => {
        const tpl = templates[Math.floor(Math.random() * templates.length)]; // Random Template
        return {
            from: `"${senderName || gmail}" <${gmail}>`,
            to: r,
            subject: tpl.s,
            text: `${tpl.b}\n\nThanks,\n${senderName || 'Technical Team'}`,
            headers: { 'X-Mailer': 'Microsoft Outlook 16.0', 'Message-ID': `<${crypto.randomUUID()}@gmail.com>` }
        };
    });

    try {
        const count = await sendBatch(transporter, mails);
        stats[gmail] += count;
        res.json({ success: true, sent: count });
    } catch (e) { res.json({ success: false, msg: "Error" }); }
});

app.listen(3000, () => console.log("Server Ready"));
