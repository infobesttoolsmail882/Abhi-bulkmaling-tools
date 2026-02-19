/* ================= LOGIN ================= */

const loginBtn = document.getElementById("loginBtn");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

if (loginBtn) {
  loginBtn.onclick = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      alert("Please enter login details");
      return;
    }

    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (data.success) {
      location.href = "/launcher";
    } else {
      alert(data.message || "Login Failed ❌");
    }
  };
}

/* ================= SEND MAIL ================= */

const sendBtn = document.getElementById("sendBtn");

if (sendBtn) {
  sendBtn.onclick = async () => {
    const senderName = document.getElementById("senderName").value.trim();
    const gmail = document.getElementById("gmail").value.trim();
    const apppass = document.getElementById("apppass").value.trim();
    const subject = document.getElementById("subject").value.trim();
    const message = document.getElementById("message").value.trim();
    const to = document.getElementById("to").value.trim();

    if (!gmail || !apppass || !to) {
      alert("Required fields missing");
      return;
    }

    sendBtn.disabled = true;
    sendBtn.innerText = "Sending...";

    try {
      const res = await fetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName,
          gmail,
          apppass,
          subject,
          message,
          to
        })
      });

      const data = await res.json();

      if (data.success) {
        alert("Emails sent successfully ✅ (" + data.sent + ")");
      } else {
        alert(data.message || "Failed to send");
      }

    } catch (err) {
      alert("Server Error");
    }

    sendBtn.disabled = false;
    sendBtn.innerText = "Send";
  };
}

/* ================= DOUBLE CLICK LOGOUT ================= */

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {

  // Single click warning
  logoutBtn.onclick = () => {
    alert("Double click to logout 🔒");
  };

  // Double click actual logout
  logoutBtn.ondblclick = async () => {
    logoutBtn.innerText = "Logging out...";
    logoutBtn.disabled = true;

    await fetch("/logout", { method: "POST" });

    location.href = "/";
  };
}
