<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sistem Absensi</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f6f9; margin: 0; }
        .login-card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 320px; text-align: center; }
        input { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background-color: #0d6efd; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
        button:hover { background-color: #0b5ed7; }
        .error-msg { color: red; margin-top: 10px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="login-card">
        <h2>Sistem Absensi</h2>
        <p>Masukkan akun Anda untuk masuk</p>
        <form id="loginForm">
            <input type="text" id="username" placeholder="Username" required>
            <input type="password" id="password" placeholder="Password" required>
            <button type="submit">Masuk</button>
        </form>
        <div id="errorMsg" class="error-msg"></div>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorMsg = document.getElementById('errorMsg');

            errorMsg.innerText = '';

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (data.success) {
                    window.location.href = data.redirectUrl;
                } else {
                    errorMsg.innerText = data.message;
                }
            } catch (err) {
                errorMsg.innerText = 'Gagal terhubung ke server.';
            }
        });
    </script>
</body>
</html>
