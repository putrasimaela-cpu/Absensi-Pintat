const express = require('express');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json());

// Inisialisasi koneksi Neon DB
const sql = neon(process.env.DATABASE_URL);

// 1. API: Catat Presensi lewat QR Code
app.post('/api/presensi', async (req, res) => {
  try {
    const { nis } = req.body;
    if (!nis) return res.status(400).json({ success: false, message: 'NIS wajib diisi' });

    // Cari Siswa
    const siswa = await sql`SELECT * FROM siswa WHERE nis = ${nis}`;
    if (siswa.length === 0) {
      return res.status(404).json({ success: false, message: 'Siswa tidak terdaftar!' });
    }

    const siswaId = siswa[0].id;

    // Cek apakah sudah absen hari ini
    const cekHadir = await sql`SELECT * FROM presensi WHERE siswa_id = ${siswaId} AND tanggal = CURRENT_DATE`;
    if (cekHadir.length > 0) {
      return res.json({ success: false, message: `${siswa[0].nama} sudah presensi hari ini!` });
    }

    // Simpan Presensi
    await sql`INSERT INTO presensi (siswa_id) VALUES (${siswaId})`;

    return res.json({
      success: true,
      message: `Berhasil Presensi: ${siswa[0].nama} (${siswa[0].kelas})`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 2. API: Ambil Data Dashboard (Siswa & Riwayat Presensi Hari Ini)
app.get('/api/dashboard-data', async (req, res) => {
  try {
    const rekap = await sql`
      SELECT 
        p.id, 
        s.nis, 
        s.nama, 
        s.kelas, 
        TO_CHAR(p.waktu_hadir, 'HH24:MI:SS') as jam
      FROM presensi p
      JOIN siswa s ON p.siswa_id = s.id
      WHERE p.tanggal = CURRENT_DATE
      ORDER BY p.waktu_hadir DESC
    `;

    return res.json({ success: true, data: rekap });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = app;
