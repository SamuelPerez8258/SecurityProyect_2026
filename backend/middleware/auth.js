const jwt = require('jsonwebtoken');
const pool = require('../db');

function leerToken(req) {
    return jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

// Usuario activo cuyo token sigue vigente. Un token emitido antes de
// tokens_validos_desde (logout, cambio de contrasena, suspension) ya no sirve.
async function usuarioDelToken(t) {
    const { rows } = await pool.query(
        'SELECT rol, is_active, tokens_validos_desde FROM users WHERE id = $1',
        [t.sub]
    );
    const u = rows[0];
    if (!u || !u.is_active) return null;
    // ims: momento de emision en milisegundos (iat solo tiene precision de segundos)
    const emitido = Number.isFinite(t.ims) ? t.ims : t.iat * 1000;
    if (u.tokens_validos_desde && emitido < u.tokens_validos_desde.getTime()) return null;
    return u;
}

function requireAuth(req, res, next) {
    try {
        req.user = leerToken(req);
        next();
    } catch {
        res.status(401).json({ message: 'No autorizado' });
    }
}

// Va despues de requireAuth. Lee el rol desde la BD en cada peticion para que
// un cambio de rol, una suspension o un logout aplique de inmediato.
// Sin argumentos solo carga req.user.rol.
function requireRole(...roles) {
    return async (req, res, next) => {
        try {
            const u = await usuarioDelToken(req.user);
            if (!u) {
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
        const u = await usuarioDelToken(t);
        if (u) req.user = { sub: t.sub, rol: u.rol };
    } catch {
        req.user = undefined;
    }
    next();
}

module.exports = { requireAuth, requireRole, sesionOpcional, leerToken, usuarioDelToken };
