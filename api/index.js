const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
        wa_ortu TEXT[],
        status_kelulusan VARCHAR(50) DEFAULT 'Aktif'
      );

      CREATE TABLE IF NOT EXISTS alumni (
        id SERIAL PRIMARY KEY,
        sekolah_id INT REFERENCES sekolah(id) ON DELETE CASCADE,
        nisn VARCHAR(50) NOT NULL,
        nama_siswa VARCHAR(150) NOT NULL,
        kelas_terakhir VARCHAR(50) NOT NULL,
        nama_ortu VARCHAR(150),
        tanggal_lulus DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS absensi (
        id SERIAL PRIMARY KEY,
        siswa_id INT REFERENCES siswa(id) ON DELETE CASCADE,
        tanggal DATE DEFAULT CURRENT_DATE,
        jam_masuk VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'Tanpa Keterangan',
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

// API Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT u.*, s.nama_sekolah, s.logo, s.alamat FROM users u 
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
    res.status(500).json({ success: false, error: 'Koneksi database gagal: ' + err.message });
  }
});

// API Sekolah & Upload Logo
app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat, logo } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO sekolah (nama_sekolah, alamat, logo) VALUES ($1, $2, $3) RETURNING *`,
      [nama_sekolah, alamat, logo]
    );
    res.json({ success: true, sekolah: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Siswa Aktif per Sekolah dengan Filter Nama/Kelas
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { search, kelas } = req.query;
  try {
    let query = `SELECT * FROM siswa WHERE (status_kelulusan IS NULL OR status_kelulusan = 'Aktif')`;
    let params = [];
    let idx = 1;

    if (sekolahId && sekolahId !== '0') {
      query += ` AND sekolah_id = $${idx++}`;
      params.push(sekolahId);
    }
    if (search) {
      query += ` AND (nama_siswa ILIKE $${idx} OR nisn ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (kelas) {
      query += ` AND kelas = $${idx++}`;
      params.push(kelas);
    }

    query += ' ORDER BY kelas, nama_siswa ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  try {
    await pool.query(
      `INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu, status_kelulusan) 
       VALUES ($1, $2, $3, $4, $5, $6, 'Aktif')
       ON CONFLICT (nisn) DO UPDATE SET 
       nama_siswa = EXCLUDED.nama_siswa, kelas = EXCLUDED.kelas, nama_ortu = EXCLUDED.nama_ortu, wa_ortu = EXCLUDED.wa_ortu, status_kelulusan = 'Aktif'`,
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list]
    );
    res.json({ success: true, message: 'Data siswa berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/siswa/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM siswa WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Siswa berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Luluskan Siswa (Masuk Alumni Permanen)
app.post('/api/luluskan-siswa/:id', async (req, res) => {
  const siswaId = req.params.id;
  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE id = $1', [siswaId]);
    if (siswaRes.rows.length === 0) return res.status(404).json({ error: 'Siswa tidak ditemukan!' });
    const s = siswaRes.rows[0];

    await pool.query(
      `INSERT INTO alumni (sekolah_id, nisn, nama_siswa, kelas_terakhir, nama_ortu, tanggal_lulus) 
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
      [s.sekolah_id, s.nisn, s.nama_siswa, s.kelas, s.nama_ortu]
    );

    await pool.query('DELETE FROM siswa WHERE id = $1', [siswaId]);
    res.json({ success: true, message: 'Siswa berhasil dipindahkan ke data alumni secara permanen!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Alumni dengan Filter
app.get('/api/alumni/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { search, tahun } = req.query;
  try {
    let query = 'SELECT * FROM alumni WHERE 1=1';
    let params = [];
    let idx = 1;

    if (sekolahId && sekolahId !== '0') {
      query += ` AND sekolah_id = $${idx++}`;
      params.push(sekolahId);
    }
    if (search) {
      query += ` AND (nama_siswa ILIKE $${idx} OR nisn ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (tahun) {
      query += ` AND EXTRACT(YEAR FROM tanggal_lulus) = $${idx++}`;
      params.push(tahun);
    }

    query += ' ORDER BY tanggal_lulus DESC, nama_siswa ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/alumni/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM alumni WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Data alumni berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan QR Code / NISN (Otomatis Hadir)
app.post('/api/absensi-barcode-nisn', async (req, res) => {
  const { nisn, pendaftar_id } = req.body;
  if (!nisn) return res.status(400).json({ error: 'NISN / QR Code tidak valid!' });
  
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE nisn = $1', [nisn.trim()]);
    if (siswaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Siswa dengan NISN/QR tersebut tidak ditemukan!' });
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

// Update Status Absensi Manual oleh Guru Piket (Hadir, Sakit, Izin, Tanpa Keterangan)
app.put('/api/absensi-status', async (req, res) => {
  const { siswa_id, tanggal, status, user_id } = req.body;
  const jamSekarang = status === 'Hadir' ? new Date().toLocaleTimeString('id-ID') : null;
  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = EXCLUDED.status, jam_masuk = COALESCE(EXCLUDED.jam_masuk, absensi.jam_masuk), user_id = EXCLUDED.user_id`,
      [siswa_id, tanggal || new Date().toISOString().split('T')[0], jamSekarang, status, user_id]
    );
    res.json({ success: true, message: 'Status absensi berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rekap Harian / Bulanan / Tahunan dengan Filter Nama, Tanggal, Bulan, Tahun
app.get('/api/rekap-harian/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { tanggal, bulan, tahun, search, status } = req.query;
  const targetTanggal = tanggal || new Date().toISOString().split('T')[0];

  try {
    let query = `
      SELECT 
        s.id as siswa_id,
        s.nisn, 
        s.nama_siswa, 
        s.kelas,
        COALESCE(a.status, 'Tanpa Keterangan') as status,
        COALESCE(a.tanggal, $2::DATE) as tanggal,
        a.jam_masuk,
        u.nama as nama_piket
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = $2::DATE
      LEFT JOIN users u ON a.user_id = u.id
      WHERE (s.status_kelulusan IS NULL OR s.status_kelulusan = 'Aktif')
    `;
    let params = [sekolahId, targetTanggal];
    let idx = 3;

    if (sekolahId && sekolahId !== '0') {
      query += ` AND s.sekolah_id = $1`;
    } else {
      params = [targetTanggal];
      idx = 2;
    }

    if (search) {
      query += ` AND (s.nama_siswa ILIKE $${idx} OR s.nisn ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (bulan) {
      query += ` AND EXTRACT(MONTH FROM COALESCE(a.tanggal, CURRENT_DATE)) = $${idx++}`;
      params.push(bulan);
    }
    if (tahun) {
      query += ` AND EXTRACT(YEAR FROM COALESCE(a.tanggal, CURRENT_DATE)) = $${idx++}`;
      params.push(tahun);
    }
    if (status) {
      query += ` AND COALESCE(a.status, 'Tanpa Keterangan') = $${idx++}`;
      params.push(status);
    }

    query += ` ORDER BY s.kelas, s.nama_siswa ASC`;
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
    let query = `SELECT u.id, u.username, u.nama, u.role, u.sekolah_id FROM users u`;
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
  const { username, password, nama, role, sekolah_id, creator_role } = req.body;
  try {
    if (creator_role === 'OPERATOR' && role !== 'GURU_PIKET') {
      return res.status(403).json({ success: false, error: 'Akses ditolak! Operator hanya diizinkan menambahkan Guru Piket.' });
    }
    await pool.query(
      `INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)`,
      [username, password, nama, role, sekolah_id || null]
    );
    res.json({ success: true, message: 'Pengguna berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Pengguna berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
