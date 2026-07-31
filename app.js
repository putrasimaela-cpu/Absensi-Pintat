const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Koneksi ke Database Neon.tech
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test koneksi database
pool.connect((err, client, release) => {
  if (err) {
    console.error('Gagal terhubung ke database Neon:', err.stack);
  } else {
    console.log('Berhasil terhubung ke database Neon!');
    release();
  }
});

// ==========================================
// 1. API LOGIN OTOMATIS BERDASARKAN ROLE
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, nama, username, role FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Username atau password salah!' });
    }

    const user = result.rows[0];

    // Penentuan Halaman Tujuan Berdasarkan Role
    let redirectUrl = '';
    switch (user.role) {
      case 'admin':
        redirectUrl = '/admin.html';
        break;
      case 'operator':
        redirectUrl = '/operator.html';
        break;
      case 'guru_piket':
        redirectUrl = '/scan.html';
        break;
      case 'kepala_sekolah':
        redirectUrl = '/rekap.html';
        break;
      default:
        redirectUrl = '/login.html';
    }

    res.json({
      success: true,
      user,
      redirectUrl
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 2. API SIMPAN PRESENSI HARIAN
// ==========================================
app.post('/api/presensi', async (req, res) => {
  const { siswa_id, status, keterangan, dicatat_oleh } = req.body;
  const tanggalHariIni = new Date().toISOString().split('T')[0];

  try {
    const query = `
      INSERT INTO presensi_harian (siswa_id, tanggal, waktu_masuk, status, keterangan, dicatat_oleh)
      VALUES ($1, $2, CURRENT_TIME, $3, $4, $5)
      RETURNING *;
    `;
    const result = await pool.query(query, [siswa_id, tanggalHariIni, status || 'Hadir', keterangan || '', dicatat_oleh]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Routing bawaan untuk membuka halaman utama
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server berjalan di port ${port}`);
});

module.exports = app;
