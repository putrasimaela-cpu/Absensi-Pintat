const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// Middleware parsing data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Koneksi Database Neon PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 1. Route Halaman Utama (Login)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Route API Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Username atau password salah!' });
        }

        const user = result.rows[0];
        if (user.password !== password) {
            return res.status(400).json({ success: false, message: 'Username atau password salah!' });
        }

        // Login sukses
        res.json({ success: true, redirectUrl: '/dashboard.html', user: { nama: user.nama, role: user.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Fallback Route (Menagani semua halaman agar tidak "Not Found")
app.get('*', (req, res) => {
    const filePath = path.join(__dirname, 'public', req.path);
    res.sendFile(filePath, (err) => {
        if (err) {
            // Jika file tidak ditemukan, kembalikan ke index.html
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    });
});

// Export untuk Serverless Vercel
module.exports = app;

// Jalankan server lokal jika bukan di Vercel
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
