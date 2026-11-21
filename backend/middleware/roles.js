const pool = require('../db');
const { requireAuth } = require('./auth');

function requireRol(...roles) {
    return [requireAuth, async (req, res, next) => {
        try {
            const { rows } = await pool.query('SELECT id, rol, is_active FROM users WHERE id = $1', [req.user.sub]);
            if (!rows.length || !rows[0].is_active) return res.status(401).json({ message: 'No autorizado' });
            if (!roles.includes(rows[0].rol)) return res.status(403).json({ message: 'No tienes permiso' });
            req.actor = { id: rows[0].id, rol: rows[0].rol };
            next();
        } catch (e) {
            console.error(e.message);
            res.status(500).json({ message: 'Error interno del servidor.' });
        }
    }];
}

module.exports = { requireRol };