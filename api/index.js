const express = require('express');
const { Pool } = require('pg');

const app = express();

// Middleware parsing JSON
app.use(express.json());

// Inisialisasi koneksi PostgreSQL (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Endpoint Testing (Cek Status Server)
app.get('/api', (req, res) => {
  res.status(200).json({ message: 'Serverless API Absensi Pintar Aktif!' });
});

// Endpoint Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Pengamanan login dasar (bisa disesuaikan dengan kueri database Anda)
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    }

    // Contoh Kueri Database ke PostgreSQL
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.status(200).json({
        success: true,
        message: 'Login berhasil!',
        user: {
          id: user.id,
          username: user.username,
          role: user.role || 'admin'
        }
      });
    } else {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Gagal terhubung ke database server.' });
  }
});

// Export handler khusus untuk Vercel Serverless Function
module.exports = app;
