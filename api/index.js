const express = require('express');
const { Pool } = require('pg');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inisialisasi WhatsApp Client
const waClient = new Client({
  authStrategy: new LocalAuth()
});

waClient.on('qr', (qr) => {
  console.log('SCAN QR WHATSAPP INI DI TERMINAL ANDA:');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  console.log('WhatsApp Client sudah terhubung dan siap mengirim pesan!');
});

waClient.initialize();

// Fungsi helper kirim WA ke banyak nomor (array wa_ortu)
async function kirimNotifikasiWA(nomorList, pesan) {
  if (!nomorList || !Array.isArray(nomorList)) return;
  for (let noHp of nomorList) {
    if (!noHp) continue;
    // Format nomor HP (ubah 08... menjadi 628...)
    let formattedNo = noHp.trim();
    if (formattedNo.startsWith('0')) {
      formattedNo = '62' + formattedNo.slice(1);
    }
    const chatId = formattedNo + '@c.us';
    try {
      await waClient.sendMessage(chatId, pesan);
      console.log(`Pesan WhatsApp terkirim ke: ${formattedNo}`);
    } catch (err) {
      console.error(`Gagal mengirim WA ke ${formattedNo}:`, err.message);
    }
  }
}

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

// Menu Sekolah
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
    const result = await pool.query(
      `INSERT INTO sekolah (nama_sekolah, alamat, logo) VALUES ($1, $2, $3) RETURNING *`,
      [nama_sekolah, alamat, logo]
    );
    res.json({ success: true, sekolah: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sekolah/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sekolah WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Data sekolah berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Siswa API (Mendukung input wa_ortu berupa Array nomor HP)
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
  const { sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu } = req.body;
  try {
    await pool.query(
      `INSERT INTO siswa (sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu, status_kelulusan) 
       VALUES ($1, $2, $3, $4, $5, $6, 'Aktif')
       ON CONFLICT (nisn) DO UPDATE SET 
       nama_siswa = EXCLUDED.nama_siswa, kelas = EXCLUDED.kelas, nama_ortu = EXCLUDED.nama_ortu, wa_ortu = EXCLUDED.wa_ortu, status_kelulusan = 'Aktif'`,
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu]
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

// Scan QR Code / NISN (Otomatis Hadir & Kirim WA Realtime)
app.post('/api/absensi-barcode-nisn', async (req, res) => {
  const { nisn, pendaftar_id } = req.body;
  if (!nisn) return res.status(400).json({ error: 'NISN / QR Code tidak valid!' });
  
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  const tanggalHariIni = new Date().toISOString().split('T')[0];

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

    // KIRIM PESAN REAL-TIME KE WHATSAPP ORTU
    const pesanWA = `🔔 *INFO ABSENSI SEKOLAH*\n\n` +
                    `Kepada Yth. Orang Tua/Wali dari:\n` +
                    `Nama: *${siswa.nama_siswa}*\n` +
                    `Kelas: *${siswa.kelas}*\n` +
                    `Status: *HADIR* ✅\n` +
                    `Tanggal: ${tanggalHariIni}\n` +
                    `Jam Masuk: ${jamSekarang}\n\n` +
                    `Terima kasih.`;

    kirimNotifikasiWA(siswa.wa_ortu, pesanWA);

    res.json({ success: true, nama_siswa: siswa.nama_siswa, kelas: siswa.kelas, jam: jamSekarang });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Update Status Absensi Manual & Kirim WA
app.put('/api/absensi-status', async (req, res) => {
  const { siswa_id, tanggal, status, user_id } = req.body;
  const targetTanggal = tanggal || new Date().toISOString().split('T')[0];
  const jamSekarang = status === 'Hadir' ? new Date().toLocaleTimeString('id-ID') : '-';

  try {
    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = EXCLUDED.status, jam_masuk = COALESCE(EXCLUDED.jam_masuk, absensi.jam_masuk), user_id = EXCLUDED.user_id`,
      [siswa_id, targetTanggal, jamSekarang === '-' ? null : jamSekarang, status, user_id]
    );

    // Ambil data siswa untuk kirim WA
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE id = $1', [siswa_id]);
    if (siswaRes.rows.length > 0) {
      const siswa = siswaRes.rows[0];
      const pesanWA = `🔔 *INFO STATUS ABSENSI*\n\n` +
                      `Nama: *${siswa.nama_siswa}*\n` +
                      `Kelas: *${siswa.kelas}*\n` +
                      `Status Terbaru: *${status.toUpperCase()}* 📌\n` +
                      `Tanggal: ${targetTanggal}\n\n` +
                      `Terima kasih.`;
      kirimNotifikasiWA(siswa.wa_ortu, pesanWA);
    }

    res.json({ success: true, message: 'Status absensi berhasil diperbarui & notifikasi terkirim!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rekap Harian
app.get('/api/rekap-harian/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { tanggal } = req.query;
  const targetTanggal = tanggal || new Date().toISOString().split('T')[0];

  try {
    let query = `
      SELECT 
        s.id as siswa_id, s.nisn, s.nama_siswa, s.kelas,
        COALESCE(a.status, 'Tanpa Keterangan') as status,
        COALESCE(a.tanggal, $2::DATE) as tanggal,
        a.jam_masuk, u.nama as nama_piket
      FROM siswa s
      LEFT JOIN absensi a ON s.id = a.siswa_id AND a.tanggal = $2::DATE
      LEFT JOIN users u ON a.user_id = u.id
      WHERE (s.status_kelulusan IS NULL OR s.status_kelulusan = 'Aktif')
    `;
    let params = [sekolahId, targetTanggal];

    if (sekolahId && sekolahId !== '0') {
      query += ` AND s.sekolah_id = $1`;
    } else {
      params = [targetTanggal];
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

module.exports = app;
