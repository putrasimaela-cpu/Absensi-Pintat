const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/si_absensi';

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Gagal terhubung ke Database PostgreSQL:', err.message);
  } else {
    console.log('✅ Berhasil terhubung ke Database PostgreSQL pada:', res.rows[0].now);
  }
});

const waClient = new Client({
  authStrategy: new LocalAuth()
});

waClient.on('qr', (qr) => {
  console.log('SCAN QR WHATSAPP INI DI TERMINAL ANDA:');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  console.log('🚀 WhatsApp Client sudah terhubung dan siap mengirim pesan!');
});

waClient.initialize();

async function kirimNotifikasiWA(nomorList, pesan) {
  if (!nomorList || !Array.isArray(nomorList)) return;
  for (let noHp of nomorList) {
    if (!noHp) continue;
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
        status_kelulusan VARCHAR(50) DEFAULT 'Aktif',
        tanggal_lulus DATE
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
    console.log("✔️ Struktur tabel database berhasil diverifikasi.");
  } catch (err) {
    console.error("❌ Kesalahan saat inisialisasi tabel database:", err.message);
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

// API Manajemen Sekolah
app.get('/api/sekolah', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sekolah ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sekolah', async (req, res) => {
  const { nama_sekolah, alamat, logo, admin_username, admin_password, admin_nama } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sekolahRes = await client.query(
      `INSERT INTO sekolah (nama_sekolah, alamat, logo) VALUES ($1, $2, $3) RETURNING *`,
      [nama_sekolah, alamat, logo]
    );
    const sekolahBaru = sekolahRes.rows[0];

    if (admin_username && admin_password) {
      await client.query(
        `INSERT INTO users (username, password, nama, role, sekolah_id) VALUES ($1, $2, $3, $4, $5)`,
        [admin_username, admin_password, admin_nama || `Operator ${nama_sekolah}`, 'OPERATOR', sekolahBaru.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Sekolah berhasil dibuat!', sekolah: sekolahBaru });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
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

// API Siswa Aktif
app.get('/api/siswa/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { search } = req.query;
  try {
    let query = `SELECT * FROM siswa WHERE (status_kelulusan IS NULL OR status_kelulusan = 'Aktif')`;
    let params = [];
    let idx = 1;

    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
      query += ` AND sekolah_id = $${idx++}`;
      params.push(sekolahId);
    }
    if (search) {
      query += ` AND (nama_siswa ILIKE $${idx} OR nisn ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
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
       sekolah_id = EXCLUDED.sekolah_id, nama_siswa = EXCLUDED.nama_siswa, kelas = EXCLUDED.kelas, nama_ortu = EXCLUDED.nama_ortu, wa_ortu = EXCLUDED.wa_ortu, status_kelulusan = 'Aktif'`,
      [sekolah_id, nisn, nama_siswa, kelas, nama_ortu, wa_ortu]
    );
    res.json({ success: true, message: 'Data siswa berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/siswa/lulus/:id', async (req, res) => {
  try {
    await pool.query(
      `UPDATE siswa SET status_kelulusan = 'Alumni', tanggal_lulus = CURRENT_DATE WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Siswa dipindahkan ke data alumni.' });
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

// API Alumni
app.get('/api/alumni/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = `SELECT * FROM siswa WHERE status_kelulusan = 'Alumni'`;
    let params = [];
    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
      query += ` AND sekolah_id = $1`;
      params.push(sekolahId);
    }
    query += ` ORDER BY tanggal_lulus DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Absensi & Barcode Scan
app.post('/api/absensi-barcode-nisn', async (req, res) => {
  const { nisn, pendaftar_id } = req.body;
  if (!nisn) return res.status(400).json({ error: 'NISN tidak valid!' });
  
  const jamSekarang = new Date().toLocaleTimeString('id-ID');
  const tanggalHariIni = new Date().toISOString().split('T')[0];

  try {
    const siswaRes = await pool.query('SELECT * FROM siswa WHERE nisn = $1 AND (status_kelulusan IS NULL OR status_kelulusan = \'Aktif\')', [nisn.trim()]);
    if (siswaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Siswa aktif dengan NISN tersebut tidak ditemukan!' });
    }
    const siswa = siswaRes.rows[0];

    await pool.query(
      `INSERT INTO absensi (siswa_id, tanggal, jam_masuk, status, user_id) 
       VALUES ($1, CURRENT_DATE, $2, 'Hadir', $3)
       ON CONFLICT (siswa_id, tanggal) 
       DO UPDATE SET status = 'Hadir', jam_masuk = EXCLUDED.jam_masuk, user_id = EXCLUDED.user_id`,
      [siswa.id, jamSekarang, pendaftar_id || null]
    );

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

    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
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

app.get('/api/arsip/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const { tanggal } = req.query;
  try {
    let query = `
      SELECT a.tanggal as tanggal_arsip, s.nisn, s.nama_siswa, s.kelas, a.status 
      FROM absensi a 
      JOIN siswa s ON a.siswa_id = s.id 
      WHERE 1=1
    `;
    let params = [];
    let idx = 1;

    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
      query += ` AND s.sekolah_id = $${idx++}`;
      params.push(sekolahId);
    }
    if (tanggal) {
      query += ` AND a.tanggal = $${idx++}::DATE`;
      params.push(tanggal);
    }

    query += ` ORDER BY a.tanggal DESC, s.kelas ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Manajemen User / Guru Piket / Operator
app.get('/api/users/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  try {
    let query = `SELECT u.id, u.username, u.nama, u.role, u.sekolah_id FROM users u`;
    let params = [];
    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
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
  
  if (creator_role === 'OPERATOR' && role !== 'GURU_PIKET') {
    return res.status(403).json({ success: false, error: 'Operator hanya diizinkan menambahkan Guru Piket!' });
  }

  try {
    await pool.query(
      `INSERT INTO users (username, password, nama, role, sekolah_id) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, nama = EXCLUDED.nama, role = EXCLUDED.role`,
      [username, password, nama, role, sekolah_id]
    );
    res.json({ success: true, message: `Pengguna ${role} berhasil disimpan!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Pengguna berhasil dihapus!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Statistik Dashboard
app.get('/api/stats/:sekolah_id', async (req, res) => {
  const sekolahId = req.params.sekolah_id;
  const tanggalHariIni = new Date().toISOString().split('T')[0];
  try {
    let params = [tanggalHariIni];
    let queryHadir = `SELECT COUNT(*) FROM absensi a JOIN siswa s ON a.siswa_id = s.id WHERE a.tanggal = $1::DATE AND a.status = 'Hadir'`;
    let querySiswa = `SELECT COUNT(*) FROM siswa WHERE (status_kelulusan IS NULL OR status_kelulusan = 'Aktif')`;
    let queryAlumni = `SELECT COUNT(*) FROM siswa WHERE status_kelulusan = 'Alumni'`;

    if (sekolahId && sekolahId !== '0' && sekolahId !== 'null') {
      queryHadir += ` AND s.sekolah_id = $2`;
      querySiswa += ` AND sekolah_id = $1`;
      queryAlumni += ` AND sekolah_id = $1`;
      params.push(sekolahId);
    }

    const hadirRes = await pool.query(queryHadir, sekolahId && sekolahId !== '0' && sekolahId !== 'null' ? [tanggalHariIni, sekolahId] : [tanggalHariIni]);
    const siswaRes = await pool.query(querySiswa, sekolahId && sekolahId !== '0' && sekolahId !== 'null' ? [sekolahId] : []);
    const alumniRes = await pool.query(queryAlumni, sekolahId && sekolahId !== '0' && sekolahId !== 'null' ? [sekolahId] : []);

    res.json({
      hadir_hari_ini: hadirRes.rows[0].count,
      total_siswa_aktif: siswaRes.rows[0].count,
      total_alumni: alumniRes.rows[0].count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
