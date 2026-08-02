const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper Send WA ke Banyak Nomor
async function kirimMultiWA(noWaList, pesan, token) {
  if (!token || !noWaList || noWaList.length === 0) return;
  for (let no of noWaList) {
    try {
      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: no, message: pesan })
      });
    } catch (e) { console.error('Gagal kirim WA ke', no); }
  }
}

// 1. Endpoint Login (Membaca Role & Nama Sekolah)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const q = `
      SELECT u.id, u.username, u.nama, u.role, u.sekolah_id, s.nama_sekolah 
      FROM users u 
      LEFT JOIN sekolah s ON u.sekolah_id = s.id 
      WHERE u.username = $1 AND u.password = $2
    `;
    const result = await pool.query(q, [username, password]);
    if (result.rows.length > 0) {
      return res.json({ success: true, user: result.rows[0] });
    }
    return res.status(401).json({ error: 'Username atau password salah!' });
  } catch (err) {
    return res.status(500).json({ error: 'Database Error: ' + err.message });
  }
});

// 2. Kelola Sekolah (Admin Only)
app.get('/api/sekolah', async (req, res) => {
  const r = await pool.query('SELECT * FROM sekolah ORDER BY nama_sekolah');
  res.json(r.rows);
});

app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat } = req.body;
  await pool.query('INSERT INTO sekolah (nama_sekolah, alamat) VALUES ($1, $2)', [nama_sekolah, alamat]);
  res.json({ success: true });
});

// 3. Kelola User/Pengguna (Admin Only)
app.get('/api/users/:sekolah_id', async (req, res) => {
  const r = await pool.query('SELECT id, username, nama, role FROM users WHERE sekolah_id = $1', [req.params.sekolah_id]);
  res.json(r.rows);
});

app.post('/api/users', async (req, res) => {
  const { username, password, nama, role, sekolah_id } = req.body;
  await pool.query(
    'INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)',
    [username, password, nama, role, sekolah_id]
  );
  res.json({ success: true });
});

// 4. Tambah Siswa + Banyak No WA
app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  try {
    const resSiswa = await pool.query(
      'INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu]
    );
    const siswaId = resSiswa.rows[0].id;

    // Simpan banyak no WA
    if (no_wa_list && no_wa_list.length > 0) {
      for (let wa of no_wa_list) {
        if (wa.trim()) {
          await pool.query('INSERT INTO wa_ortu (siswa_id, no_wa) VALUES ($1, $2)', [siswaId, wa.trim()]);
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal simpan siswa: ' + err.message });
  }
});

app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const q = `
    SELECT s.*, array_agg(w.no_wa) as wa_ortu 
    FROM siswa s 
    LEFT JOIN wa_ortu w ON s.id = w.siswa_id 
    WHERE s.sekolah_id = $1 
    GROUP BY s.id ORDER BY s.kelas, s.nama_siswa
  `;
  const r = await pool.query(q, [req.params.sekolah_id]);
  res.json(r.rows);
});

// 5. Scan QR Absensi (Mobile Guru Piket)
app.post('/api/absen-qr', async (req, res) => {
  const { sekolah_id, nisn } = req.body;
  const skrg = new Date();
  const tanggal = skrg.toISOString().split('T')[0];
  const jamStr = skrg.toTimeString().split(' ')[0];
  const hariArr = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const hari = hariArr[skrg.getDay()];

  try {
    const resSiswa = await pool.query('SELECT * FROM siswa WHERE sekolah_id = $1 AND nisn = $2', [sekolah_id, nisn]);
    if (resSiswa.rows.length === 0) return res.status(404).json({ error: 'Siswa tidak ditemukan di sekolah ini!' });
    const siswa = resSiswa.rows[0];

    const resWA = await pool.query('SELECT no_wa FROM wa_ortu WHERE siswa_id = $1', [siswa.id]);
    const listWA = resWA.rows.map(w => w.no_wa);

    const resAbsen = await pool.query('SELECT * FROM absensi WHERE siswa_id = $1 AND tanggal = $2', [siswa.id, tanggal]);

    if (resAbsen.rows.length === 0) {
      await pool.query(
        'INSERT INTO absensi (sekolah_id, siswa_id, tanggal, hari, jam_masuk, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [sekolah_id, siswa.id, tanggal, hari, jamStr, 'Hadir']
      );
      kirimMultiWA(listWA, `PRESENSI MASUK\nNama: ${siswa.nama_siswa}\nKelas: ${siswa.kelas}\nJam: ${jamStr} WIB`);
      return res.json({ success: true, message: `Absen Masuk Berhasil: ${siswa.nama_siswa}` });
    } else {
      await pool.query('UPDATE absensi SET jam_pulang = $1 WHERE id = $2', [jamStr, resAbsen.rows[0].id]);
      kirimMultiWA(listWA, `PRESENSI PULANG\nNama: ${siswa.nama_siswa}\nKelas: ${siswa.kelas}\nJam: ${jamStr} WIB`);
      return res.json({ success: true, message: `Absen Pulang Berhasil: ${siswa.nama_siswa}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Rekap Absensi Per Sekolah
app.get('/api/rekap/:sekolah_id', async (req, res) => {
  const q = `
    SELECT a.*, s.nama_siswa, s.kelas 
    FROM absensi a 
    JOIN siswa s ON a.siswa_id = s.id 
    WHERE a.sekolah_id = $1 
    ORDER BY a.tanggal DESC, a.jam_masuk DESC
  `;
  const r = await pool.query(q, [req.params.sekolah_id]);
  res.json(r.rows);
});

module.exports = app;
