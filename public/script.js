const sendBtn = document.getElementById("sendBtn");
const logoutBtn = document.getElementById("logoutBtn");

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending...";

  const res = await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderName: senderName.value,
      gmail: gmail.value,
      apppass: apppass.value,
      subject: subject.value,
      message: message.value,
      to: to.value
    })
  });

  const data = await res.json();

  if (data.success) {
    alert("Sent: " + data.sent);
  } else {
    alert(data.message);
  }

  sendBtn.disabled = false;
  sendBtn.innerText = "Send All";
};

logoutBtn.onclick = async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/";
};
