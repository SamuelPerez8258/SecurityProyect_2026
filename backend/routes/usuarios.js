const router = require('express').Router();
const argon2 = require('argon2');
const pool = require('../db');
const { requireRol } = require('../middleware/roles');

const ROLES = ['comprador', 'vendedor', 'administrador'];
const admin = requireRol('administrador');

const aUsuario = u => ({
    id: String(u.id), nombre: u.username, email: u.email,
    telefono: u.phone || '', direccion: u.address || '', rol: u.rol,
    estado: u.is_active ? 'activo' : 'suspendido', creado: u.created_at
});

router.get('/', ...admin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
        res.json(rows.map(aUsuario));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.post('/', ...admin, async (req, res) => {
    const { nombre, email, password, rol = 'comprador', telefono = '', direccion = '' } = req.body ?? {};
    if (typeof nombre !== 'string' || typeof email !== 'string' || typeof password !== 'string' ||
        !/^[a-zA-Z0-9_]{3,30}$/.test(nombre) || !email.includes('@') || password.length < 6 || !ROLES.includes(rol)) {
        return res.status(400).json({ message: 'Datos de usuario invalidos.' });
    }
    try {
        const hash = await argon2.hash(password);
        const { rows } = await pool.query(
            `INSERT INTO users (email, username, password_hash, rol, phone, address, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,true,NOW()) RETURNING *`,
            [email.trim().toLowerCase(), nombre, hash, rol, telefono, direccion]);
        res.status(201).json(aUsuario(rows[0]));
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ message: 'Correo o usuario ya registrados.' });
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.put('/:id', ...admin, async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    const b = req.body ?? {};
    if (b.rol !== undefined && !ROLES.includes(b.rol)) return res.status(400).json({ message: 'Rol invalido.' });
    if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6))
        return res.status(400).json({ message: 'Contrasena muy corta.' });
    try {
        const activo = b.estado === undefined ? null : b.estado === 'activo';
        const { rows } = await pool.query(
            `UPDATE users SET username=COALESCE($1,username), email=COALESCE($2,email), phone=COALESCE($3,phone),
             address=COALESCE($4,address), rol=COALESCE($5,rol), is_active=COALESCE($6,is_active)
             WHERE id=$7 RETURNING *`,
            [b.nombre ?? null, b.email ? String(b.email).toLowerCase() : null, b.telefono ?? null,
             b.direccion ?? null, b.rol ?? null, activo, id]);
        if (!rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });
        if (b.password) {
            await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await argon2.hash(b.password), id]);
        }
        res.json(aUsuario(rows[0]));
    } catch (e) {
        if (e.code === '23505') return res.status(400).json({ message: 'Correo o usuario ya registrados.' });
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.delete('/:id', ...admin, async (req, res) => {
    const id = parseInt(req.params.id, 10) || 0;
    if (id === req.actor.id) return res.status(400).json({ message: 'No puedes eliminarte a ti mismo.' });
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.status(204).end();
    } catch (e) {
        console.error(e.message);
        res.status(409).json({ message: 'No se puede eliminar: tiene datos asociados.' });
    }
});

module.exports = router;