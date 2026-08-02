const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Koneksi Database Postgres / Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 1. Endpoint Login
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

// 2. Endpoint Sekolah
app.get('/api/sekolah', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sekolah ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat } = req.body;
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

// 3. Endpoint Siswa
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const { sekolah_id } = req.params;
  try {
    let query = `
      SELECT s.*, 
             w.nama_ortu, 
             ARRAY_AGG(w.no_wa) FILTER (WHERE w.no_wa IS NOT NULL) AS wa_ortu
      FROM siswa s
      LEFT JOIN wa_ortu w ON s.id = w.siswa_id
    `;
    let params = [];
    if (sekolah_id !== '0') {
      query += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    query += ' GROUP BY s.id, w.nama_ortu ORDER BY s.id DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
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
    res.json({ success: true, message: 'Siswa berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/siswa/:id', async (req, res) => {
  const { id } = req.params;
  const { nisn, nama_siswa, kelas, nama_ortu, no_wa } = req.body;
  try {
    await pool.query(
      'UPDATE siswa SET nisn = $1, nama_siswa = $2, kelas = $3 WHERE id = $4',
      [nisn, nama_siswa, kelas, id]
    );
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

// Baris Paling Penting untuk Vercel:
module.exports = app;
