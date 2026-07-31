const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cron = require('node-cron');
const axios = require('axios');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

// Melayani file tampilan HTML dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Koneksi Database PostgreSQL (Otomatis membaca URL dari Neon.tech/Render)
const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY_ABSENSI';
const QR_SECRET_KEY = process.env.QR_SECRET_KEY || 'SECRET_KEY_GURU_QR';

// Formula Haversine (Hitung Jarak GPS dalam Meter)
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// 1. LOGIN API (Memvalidasi User)
app.post('/api/auth/login', async (req, res) => {
    const { username, password, device_id } = req.body;
    try {
        const userRes = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Username atau Password salah.' });
        }

        const user = userRes.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Username atau Password salah.' });
        }

        // Pengecekan Device Binding
        if (user.role === 'STUDENT') {
            if (!user.device_id) {
                await db.query('UPDATE users SET device_id = $1 WHERE id = $2', [device_id, user.id]);
            } else if (user.device_id !== device_id) {
                return res.status(403).json({ success: false, message: 'Akun ini terikat pada HP lain.' });
            }
        }

        const token = jwt.sign({ id: user.id, school_id: user.school_id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token, role: user.role, name: user.full_name });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. ABSENSI VIA QR CODE & GEOFENCING API
app.post('/api/qr/validate-checkin', async (req, res) => {
    const { student_id, qr_payload, latitude, longitude, device_id } = req.body;

    try {
        const studentRes = await db.query('SELECT * FROM users WHERE id = $1', [student_id]);
        const student = studentRes.rows[0];

        const schoolRes = await db.query('SELECT * FROM schools WHERE id = $1', [student.school_id]);
        const school = schoolRes.rows[0];

        // Validasi GPS (Geofencing)
        const distance = getDistanceMeters(latitude, longitude, school.latitude, school.longitude);
        if (distance > school.radius_meters) {
            return res.status(400).json({
                success: false,
                message: `Absen gagal: Berada ${Math.round(distance)}m di luar lokasi sekolah.`
            });
        }

        const currentTimeStr = new Date().toTimeString().split(' ')[0];
        const status = currentTimeStr > school.checkin_deadline ? 'TERLAMBAT' : 'HADIR';

        await db.query(
            `INSERT INTO attendances (school_id, student_id, date, check_in_time, status, latitude, longitude)
             VALUES ($1, $2, CURRENT_DATE, CURRENT_TIME, $3, $4, $5)`,
            [school.id, student_id, status, latitude, longitude]
        );

        res.json({ success: true, message: `Berhasil Presensi! Status: ${status}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server Absensi Pintar berjalan di port ${PORT}`);
});
