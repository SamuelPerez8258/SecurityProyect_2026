const jwt = require('jsonwebtoken');
const pool = require('../db');

function requireAuth(req, res, next) {
    try{
        req.user = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        next();
    } catch {
        res.status(401).json({ message: 'No autorizado' })
    }
}

function requireRole(...roles) {
    return async (req, res, next) => {
        try {
            const { rows } = await pool.query(
                'SELECT rol, is_active FROM users WHERE id = $1',
                [req.user.sub]
            );
            const u = rows[0];

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

module.exports = { requireAuth, requireRole };