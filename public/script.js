// Auth check on launcher
if (window.location.pathname.includes("launcher.html")) {
  fetch("/check-auth")
    .then(res => res.json())
    .then(data => {
      if (!data.authenticated) {
        window.location.href = "/login.html";
      }
    });
}

function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const error = document.getElementById("error");

  error.innerText = "";

  if (!username || !password) {
    error.innerText = "All fields required";
    return;
  }

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      window.location.href = "/launcher.html";
    } else {
      error.innerText = data.message || "Invalid credentials";
    }
  })
  .catch(() => {
    error.innerText = "Server error";
  });
}

function logout() {
  fetch("/logout")
    .then(() => {
      window.location.href = "/login.html";
    });
}
