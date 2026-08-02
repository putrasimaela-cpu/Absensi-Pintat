const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Koneksi ke Database PostgreSQL / Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Endpoint untuk tes koneksi backend
app.get('/api', (req, res) => {
  res.json({ message: 'Server Backend Berhasil Berjalan!' });
});

// Endpoint Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan Password wajib diisi!' });
  }

  try {
    // Cek user di database
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Login Berhasil!',
        user: result.rows[0]
      });
    } else {
      return res.status(401).json({ error: 'Username atau Password salah!' });
    }
  } catch (err) {
    console.error('Database Error:', err);
    return res.status(500).json({ error: 'Gagal terhubung ke database server.' });
  }
});

module.exports = app;
