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
    res.status(500).json({ success: false, error: 'Koneksi database gagal: ' + err.message });
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

app.delete('/api/sekolah/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sekolah WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Sekolah berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Siswa Aktif
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = 'SELECT * FROM siswa WHERE (status_kelulusan IS NULL OR status_kelulusan = \'Aktif\')';
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ' AND sekolah_id = $1';
      params.push(sekolahId);
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

// API Luluskan Siswa
app.post('/api/luluskan-siswa/:id', async (req, res) => {
  const siswaId = req.params.id;
  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE id = $1', [siswaId]);
    if (siswaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Siswa tidak ditemukan!' });
    }
    const s = siswaRes.rows[0];

    await pool.query(
      `INSERT INTO alumni (sekolah_id, nisn, nama_siswa, kelas_terakhir, nama_ortu, tanggal_lulus) 
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
      [s.sekolah_id, s.nisn, s.nama_siswa, s.kelas, s.nama_ortu]
    );

    await pool.query('DELETE FROM siswa WHERE id = $1', [siswaId]);
    res.json({ success: true, message: 'Siswa berhasil diluluskan dan dipindahkan ke Data Alumni!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Get Data Alumni
app.get('/api/alumni/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = 'SELECT * FROM alumni';
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ' WHERE sekolah_id = $1';
      params.push(sekolahId);
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

// Scan Barcode / QR
app.post('/api/absensi-barcode-nisn', async (req, res) => {
  const { nisn, pendaftar_id } = req.body;
  if (!nisn) {
    return res.status(400).json({ error: 'NISN tidak valid!' });
  }
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE nisn = $1', [nisn]);
    if (siswaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Siswa dengan NISN tersebut tidak ditemukan atau sudah lulus!' });
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
  const { siswa_id, status, user_id, tanggal } = req.body;
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, COALESCE($2::DATE, CURRENT_DATE), $3, $4, $5)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = EXCLUDED.status, jam_masuk = EXCLUDED.jam_masuk, user_id = EXCLUDED.user_id`,
      [siswa_id, tanggal || null, jamSekarang, status, user_id || null]
    );
    res.json({ success: true, message: 'Status kehadiran berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Rekap Harian
app.get('/api/rekap-harian/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const tanggalQuery = req.query.tanggal || new Date().toISOString().split('T')[0];
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
    let params = [sekolahId, tanggalQuery];
    if (sekolahId && sekolahId !== '0') {
      query += ` AND s.sekolah_id = $1`;
    } else {
      query = `
        SELECT 
          s.id as siswa_id,
          s.nisn, 
          s.nama_siswa, 
          s.kelas,
          COALESCE(a.status, 'Tanpa Keterangan') as status,
          COALESCE(a.tanggal, $1::DATE) as tanggal,
          a.jam_masuk,
          u.nama as nama_piket
        FROM siswa s
        LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = $1::DATE
        LEFT JOIN users u ON a.user_id = u.id
        WHERE (s.status_kelulusan IS NULL OR s.status_kelulusan = 'Aktif')
      `;
      params = [tanggalQuery];
    }
    query += ` ORDER BY s.kelas, s.nama_siswa ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Arsip Absensi
app.get('/api/arsip-absensi/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const tanggalFilter = req.query.tanggal;
  try {
    let query = `
      SELECT 
        a.id as absensi_id,
        a.tanggal,
        s.nisn,
        s.nama_siswa,
        s.kelas,
        a.status,
        a.jam_masuk,
        u.nama as nama_piket
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      LEFT JOIN users u ON a.user_id = u.id
    `;
    let params = [];
    let conditions = [];

    if (sekolahId && sekolahId !== '0') {
      conditions.push(`s.sekolah_id = $${params.length + 1}`);
      params.push(sekolahId);
    }

    if (tanggalFilter) {
      conditions.push(`a.tanggal = $${params.length + 1}::DATE`);
      params.push(tanggalFilter);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY a.tanggal DESC, s.kelas ASC, s.nama_siswa ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rekap Excel
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
      WHERE (s.status_kelulusan IS NULL OR s.status_kelulusan = 'Aktif')
    `;
    let params = [];
    if (sekolahId && sekolahId !== '0') {
      query += ` AND s.sekolah_id = $1`;
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
    let query = `SELECT u.id, u.username, u.nama, u.role, u.sekolah_id, s.nama_sekolah FROM users u LEFT JOIN sekolah s ON u.sekolah_id = s.id`;
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

// API Tambah Pengguna dengan Validasi Hak Akses (Operator hanya boleh tambah GURU_PIKET)
app.post('/api/users', async (req, res) => {
  const { username, password, nama, role, sekolah_id, creator_role } = req.body;
  
  try {
    // Validasi Sisi Backend: Jika yang membuat adalah operator, paksa/pastikan role hanya GURU_PIKET
    if (creator_role === 'OPERATOR' && role !== 'GURU_PIKET') {
      return res.status(403).json({ success: false, error: 'Akses ditolak! Operator hanya diizinkan menambahkan Guru Piket.' });
    }

    await pool.query(
      `INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)`,
      [username, password, nama, role, sekolah_id || null]
    );
    res.json({ success: true, message: 'Pengguna / Guru Piket berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/reset-password/:id', async (req, res) => {
  const userId = req.params.id;
  const { username, password } = req.body;
  try {
    await pool.query(
      `UPDATE users SET username = $1, password = $2 WHERE id = $3`,
      [username, password, userId]
    );
    res.json({ success: true, message: 'Username dan Password berhasil diperbarui!' });
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
