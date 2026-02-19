if (!sessionStorage.getItem("auth"))
  window.location.href = "/login.html";

let sending = false;

const sendBtn = document.getElementById("sendBtn");
const logoutBtn = document.getElementById("logoutBtn");

sendBtn.onclick = () => { if (!sending) sendMail(); };

logoutBtn.onclick = () => {
  sessionStorage.clear();
  window.location.href = "/login.html";
};

async function sendMail() {

  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending...";

  try {
    const res = await fetch("/send", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
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

    if (!data.success)
      alert(data.msg);
    else
      alert("Emails Sent: " + data.sent);

  } catch {
    alert("Server error ❌");
  }

  sending = false;
  sendBtn.disabled = false;
  sendBtn.innerText = "Send All";
}
