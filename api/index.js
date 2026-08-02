const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper Send WA
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

// 1. Endpoint Login
app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  
  if (!nama_siswa || !kelas) {
    return res.status(400).json({ error: 'Nama Siswa dan Kelas wajib diisi!' });
  }

  try {
    // Memastikan sekolah_id valid angka
    const targetSekolah = (sekolah_id && sekolah_id !== 'null' && sekolah_id !== '0') ? parseInt(sekolah_id) : null;

    // 1. Simpan Siswa
    const resSiswa = await pool.query(
      'INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [targetSekolah, nisn, nama_siswa, kelas, nama_ortu]
    );
    const siswaId = resSiswa.rows[0].id;

    // 2. Simpan Nomor WA Ortu
    if (no_wa_list && Array.isArray(no_wa_list)) {
      for (let wa of no_wa_list) {
        if (wa && wa.trim()) {
          await pool.query('INSERT INTO wa_ortu (siswa_id, no_wa) VALUES ($1, $2)', [siswaId, wa.trim()]);
        }
      }
    }

    res.json({ success: true, message: 'Data siswa berhasil disimpan!' });
  } catch (err) {
    console.error("Error Simpan Siswa:", err);
    res.status(500).json({ error: 'Gagal simpan siswa: ' + err.message });
  }
});
// 2. Data Sekolah (Admin)
app.get('/api/sekolah', async (req, res) => {
  const r = await pool.query('SELECT * FROM sekolah ORDER BY nama_sekolah');
  res.json(r.rows);
});

app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat } = req.body;
  try {
    await pool.query('INSERT INTO sekolah (nama_sekolah, alamat) VALUES ($1, $2)', [nama_sekolah, alamat]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Kelola User (Termasuk Akses Password untuk Admin & Hapus User)
app.get('/api/users/:sekolah_id', async (req, res) => {
  let q = 'SELECT u.id, u.username, u.password, u.nama, u.role, s.nama_sekolah FROM users u LEFT JOIN sekolah s ON u.sekolah_id = s.id';
  let params = [];
  
  // Jika bukan admin utama, filter sesuai sekolah
  if (req.params.sekolah_id !== 'null' && req.params.sekolah_id !== '0') {
    q += ' WHERE u.sekolah_id = $1';
    params.push(req.params.sekolah_id);
  }
  q += ' ORDER BY u.role, u.nama';
  
  const r = await pool.query(q, params);
  res.json(r.rows);
});

app.post('/api/users', async (req, res) => {
  const { username, password, nama, role, sekolah_id } = req.body;
  try {
    await pool.query(
      'INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)',
      [username, password, nama, role, sekolah_id || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal simpan user: ' + err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ganti Password User
app.post('/api/change-password', async (req, res) => {
  const { user_id, old_password, new_password } = req.body;
  try {
    const check = await pool.query('SELECT * FROM users WHERE id = $1 AND password = $2', [user_id, old_password]);
    if (check.rows.length === 0) {
      return res.status(400).json({ error: 'Password lama salah!' });
    }
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [new_password, user_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Kelola Siswa & Hapus Siswa
app.post('/api/siswa', async (req, res) => {
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, no_wa_list } = req.body;
  try {
    const resSiswa = await pool.query(
      'INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu]
    );
    const siswaId = resSiswa.rows[0].id;

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
  let q = `
    SELECT s.*, array_agg(w.no_wa) as wa_ortu 
    FROM siswa s 
    LEFT JOIN wa_ortu w ON s.id = w.siswa_id 
  `;
  let params = [];
  if (req.params.sekolah_id !== 'null' && req.params.sekolah_id !== '0') {
    q += ' WHERE s.sekolah_id = $1';
    params.push(req.params.sekolah_id);
  }
  q += ' GROUP BY s.id ORDER BY s.kelas, s.nama_siswa';
  
  const r = await pool.query(q, params);
  res.json(r.rows);
});

app.delete('/api/siswa/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM siswa WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Scan QR & Rekap
app.post('/api/absen-qr', async (req, res) => {
  const { sekolah_id, nisn } = req.body;
  const skrg = new Date();
  const tanggal = skrg.toISOString().split('T')[0];
  const jamStr = skrg.toTimeString().split(' ')[0];
  const hariArr = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const hari = hariArr[skrg.getDay()];

  try {
    let qSiswa = 'SELECT * FROM siswa WHERE nisn = $1';
    let pSiswa = [nisn];
    if (sekolah_id) {
      qSiswa += ' AND sekolah_id = $2';
      pSiswa.push(sekolah_id);
    }
    const resSiswa = await pool.query(qSiswa, pSiswa);
    if (resSiswa.rows.length === 0) return res.status(404).json({ error: 'Siswa tidak ditemukan!' });
    const siswa = resSiswa.rows[0];

    const resWA = await pool.query('SELECT no_wa FROM wa_ortu WHERE siswa_id = $1', [siswa.id]);
    const listWA = resWA.rows.map(w => w.no_wa);

    const resAbsen = await pool.query('SELECT * FROM absensi WHERE siswa_id = $1 AND tanggal = $2', [siswa.id, tanggal]);

    if (resAbsen.rows.length === 0) {
      await pool.query(
        'INSERT INTO absensi (sekolah_id, siswa_id, tanggal, hari, jam_masuk, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [siswa.sekolah_id, siswa.id, tanggal, hari, jamStr, 'Hadir']
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

app.get('/api/rekap/:sekolah_id', async (req, res) => {
  let q = `
    SELECT a.*, s.nama_siswa, s.kelas, sek.nama_sekolah 
    FROM absensi a 
    JOIN siswa s ON a.siswa_id = s.id 
    LEFT JOIN sekolah sek ON a.sekolah_id = sek.id 
  `;
  let params = [];
  if (req.params.sekolah_id !== 'null' && req.params.sekolah_id !== '0') {
    q += ' WHERE a.sekolah_id = $1';
    params.push(req.params.sekolah_id);
  }
  q += ' ORDER BY a.tanggal DESC, a.jam_masuk DESC';
  
  const r = await pool.query(q, params);
  res.json(r.rows);
});
// Endpoint Kirim Rekap Presensi Harian ke Seluruh Ortu Siswa
app.post('/api/kirim-rekap-harian', async (req, res) => {
  const { sekolah_id, token_fonnte } = req.body;
  const skrg = new Date();
  const tanggal = skrg.toISOString().split('T')[0];

  try {
    let qSiswa = `
      SELECT s.id, s.nama_siswa, s.kelas, array_agg(w.no_wa) as wa_ortu 
      FROM siswa s 
      LEFT JOIN wa_ortu w ON s.id = w.siswa_id 
    `;
    let params = [];
    if (sekolah_id) {
      qSiswa += ' WHERE s.sekolah_id = $1';
      params.push(sekolah_id);
    }
    qSiswa += ' GROUP BY s.id';
    
    const dataSiswa = await pool.query(qSiswa, params);

    for (let siswa of dataSiswa.rows) {
      if (!siswa.wa_ortu || siswa.wa_ortu.length === 0 || !siswa.wa_ortu[0]) continue;

      const qAbsen = 'SELECT * FROM absensi WHERE siswa_id = $1 AND tanggal = $2';
      const resAbsen = await pool.query(qAbsen, [siswa.id, tanggal]);

      let statusHarian = 'Tanpa Keterangan (Alpha)';
      let jamMasuk = '-';
      let jamPulang = '-';

      if (resAbsen.rows.length > 0) {
        const a = resAbsen.rows[0];
        statusHarian = a.status || 'Hadir';
        jamMasuk = a.jam_masuk || '-';
        jamPulang = a.jam_pulang || '-';
      }

      const pesan = 
`📌 *REKAP KEHADIRAN HARIAN*
📅 Tanggal: ${tanggal}
👤 Nama: ${siswa.nama_siswa}
🏫 Kelas: ${siswa.kelas}

STATUS: *${statusHarian.toUpperCase()}*
⏰ Jam Masuk: ${jamMasuk}
🚪 Jam Pulang: ${jamPulang}

_Pesan otomatis dari Sistem Absensi Sekolah._`;

      await kirimMultiWA(siswa.wa_ortu, pesan, token_fonnte);
    }

    res.json({ success: true, message: 'Rekap harian berhasil dikirim ke seluruh orang tua!' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal kirim rekap harian: ' + err.message });
  }
});
// Endpoint Update / Edit Data Siswa
app.put('/api/siswa/:id', async (req, res) => {
  const { id } = req.params;
  const { nisn, nama_siswa, kelas, nama_ortu, no_wa } = req.body;
  try {
    // Update data siswa
    await pool.query(
      'UPDATE siswa SET nisn = $1, nama_siswa = $2, kelas = $3 WHERE id = $4',
      [nisn, nama_siswa, kelas, id]
    );

    // Update data WA Ortu & Nama Ortu
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
    res.status(500).json({ error: 'Gagal memperbarui data siswa: ' + err.message });
  }
});

// Endpoint Update / Edit Data Sekolah
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
    res.status(500).json({ error: 'Gagal memperbarui sekolah: ' + err.message });
  }
});

// Endpoint Update / Edit Data Absensi
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
    res.status(500).json({ error: 'Gagal memperbarui absensi: ' + err.message });
  }
});
module.exports = app;
