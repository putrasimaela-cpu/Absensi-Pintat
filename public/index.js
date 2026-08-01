const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express melayani static files dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Route Login API
app.post('/api/login', async (req, res) => {
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

        res.json({ success: true, redirectUrl: '/dashboard.html', user: { nama: user.nama, role: user.role } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Serve frontend fallback
app.get('*', (req, res) => {
    let filePath = path.join(__dirname, '../public', req.path === '/' ? 'index.html' : req.path);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, '../public', 'index.html'));
        }
    });
});

module.exports = app;
