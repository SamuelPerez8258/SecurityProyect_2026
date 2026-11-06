const router = require('express').Router();
const argon2 = require('argon2');
const pool = require('../db');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');
const { rateLimitLogin, MAX_INTENTOS } = require('../middleware/rateLimit');

const BLOQUEO_MIN = 15;
const GENERICO = { message: 'Usuario o contraseña incorrectos' };

let DUMMY_HASH;
argon2.hash('dummy-password').then(hash => {
    DUMMY_HASH = hash;
});


const registroIpMap = new Map();
function rateLimitRegister(req, res, next) {
    const ahora = Date.now();
    const registro = registroIpMap.get(req.ip) ?? { count: 0, desde: ahora };

    if (ahora - registro.desde > 15 * 60 * 1000) {
        registro.count = 0;
        registro.desde = ahora;
    }

    registro.count++;
    registroIpMap.set(req.ip, registro);


    if (registro.count > 5) {
        return res.status(429).json({ message: 'Demasiados intentos de registro. Intente más tarde.' });
    }

    next();
}


router.post('/register', rateLimitRegister, async (req, res) => {
    const { email, username, password } = req.body ?? {};

    
    if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string' ||
        email.trim() === '' || username.trim() === '' || password === ''
    ) {
        return res.status(400).json({ error: "Todos los campos son obligatorios y deben ser texto válido." });
    }

    if (email.length > 250 || !email.includes('@')) {
        return res.status(400).json({ error: "El correo electrónico no es válido o excede el límite." });
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).json({ error: "El nombre de usuario debe tener entre 3 y 30 caracteres y solo puede contener letras, números y guiones bajos." });
    }

  
    if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: "La contraseña debe tener entre 8 y 128 caracteres." });
    }

    try {
        const emailNormalizado = email.trim().toLowerCase();
        const passwordHash = await argon2.hash(password);

        const query = `
            INSERT INTO users (email, username, password_hash, is_active, created_at)
            VALUES ($1, $2, $3, true, NOW())
            RETURNING id;
        `;

        const values = [emailNormalizado, username, passwordHash];
        await pool.query(query, values);

        return res.status(201).json({
            mensaje: "¡Usuario registrado con éxito!"
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: "El correo o el nombre de usuario ya están registrados." });
        }

        console.error("Error en registro:", error.message);
        return res.status(500).json({ error: "Error interno del servidor." });
    }
});

router.post('/api/login', rateLimitLogin, async (req, res) => {
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


router.get('/api/me', requireAuth, (req, res) => {    
    res.json({ id: req.user.sub });
});

router.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Sesión cerrada' });
});

module.exports = router;