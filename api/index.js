const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper Pengiriman WhatsApp
async function kirimWA(noWa, pesan) {
  try {
    const resPengaturan = await pool.query('SELECT fonnte_token FROM pengaturan WHERE id = 1');
    const token = resPengaturan.rows[0]?.fonnte_token;
    if (!token) return;

    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: noWa, message: pesan })
    });
  } catch (err) {
    console.error('Gagal kirim WA:', err);
  }
}

// 1. Endpoint Scan QR Absensi (Masuk & Pulang)
app.post('/api/absen-qr', async (req, res) => {
  const { nisn } = req.body;
  const skrg = new Date();
  const tanggal = skrg.toISOString().split('T')[0];
  const jamStr = skrg.toTimeString().split(' ')[0];
  const hariArr = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const hari = hariArr[skrg.getDay()];

  try {
    // Cek Siswa
    const resSiswa = await pool.query('SELECT * FROM siswa WHERE nisn = $1', [nisn]);
    if (resSiswa.rows.length === 0) return res.status(404).json({ error: 'Siswa dengan NISN ini tidak ditemukan!' });
    const siswa = resSiswa.rows[0];

    // Cek Pengaturan Jam
    const resPengaturan = await pool.query('SELECT * FROM pengaturan WHERE id = 1');
    const { jam_masuk, jam_pulang } = resPengaturan.rows[0];

    // Cek Absen Hari Ini
    const resAbsen = await pool.query('SELECT * FROM absensi WHERE nisn = $1 AND tanggal = $2', [nisn, tanggal]);

    if (resAbsen.rows.length === 0) {
      // Absen Masuk
      let status = jamStr <= jam_masuk ? 'Hadir (Tepat Waktu)' : 'Terlambat';
      await pool.query(
        'INSERT INTO absensi (nisn, tanggal, hari, jam_masuk, status) VALUES ($1, $2, $3, $4, $5)',
        [nisn, tanggal, hari, jamStr, status]
      );

      // Kirim WhatsApp ke Ortu
      const pesan = `Yth. Bpk/Ibu ${siswa.nama_ortu},\n\nInformasi Kehadiran Siswa:\nNama: ${siswa.nama_siswa}\nKelas: ${siswa.kelas}\nHari/Tgl: ${hari}, ${tanggal}\nJam Masuk: ${jamStr} WIB\nStatus: ${status}.\n\nTerima Kasih.`;
      kirimWA(siswa.no_wa_ortu, pesan);

      return res.json({ success: true, message: `Absen Masuk Berhasil (${status})`, siswa });
    } else {
      // Absen Pulang
      await pool.query('UPDATE absensi SET jam_pulang = $1 WHERE nisn = $2 AND tanggal = $3', [jamStr, nisn, tanggal]);

      // Kirim WA Pulang
      const pesan = `Yth. Bpk/Ibu ${siswa.nama_ortu},\n\nSiswa atas nama ${siswa.nama_siswa} (Kelas ${siswa.kelas}) telah TELAH PULANG SEKOLAH pada jam ${jamStr} WIB.\n\nTerima Kasih.`;
      kirimWA(siswa.no_wa_ortu, pesan);

      return res.json({ success: true, message: 'Absen Pulang Berhasil Diterima', siswa });
    }
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// 2. CRUD Data Siswa
app.get('/api/siswa', async (req, res) => {
  const result = await pool.query('SELECT * FROM siswa ORDER BY kelas, nama_siswa');
  res.json(result.rows);
});

app.post('/api/siswa', async (req, res) => {
  const { nisn, nama_siswa, kelas, nama_ortu, no_wa_ortu } = req.body;
  await pool.query(
    'INSERT INTO siswa (nisn, nama_siswa, kelas, nama_ortu, no_wa_ortu) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (nisn) DO UPDATE SET nama_siswa=$2, kelas=$3, nama_ortu=$4, no_wa_ortu=$5',
    [nisn, nama_siswa, kelas, nama_ortu, no_wa_ortu]
  );
  res.json({ success: true });
});

app.delete('/api/siswa/:id', async (req, res) => {
  await pool.query('DELETE FROM siswa WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// 3. Pengaturan Jam & Token WA
app.get('/api/pengaturan', async (req, res) => {
  const result = await pool.query('SELECT * FROM pengaturan WHERE id = 1');
  res.json(result.rows[0]);
});

app.post('/api/pengaturan', async (req, res) => {
  const { jam_masuk, jam_pulang, fonnte_token } = req.body;
  await pool.query('UPDATE pengaturan SET jam_masuk=$1, jam_pulang=$2, fonnte_token=$3 WHERE id=1', [jam_masuk, jam_pulang, fonnte_token]);
  res.json({ success: true });
});

// 4. Rekap Absensi
app.get('/api/rekap', async (req, res) => {
  const result = await pool.query(`
    SELECT a.*, s.nama_siswa, s.kelas 
    FROM absensi a 
    JOIN siswa s ON a.nisn = s.nisn 
    ORDER BY a.tanggal DESC, a.jam_masuk DESC
  `);
  res.json(result.rows);
});

module.exports = app;
