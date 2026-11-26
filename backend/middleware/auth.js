const jwt = require('jsonwebtoken');
const pool = require('../db');

function leerToken(req) {
    return jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

function requireAuth(req, res, next) {
    try {
        req.user = leerToken(req);
        next();
    } catch {
        res.status(401).json({ message: 'No autorizado' });
    }
}

async function cargarUsuario(id) {
    const { rows } = await pool.query('SELECT rol, is_active FROM users WHERE id = $1', [id]);
    return rows[0];
}

// Va despues de requireAuth. Lee el rol desde la BD en cada peticion para que
// un cambio de rol o una suspension aplique de inmediato, sin esperar a que
// expire el token. Sin argumentos solo carga req.user.rol.
function requireRole(...roles) {
    return async (req, res, next) => {
        try {
            const u = await cargarUsuario(req.user.sub);
            if (!u || !u.is_active) {
                return res.status(401).json({ message: 'No autorizado' });
            }
            req.user.rol = u.rol;
            if (roles.length > 0 && !roles.includes(u.rol)) {
                return res.status(403).json({ message: 'No tienes permiso para esta accion' });
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}

// Para rutas publicas que muestran mas datos si hay sesion valida.
// Si el token falta o no sirve, sigue como anonimo.
async function sesionOpcional(req, res, next) {
    try {
        const t = leerToken(req);
        const u = await cargarUsuario(t.sub);
        if (u && u.is_active) req.user = { sub: t.sub, rol: u.rol };
    } catch {
        req.user = undefined;
    }
    next();
}

module.exports = { requireAuth, requireRole, sesionOpcional };
