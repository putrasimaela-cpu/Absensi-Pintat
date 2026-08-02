const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. AUTHENTICATION & MANAGEMENT USER
// ==========================================

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT u.*, s.nama_sekolah FROM users u LEFT JOIN sekolah s ON u.sekolah_id = s.id WHERE u.username = $1 AND u.password = $2',
      [username, password]
    );
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ error: 'Username atau password salah!' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Get Users
app.get('/api/users/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = 'SELECT u.*, s.nama_sekolah FROM users u LEFT JOIN sekolah s ON u.sekolah_id = s.id';
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE u.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' ORDER BY u.id ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tambah User / Pengelola
app.post('/api/users', async (req, res) => {
  const { username, password, nama, role, sekolah_id } = req.body;
  if (!username || !password || !nama || !role) {
    return res.status(400).json({ error: 'Semua kolom wajib diisi!' });
  }
  try {
    const targetSekolah = (sekolah_id && sekolah_id !== '0' && sekolah_id !== 'null') ? parseInt(sekolah_id) : null;
    await pool.query(
      'INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)',
      [username, password, nama, role, targetSekolah]
    );
    res.json({ success: true, message: 'Pengelola berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah pengelola: ' + err.message });
  }
});

// Hapus User / Pengelola
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true, message: 'Pengelola berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. MANAGEMENT SEKOLAH
// ==========================================

// Get All Sekolah
app.get('/api/sekolah', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sekolah ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tambah Sekolah
app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat } = req.body;
  if (!nama_sekolah) {
    return res.status(400).json({ error: 'Nama sekolah tidak boleh kosong!' });
  }
  try {
    await pool.query('INSERT INTO sekolah (nama_sekolah, alamat) VALUES ($1, $2)', [nama_sekolah, alamat || '']);
    res.json({ success: true, message: 'Sekolah berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit Sekolah
app.put('/api/sekolah/:id', async (req, res) => {
  const { id } = req.params;
  const { nama_sekolah, alamat } = req.body;
  try {
    await pool.query('UPDATE sekolah SET nama_sekolah = $1, alamat = $2 WHERE id = $3', [nama_sekolah, alamat, id]);
    res.json({ success: true, message: 'Data sekolah berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hapus Sekolah
app.delete('/api/sekolah/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM sekolah WHERE id = $1', [id]);
    res.json({ success: true, message: 'Sekolah berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus sekolah: ' + err.message });
  }
});

// ==========================================
// 3. MANAGEMENT SISWA & WA ORTU
// ==========================================

// Get Siswa
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = `
      SELECT s.*, 
             MAX(w.nama_ortu) AS nama_ortu, 
             ARRAY_AGG(w.no_wa) FILTER (WHERE w.no_wa IS NOT NULL) AS wa_ortu
      FROM siswa s
      LEFT JOIN wa_ortu w ON s.id = w.siswa_id
    `;
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' GROUP BY s.id ORDER BY s.id DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tambah Siswa
app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  if (!nama_siswa || !kelas) {
    return res.status(400).json({ error: 'Nama Siswa dan Kelas wajib diisi!' });
  }
  try {
    const targetSekolah = (sekolah_id && sekolah_id !== 'null' && sekolah_id !== '0') ? parseInt(sekolah_id) : null;
    const resSiswa = await pool.query(
      'INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas) VALUES ($1, $2, $3, $4) RETURNING id',
      [targetSekolah, nisn, nama_siswa, kelas]
    );
    const siswaId = resSiswa.rows[0].id;

    if (no_wa_list && Array.isArray(no_wa_list)) {
      for (let wa of no_wa_list) {
        if (wa && wa.trim()) {
          await pool.query(
            'INSERT INTO wa_ortu (siswa_id, no_wa, nama_ortu) VALUES ($1, $2, $3)',
            [siswaId, wa.trim(), nama_ortu || 'Orang Tua']
          );
        }
      }
    }
    res.json({ success: true, message: 'Data siswa berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit Siswa
app.put('/api/siswa/:id', async (req, res) => {
  const { id } = req.params;
  const { nisn, nama_siswa, kelas, nama_ortu, no_wa } = req.body;
  try {
    await pool.query('UPDATE siswa SET nisn = $1, nama_siswa = $2, kelas = $3 WHERE id = $4', [nisn, nama_siswa, kelas, id]);
    await pool.query('DELETE FROM wa_ortu WHERE siswa_id = $1', [id]);
    if (no_wa) {
      const waList = no_wa.split(',').map(w => w.trim());
      for (let wa of waList) {
        if (wa) {
          await pool.query(
            'INSERT INTO wa_ortu (siswa_id, no_wa, nama_ortu) VALUES ($1, $2, $3)',
            [id, wa, nama_ortu || 'Orang Tua']
          );
        }
      }
    }
    res.json({ success: true, message: 'Data siswa berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hapus Siswa
app.delete('/api/siswa/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM wa_ortu WHERE siswa_id = $1', [id]);
    await pool.query('DELETE FROM siswa WHERE id = $1', [id]);
    res.json({ success: true, message: 'Siswa berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. ABSENSI & REKAP EXCEL
// ==========================================

// Absensi Barcode (Hadir)
app.post('/api/absensi-barcode', async (req, res) => {
  const { siswa_id } = req.body;
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status) 
       VALUES ($1, CURRENT_DATE, $2, 'Hadir (Barcode)')
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = 'Hadir (Barcode)', jam_masuk = EXCLUDED.jam_masuk`,
      [siswa_id, jamSekarang]
    );
    res.json({ success: true, message: 'Absen Barcode Berhasil! Status: Hadir' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Absensi Manual Guru Piket (Sakit, Izin, Tanpa Keterangan)
app.post('/api/absensi-manual', async (req, res) => {
  const { siswa_id, status } = req.body;
  if (!siswa_id || !status) {
    return res.status(400).json({ error: 'Pilih siswa dan status kehadiran!' });
  }
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status) 
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = EXCLUDED.status, jam_masuk = EXCLUDED.jam_masuk`,
      [siswa_id, jamSekarang, status]
    );
    res.json({ success: true, message: `Berhasil mencatat status: ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Rekap Tabel
app.get('/api/rekap/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = `
      SELECT a.id, a.tanggal, a.jam_masuk, a.jam_pulang, a.status, s.nisn, s.nama_siswa, s.kelas 
      FROM absensi a 
      JOIN siswa s ON a.siswa_id = s.id
    `;
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' ORDER BY a.tanggal DESC, a.id DESC LIMIT 200';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rekap Total Kehadiran untuk Export Excel
app.get('/api/rekap-excel/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = `
      SELECT 
        s.id,
        s.nisn,
        s.nama_siswa,
        s.kelas,
        COUNT(CASE WHEN a.status LIKE 'Hadir%' THEN 1 END) AS total_hadir,
        COUNT(CASE WHEN a.status = 'Sakit' THEN 1 END) AS total_sakit,
        COUNT(CASE WHEN a.status = 'Izin' THEN 1 END) AS total_izin,
        COUNT(CASE WHEN a.status = 'Tanpa Keterangan' OR a.status = 'Alpha' THEN 1 END) AS total_alpha
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id
    `;
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' GROUP BY s.id, s.nisn, s.nama_siswa, s.kelas ORDER BY s.kelas ASC, s.nama_siswa ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
