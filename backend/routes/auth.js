const router = require('express').Router();
const argon2 = require('argon2');
const pool = require('../db');
const jwt = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');
const v = require('../lib/validar');
const { rateLimitLogin, falloLogin, loginCorrecto, MAX_INTENTOS } = require('../middleware/rateLimit');

const BLOQUEO_MIN = 15;
const GENERICO = { message: 'Usuario o contrasena incorrectos' };
const ROLES_REGISTRO = ['comprador', 'vendedor'];

let DUMMY_HASH;
argon2.hash('dummy-password').then(hash => {
    DUMMY_HASH = hash;
});

function aUsuario(u) {
    return {
        id: String(u.id),
        nombre: u.username,
        email: u.email,
        telefono: u.phone || '',
        direccion: u.address || '',
        rol: u.rol,
        estado: u.is_active ? 'activo' : 'suspendido',
        creado: u.created_at
    };
}


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
        return res.status(429).json({ message: 'Demasiados intentos de registro. Intente mas tarde.' });
    }

    next();
}


router.post('/register', rateLimitRegister, async (req, res) => {
    const { email, username, password } = req.body ?? {};
    const rol = req.body?.rol ?? 'comprador';


    let emailNormalizado;
    try {
        emailNormalizado = v.email(email);
        v.usuario(username);
        v.password(password);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    // En el registro publico nadie puede pedir ser administrador
    if (!ROLES_REGISTRO.includes(rol)) {
        return res.status(400).json({ error: "Rol no valido." });
    }

    try {
        const passwordHash = await argon2.hash(password);

        const query = `
            INSERT INTO users (email, username, password_hash, rol, is_active, created_at)
            VALUES ($1, $2, $3, $4, true, NOW())
            RETURNING id;
        `;

        const values = [emailNormalizado, username, passwordHash, rol];
        await pool.query(query, values);

        return res.status(201).json({
            mensaje: "Usuario registrado con exito"
        });

    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: "El correo o el nombre de usuario ya estan registrados." });
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
            `SELECT id, username, email, password_hash, is_active, rol, phone, address, created_at,
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

            falloLogin(req.ip);
            return res.status(401).json(GENERICO)

        }

        await pool.query(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1`,
            [user.id]
        )

        loginCorrecto(req.ip);
        const token = jwt.sign({ sub: user.id, rol: user.rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 1000,
        });

        res.json({ message: 'Login exitoso', username: user.username, usuario: aUsuario(user) });

    } catch (err){
        console.error(err.stack);
        res.status(500).json({ message: 'Error interno del servidor'

        })
    }
})


router.get('/api/me', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, username, email, is_active, rol, phone, address, created_at
            FROM users WHERE id = $1`,
            [req.user.sub]
        );
        const user = rows[0];

        if (!user || !user.is_active) {
            return res.status(401).json({ message: 'No autorizado' });
        }

        res.json({ id: user.id, usuario: aUsuario(user) });
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
});

router.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Sesion cerrada' });
});

module.exports = router;