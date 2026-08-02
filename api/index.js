const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Database Connection (Neon PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// 1. AUTHENTICATION & USERS
// ============================================================

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

// Delete User
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true, message: 'User berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 2. MANAGEMENT SEKOLAH
// ============================================================

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
    await pool.query(
      'INSERT INTO sekolah (nama_sekolah, alamat) VALUES ($1, $2)',
      [nama_sekolah, alamat || '']
    );
    res.json({ success: true, message: 'Sekolah berhasil ditambahkan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update / Edit Sekolah
app.put('/api/sekolah/:id', async (req, res) => {
  const { id } = req.params;
  const { nama_sekolah, alamat } = req.body;
  try {
    await pool.query(
      'UPDATE sekolah SET nama_sekolah = $1, alamat = $2 WHERE id = $3',
      [nama_sekolah, alamat, id]
    );
    res.json({ success: true, message: 'Data sekolah berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 3. MANAGEMENT SISWA & WA ORTU
// ============================================================

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
    
    // Simpan data siswa
    const resSiswa = await pool.query(
      'INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas) VALUES ($1, $2, $3, $4) RETURNING id',
      [targetSekolah, nisn, nama_siswa, kelas]
    );
    const siswaId = resSiswa.rows[0].id;

    // Simpan WA Ortu
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

// Update / Edit Siswa
app.put('/api/siswa/:id', async (req, res) => {
  const { id } = req.params;
  const { nisn, nama_siswa, kelas, nama_ortu, no_wa } = req.body;
  try {
    await pool.query(
      'UPDATE siswa SET nisn = $1, nama_siswa = $2, kelas = $3 WHERE id = $4',
      [nisn, nama_siswa, kelas, id]
    );
    
    // Re-insert nomor WA ortu
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

// ============================================================
// 4. MANAGEMENT ABSENSI
// ============================================================

// Get Rekap Absensi
app.get('/api/rekap/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = `
      SELECT a.*, s.nama_siswa, s.kelas 
      FROM absensi a 
      JOIN siswa s ON a.siswa_id = s.id
    `;
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' ORDER BY a.id DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update / Edit Absensi
app.put('/api/absensi/:id', async (req, res) => {
  const { id } = req.params;
  const { status, jam_masuk, jam_pulang } = req.body;
  try {
    await pool.query(
      'UPDATE absensi SET status = $1, jam_masuk = $2, jam_pulang = $3 WHERE id = $4',
      [status, jam_masuk, jam_pulang, id]
    );
    res.json({ success: true, message: 'Data absensi berhasil diperbarui!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kirim Rekap Harian ke WA via Fonnte
app.post('/api/kirim-rekap-harian', async (req, res) => {
  const { sekolah_id, token_fonnte } = req.body;
  try {
    // Ambil data absensi hari ini beserta nomor WA Ortu
    let query = `
      SELECT s.nama_siswa, s.kelas, a.status, a.jam_masuk, w.no_wa
      FROM absensi a
      JOIN siswa s ON a.siswa_id = s.id
      JOIN wa_ortu w ON s.id = w.siswa_id
      WHERE a.tanggal = CURRENT_DATE
    `;
    let params = [];
    if (sekolah_id) {
      query += ' AND s.sekolah_id = $1';
      params.push(sekolah_id);
    }

    const result = await pool.query(query, params);
    
    // Proses pengiriman dapat diintegrasikan dengan Fonnte API di sini
    res.json({ success: true, message: `Berhasil memproses rekap harian untuk ${result.rows.length} penerima!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// EXPORT FOR VERCEL
// ============================================================
module.exports = app;
