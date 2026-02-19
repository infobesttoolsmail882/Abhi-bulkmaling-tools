async function sendEmails() {

  const email = document.getElementById("email").value;
  const appPassword = document.getElementById("password").value;
  const subject = document.getElementById("subject").value;
  const message = document.getElementById("message").value;
  const recipients = document.getElementById("recipients").value;

  const response = await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, appPassword, subject, message, recipients })
  });

  const data = await response.json();
  alert(data.message);
}
