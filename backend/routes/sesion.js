const router = require('express').Router();
const pool = require('../db');
const { requireRol } = require('../middleware/roles');

router.get('/api/me', ...requireRol('comprador', 'vendedor', 'administrador'), async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.actor.id]);
        const u = rows[0];
        const usuario = {
            id: String(u.id), nombre: u.username, email: u.email,
            telefono: u.phone || '', direccion: u.address || '', rol: u.rol,
            estado: u.is_active ? 'activo' : 'suspendido', creado: u.created_at
        };
        res.json({ ...usuario, usuario });
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.status(204).end();
});

module.exports = router;