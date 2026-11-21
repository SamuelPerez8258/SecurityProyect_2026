const router = require('express').Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireRol } = require('../middleware/roles');

const CORE = ['id', 'nombre', 'descripcion', 'precio', 'stock', 'imagen', 'estado', 'vendedorId', 'vendedorNombre', 'creado'];
const ESTADOS = ['publicado', 'en_revision', 'rechazado'];

const aProducto = r => ({
    ...(r.extra || {}),
    id: String(r.id),
    nombre: r.card_name,
    descripcion: r.description || '',
    precio: Number(r.price),
    stock: r.stock,
    imagen: r.image_url || '',
    estado: r.status,
    vendedorId: String(r.user_id),
    vendedorNombre: r.username || null,
    creado: r.created_at
});

function extraDe(b) {
    const extra = {};
    for (const k of Object.keys(b)) if (!CORE.includes(k)) extra[k] = b[k];
    return extra;
}

function validar(b) {
    const precio = Number(b.precio);
    const stock = parseInt(b.stock, 10);
    if (typeof b.nombre !== 'string' || b.nombre.trim() === '') return 'El nombre es obligatorio.';
    if (!Number.isFinite(precio) || precio < 0) return 'Precio invalido.';
    if (!Number.isInteger(stock) || stock < 0) return 'Stock invalido.';
    return null;
}

async function traer(id) {
    const { rows } = await pool.query(
        'SELECT l.*, u.username FROM user_card_listings l JOIN users u ON u.id = l.user_id WHERE l.id = $1', [id]);
    return rows[0];
}

// Catalogo: publico. Admin ve todo; vendedor ve lo publicado y lo suyo.
router.get('/', async (req, res) => {
    try {
        let uid = null, rol = null;
        try {
            const p = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            const r = await pool.query('SELECT id, rol FROM users WHERE id = $1', [p.sub]);
            if (r.rows[0]) { uid = r.rows[0].id; rol = r.rows[0].rol; }
        } catch { /* visitante sin sesion */ }

        let sql = `SELECT l.*, u.username FROM user_card_listings l JOIN users u ON u.id = l.user_id WHERE 1=1`;
        if (rol !== 'administrador') {
            sql += uid
                ? ` AND (l.status = 'publicado' OR l.user_id = ${Number(uid)})`
                : ` AND l.status = 'publicado'`;
        }
        if (req.query.buscar) {
            // VULN: SQLi - el parametro "buscar" se concatena directo en la consulta
            sql += ` AND l.card_name ILIKE '%${req.query.buscar}%'`;
        }
        sql += ' ORDER BY l.id DESC';
        const { rows } = await pool.query(sql);
        res.json(rows.map(aProducto));
    } catch (e) {
        console.error('Error productos:', e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.post('/', ...requireRol('vendedor', 'administrador'), async (req, res) => {
    const b = req.body ?? {};
    const err = validar(b);
    if (err) return res.status(400).json({ message: err });
    try {
        const esAdmin = req.actor.rol === 'administrador';
        const extra = { ...extraDe(b), origen: esAdmin ? 'tienda' : 'comunidad' };
        let stock = parseInt(b.stock, 10);
        if (b.unica) stock = Math.min(1, stock);
        const { rows } = await pool.query(
            `INSERT INTO user_card_listings (user_id, card_name, description, price, stock, image_url, status, extra, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW()) RETURNING id`,
            [req.actor.id, b.nombre.trim(), b.descripcion || '', Number(b.precio), stock,
             b.imagen || '', esAdmin ? 'publicado' : 'en_revision', JSON.stringify(extra)]);
        res.status(201).json(aProducto(await traer(rows[0].id)));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

async function cargarPropio(req, res) {
    const p = await traer(parseInt(req.params.id, 10) || 0);
    if (!p) { res.status(404).json({ message: 'Producto no encontrado.' }); return null; }
    if (req.actor.rol !== 'administrador' && p.user_id !== req.actor.id) {
        res.status(403).json({ message: 'No es tu producto.' }); return null;
    }
    return p;
}

router.put('/:id', ...requireRol('vendedor', 'administrador'), async (req, res) => {
    try {
        const actual = await cargarPropio(req, res);
        if (!actual) return;
        const b = { nombre: actual.card_name, descripcion: actual.description, precio: actual.price,
                    stock: actual.stock, imagen: actual.image_url, ...req.body };
        const err = validar(b);
        if (err) return res.status(400).json({ message: err });
        const extra = { ...(actual.extra || {}), ...extraDe(req.body ?? {}) };
        let stock = parseInt(b.stock, 10);
        if (extra.unica) stock = Math.min(1, stock);
        // solo el admin cambia el estado de publicacion
        const estado = req.actor.rol === 'administrador' && ESTADOS.includes(req.body?.estado)
            ? req.body.estado : actual.status;
        await pool.query(
            `UPDATE user_card_listings SET card_name=$1, description=$2, price=$3, stock=$4,
             image_url=$5, status=$6, extra=$7::jsonb WHERE id=$8`,
            [b.nombre.trim(), b.descripcion || '', Number(b.precio), stock, b.imagen || '',
             estado, JSON.stringify(extra), actual.id]);
        res.json(aProducto(await traer(actual.id)));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.delete('/:id', ...requireRol('vendedor', 'administrador'), async (req, res) => {
    try {
        const actual = await cargarPropio(req, res);
        if (!actual) return;
        await pool.query('DELETE FROM user_card_listings WHERE id = $1', [actual.id]);
        res.status(204).end();
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;