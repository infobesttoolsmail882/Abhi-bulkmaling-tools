if (!sessionStorage.getItem("auth")) location.href = "/login.html";

let sending = false;

const sendBtn = document.getElementById("sendBtn");
const logoutBtn = document.getElementById("logoutBtn");

sendBtn.onclick = () => { if (!sending) sendMail(); };

logoutBtn.onclick = () => {
  if (!sending) {
    sessionStorage.clear();
    location.href = "/login.html";
  }
};

async function sendMail() {
  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending…";

  try {
    const res = await fetch("/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": sessionStorage.getItem("auth")
      },
      body: JSON.stringify({
        senderName: senderName.value.trim(),
        gmail: gmail.value.trim(),
        apppass: apppass.value.trim(),
        subject: subject.value.trim(),
        message: message.value.trim(),
        to: to.value.trim()
      })
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.msg || "Sending failed ❌");
      return;
    }

    alert(`Send_1 ✅\nEmails Sent: ${data.sent}`);

  } catch {
    alert("Server error ❌");
  } finally {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.innerText = "Send All";
  }
}
