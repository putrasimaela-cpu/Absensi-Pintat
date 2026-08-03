const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inisialisasi tabel otomatis jika belum ada
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sekolah (
        id SERIAL PRIMARY KEY,
        nama_sekolah VARCHAR(255) NOT NULL,
        alamat TEXT,
        logo TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        nama VARCHAR(150) NOT NULL,
        role VARCHAR(50) NOT NULL,
        sekolah_id INT REFERENCES sekolah(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS siswa (
        id SERIAL PRIMARY KEY,
        sekolah_id INT REFERENCES sekolah(id) ON DELETE CASCADE,
        nisn VARCHAR(50) UNIQUE NOT NULL,
        nama_siswa VARCHAR(150) NOT NULL,
        kelas VARCHAR(50) NOT NULL,
        nama_ortu VARCHAR(150),
        wa_ortu TEXT[]
      );

      CREATE TABLE IF NOT EXISTS absensi (
        id SERIAL PRIMARY KEY,
        siswa_id INT REFERENCES siswa(id) ON DELETE CASCADE,
        tanggal DATE DEFAULT CURRENT_DATE,
        jam_masuk VARCHAR(50),
        status VARCHAR(50) NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT unique_siswa_tanggal UNIQUE (siswa_id, tanggal)
      );
    `);
    console.log("Database tables verified successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}
initDb();

// Login API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.*, s.nama_sekolah, s.logo FROM users u 
       LEFT JOIN sekolah s ON u.sekolah_id = s.id 
       WHERE u.username = $1 AND u.password = $2`,
      [username, password]
    );
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ success: false, error: 'Username atau password salah!' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Sekolah
app.get('/api/sekolah', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sekolah ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Sekolah
app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat, logo } = req.body;
  try {
    await pool.query(
      'INSERT INTO sekolah (nama_sekolah, alamat, logo) VALUES ($1, $2, $3)',
      [nama_sekolah, alamat, logo]
    );
    res.json({ success: true, message: 'Sekolah berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Sekolah
app.delete('/api/sekolah/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sekolah WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Sekolah berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Siswa
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = 'SELECT * FROM siswa';
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ' WHERE sekolah_id = $1';
      params.push(sekolahId);
    }
    query += ' ORDER BY kelas, nama_siswa ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Siswa
app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  try {
    await pool.query(
      `INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu) 
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (nisn) DO UPDATE SET 
       nama_siswa = EXCLUDED.nama_siswa, kelas = EXCLUDED.kelas, nama_ortu = EXCLUDED.nama_ortu, wa_ortu = EXCLUDED.wa_ortu`,
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list]
    );
    res.json({ success: true, message: 'Data siswa berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Siswa
app.delete('/api/siswa/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM siswa WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Siswa berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan Barcode / QR (Otomatis Hadir & Rekam Petugas Piket)
app.post('/api/absensi-barcode-nisn', async (req, res) => {
  const { nisn, pendaftar_id } = req.body;
  if (!nisn) {
    return.status(400).json({ error: 'NISN tidak valid!' });
  }
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE nisn = $1', [nisn]);
    if (siswaRes.rows.length === 0) {
      return.status(404).json({ error: 'Siswa dengan NISN tersebut tidak ditemukan!' });
    }
    const siswa = siswaRes.rows[0];

    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, CURRENT_DATE, $2, 'Hadir', $3)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = 'Hadir', jam_masuk = EXCLUDED.jam_masuk, user_id = EXCLUDED.user_id`,
      [siswa.id, jamSekarang, pendaftar_id || null]
    );

    res.json({ success: true, nama_siswa: siswa.nama_siswa, kelas: siswa.kelas, jam: jamSekarang });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Absensi Manual
app.post('/api/absensi-manual', async (req, res) => {
  const { siswa_id, status, user_id } = req.body;
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, CURRENT_DATE, $2, $3, $4)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = EXCLUDED.status, jam_masuk = EXCLUDED.jam_masuk, user_id = EXCLUDED.user_id`,
      [siswa_id, jamSekarang, status, user_id || null]
    );
    res.json({ success: true, message: 'Status kehadiran berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Rekap Harian
app.get('/api/rekap/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = `
      SELECT a.*, s.nisn, s.nama_siswa, s.kelas, u.nama as nama_piket
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.tanggal = CURRENT_DATE
    `;
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ` AND s.sekolah_id = $1`;
      params.push(sekolahId);
    }
    query += ` ORDER BY a.id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Akumulasi Rekap Excel (Dengan Nama Guru Piket & Akumulasi Kehadiran)
app.get('/api/rekap-excel/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = `
      SELECT 
        s.nisn, 
        s.nama_siswa, 
        s.kelas,
        COUNT(CASE WHEN a.status = 'Hadir' THEN 1 END) as total_hadir,
        COUNT(CASE WHEN a.status = 'Sakit' THEN 1 END) as total_sakit,
        COUNT(CASE WHEN a.status = 'Izin' THEN 1 END) as total_izin,
        COUNT(CASE WHEN a.status = 'Tanpa Keterangan' OR a.status = 'Alpha' THEN 1 END) as total_alpha,
        MAX(u.nama) as guru_piket_terakhir
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id
      LEFT JOIN users u ON a.user_id = u.id
    `;
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ` WHERE s.sekolah_id = $1`;
      params.push(sekolahId);
    }
    query += ` GROUP BY s.id, s.nisn, s.nama_siswa, s.kelas ORDER BY s.kelas, s.nama_siswa ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Users Management
app.get('/api/users/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = `SELECT u.id, u.username, u.nama, u.role, s.nama_sekolah FROM users u LEFT JOIN sekolah s ON u.sekolah_id = s.id`;
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ` WHERE u.sekolah_id = $1`;
      params.push(sekolahId);
    }
    query += ` ORDER BY u.id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, nama, role, sekolah_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)`,
      [username, password, nama, role, sekolah_id || null]
    );
    res.json({ success: true, message: 'Pengelola berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Mengubah / Mereset Sandi Pengguna Lain
app.put('/api/admin/reset-password/:id', async (req, res) => {
  const userId = req.params.id;
  const { username, password } = req.body;
  try {
    await pool.query(
      `UPDATE users SET username = $1, password = $2 WHERE id = $3`,
      [username, password, userId]
    );
    res.json({ success: true, message: 'Username dan Password berhasil diperbarui oleh Admin!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Pengelola berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
