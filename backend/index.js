require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');

if(!process.env.JWT_SECRET){
    console.error('Falta la variable de entorno JWT_SECRET');
    process.exit(1);
}

const app = express();

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database:process.env.DB_NAME,
});

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const GENERICO = { message: 'Usuario o contraseña incorrectos' };

let DUMMY_HASH;
argon2.hash('dummy-password').then(hash => {
    DUMMY_HASH = hash;
});









































app.get('/login', (req, res) => {
    res.send('Login route brou')
})

app.get('/api/db-test', async (req, res) => {
    try{
        const resultado = await pool.query('SELECT COUNT(*) FROM users');
        res.json({ usuarios: resultado.rows[0].count })
    } catch (err){
        console.log(err.stack);
        res.status(500).json({ error: 'no se pudo conectar con la base de datos', detalle: err.message })
    }
})

app.post('/api/login', (req, res) => {
    const { email, password } = req.body

    if(email === 'a@a.com' && password === '1234') {
        res.json({ message: 'Login successful' })
    } else {
        res.status(401).json({ message: 'Invalid credentials' })
    }
})

app.listen(3000, () => {
    console.log('Server is running on port 3000');
})