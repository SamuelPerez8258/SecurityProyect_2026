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

const intentosPorIp = new Map();
function rateLimitLogin(req, res, next) {
    const ahora = Date.now();
    const registro = intentosPorIp.get(req.ip) ?? { count:0, desde: ahora };

    if(ahora - registro.desde > 15 * 60 * 1000){
        registro.count = 0;  
        registro.desde = ahora;  
    }

    registro.count++;
    intentosPorIp.set(req.ip, registro);

    if(registro.count > MAX_INTENTOS){
        return res.status(429).json({ message: `Demasiados intentos. Intenta mas tarde` });
    }

    next();
}

function requireAuth(req, res, next) {
    try{
        req.user = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); 
        next();
    } catch {
        res.status(401).json({ message: 'No autorizado' })
    }
}

app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
        return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }

    try {
        // Hasheamos la contraseña usando argon2 (compatible con el login de Samuel)
        const passwordHash = await argon2.hash(password);

        const query = `
            INSERT INTO users (email, username, password_hash, is_active, created_at)
            VALUES ($1, $2, $3, true, NOW())
            RETURNING id, email, username, created_at;
        `;

        const values = [email, username, passwordHash];
        const result = await pool.query(query, values);

        return res.status(201).json({
            mensaje: "¡Usuario registrado con éxito!",
            usuario: result.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: "El correo o el nombre de usuario ya están registrados." });
        }
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', rateLimitLogin, async (req, res) => {
    const { email, password } = req.body ?? {};

    if(typeof email !== 'string' || typeof password !== 'string' ||
        email.length === 0 || password.length === 0 ||
        email.length > 250 || password.length > 128
    ){
        return res.status(400).json({ message: 'Datos invalidos' })
    }

    try{
        const { rows } = await pool.query(
            `SELECT id, username, password_hash, is_active, 
            (locked_until IS NOT NULL AND locked_until > NOW())
            AS bloqueado FROM users WHERE email = $1`,
            [email.trim().toLowerCase()]
        );
        const user = rows[0];

        const ok = await argon2
        .verify(user ? user.password_hash : DUMMY_HASH, password)
        .catch(() => false);

        if(!user || !ok || user.bloqueado || !user.is_active){
            if(user && !ok && !user.bloqueado){
                await pool.query(
                    `UPDATE users SET failed_attempts = 0, locked_until = NULL
                    WHERE id = $1 AND locked_until IS NOT NULL AND locked_until <= NOW()`,
                    [user.id]
                )

                await pool.query(
                    `UPDATE users
                    SET failed_attempts = failed_attempts + 1,
                        locked_until = CASE WHEN failed_attempts + 1 >= $2
                                THEN NOW() + make_interval(mins => $3)
                                ELSE locked_until END
                    WHERE id = $1`,
                    [user.id, MAX_INTENTOS, BLOQUEO_MIN]
                )
            }

            return res.status(401).json(GENERICO)

        }

        await pool.query(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1`,
            [user.id]
        )

        const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 1000,
        });

        res.json({ message: 'Login exitoso', username: user.username });

    } catch (err){
        console.error(err.stack);
        res.status(500).json({ message: 'Error interno del servidor' 

    })            
}


})

app.get('/api/me', requireAuth, (req, res) => {    
    res.json({ id: req.user.sub });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Sesión cerrada' });
});

app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: 'Solicitud inválida' });
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port ' + (process.env.PORT || 3000));
})