let sending = false;

sendBtn.onclick = () => { if (!sending) sendMail(); };

logoutBtn.onclick = async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/";
};

async function sendMail() {
  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending...";

  const res = await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderName: senderName.value.trim(),
      email: gmail.value.trim(),
      appPassword: apppass.value.trim(),
      subject: subject.value.trim(),
      message: message.value.trim(),
      recipients: to.value.trim()
    })
  });

  const data = await res.json();

  alert(data.message || "Done");

  sending = false;
  sendBtn.disabled = false;
  sendBtn.innerText = "Send All";
}
