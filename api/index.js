const express = require('express');
const app = express();

app.use(express.json());

// Tes route
app.get('/api', (req, res) => {
  res.json({ status: 'OK', message: 'Backend Vercel terhubung!' });
});

// Respon login sukses tanpa cek DB dulu
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    return res.status(200).json({ success: true, message: 'Login Berhasil' });
  }
  return res.status(400).json({ error: 'Isi username dan password' });
});

module.exports = app;
