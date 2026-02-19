async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (data.success) {
    window.location.href = "/launcher.html";
  } else {
    alert("Invalid Login");
  }
}

function logout() {
  window.location.href = "/login.html";
}

async function sendMail() {
  const senderName = document.getElementById("senderName").value;
  const email = document.getElementById("email").value;
  const appPassword = document.getElementById("appPassword").value;
  const subject = document.getElementById("subject").value;
  const message = document.getElementById("message").value;
  const recipients = document.getElementById("recipients").value;

  const res = await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderName,
      email,
      appPassword,
      subject,
      message,
      recipients
    })
  });

  const data = await res.json();
  const status = document.getElementById("status");

  if (data.success) {
    status.innerText = `Sent: ${data.sent}`;
  } else {
    status.innerText = data.error || "Failed";
  }
}
