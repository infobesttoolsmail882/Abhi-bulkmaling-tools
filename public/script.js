// ===============================
// Secure Mail Console Script
// Clean + Safe Version
// ===============================

// Redirect if not logged in
if (!sessionStorage.getItem("auth")) {
  location.href = "/login.html";
}

// Elements
const sendBtn = document.getElementById("sendBtn");
const logoutBtn = document.getElementById("logoutBtn");
const countText = document.getElementById("countText");

const senderName = document.getElementById("senderName");
const gmail = document.getElementById("gmail");
const apppass = document.getElementById("apppass");
const subject = document.getElementById("subject");
const message = document.getElementById("message");
const to = document.getElementById("to");

let sending = false;

// ===============================
// Recipient Counter
// ===============================
to.addEventListener("input", () => {
  const list = parseEmails(to.value);
  countText.innerText = list.length;
});

// ===============================
// Send Button
// ===============================
sendBtn.onclick = () => {
  if (!sending) sendMail();
};

// ===============================
// Logout (Double Click)
// ===============================
logoutBtn.ondblclick = () => {
  if (!sending) {
    sessionStorage.clear();
    location.href = "/login.html";
  }
};

// ===============================
// Main Send Function
// ===============================
async function sendMail() {
  const emails = parseEmails(to.value);

  // Basic Validation
  if (
    !senderName.value.trim() ||
    !gmail.value.trim() ||
    !apppass.value.trim() ||
    !subject.value.trim() ||
    !message.value.trim() ||
    emails.length === 0
  ) {
    showPopup("Please fill all fields properly ❌", false);
    return;
  }

  if (!validateEmail(gmail.value.trim())) {
    showPopup("Invalid Gmail format ❌", false);
    return;
  }

  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending...";

  try {
    const res = await fetch("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderName: senderName.value.trim(),
        gmail: gmail.value.trim(),
        apppass: apppass.value.trim(),
        subject: subject.value.trim(),
        message: message.value.trim(),
        to: emails
      })
    });

    const data = await res.json();

    if (!data.success) {
      showPopup(data.msg || "Sending failed ❌", false);
      return;
    }

    showPopup(`Emails Sent: ${data.sent} ✅`, true);

  } catch (err) {
    showPopup("Server error ❌", false);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.innerText = "Send All";
  }
}

// ===============================
// Email Parser
// ===============================
function parseEmails(text) {
  return text
    .split(/[\n,]+/)
    .map(e => e.trim())
    .filter(e => e && validateEmail(e));
}

// ===============================
// Email Format Validation
// ===============================
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===============================
// Clean Popup Notification
// ===============================
function showPopup(message, success = true) {
  const div = document.createElement("div");
  div.innerText = message;

  div.style.position = "fixed";
  div.style.bottom = "30px";
  div.style.right = "30px";
  div.style.padding = "16px 22px";
  div.style.borderRadius = "14px";
  div.style.background = success ? "#22c55e" : "#ef4444";
  div.style.color = "#fff";
  div.style.fontSize = "15px";
  div.style.boxShadow = "0 15px 35px rgba(0,0,0,.15)";
  div.style.zIndex = "9999";
  div.style.opacity = "0";
  div.style.transition = "0.3s ease";

  document.body.appendChild(div);

  setTimeout(() => div.style.opacity = "1", 10);
  setTimeout(() => {
    div.style.opacity = "0";
    setTimeout(() => div.remove(), 300);
  }, 3000);
}
