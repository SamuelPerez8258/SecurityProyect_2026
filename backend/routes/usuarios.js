// CRUD de usuarios para el panel de administracion.
// Basado en el trabajo de Samuel (feature/Login), adaptado a develop.
const router = require('express').Router();
const argon2 = require('argon2');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const ROLES = ['comprador', 'vendedor', 'administrador'];
const soloAdmin = [requireAuth, requireRole('administrador')];

const aUsuario = u => ({
  id: String(u.id),
  nombre: u.username,
  email: u.email,
  telefono: u.phone || '',
  direccion: u.address || '',
  rol: u.rol,
  estado: u.is_active ? 'activo' : 'suspendido',
  creado: u.created_at
});

// GET /usuarios  solo administrador
router.get('/usuarios', ...soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, phone, address, rol, is_active, created_at
       FROM users ORDER BY id`
    );
    res.json(rows.map(aUsuario));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// POST /usuarios  solo administrador. Crea una cuenta con rol y contrasena temporal.
router.post('/usuarios', ...soloAdmin, async (req, res) => {
  const { nombre, email, password, rol = 'comprador', telefono = '', direccion = '' } = req.body ?? {};

  if (typeof nombre !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(nombre)) {
    return res.status(400).json({ message: 'El usuario debe tener de 3 a 30 letras, numeros o guion bajo, sin espacios.' });
  }
  if (typeof email !== 'string' || !email.includes('@') || email.length > 250) {
    return res.status(400).json({ message: 'El correo no es valido.' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return res.status(400).json({ message: 'La contrasena debe tener al menos 6 caracteres.' });
  }
  if (!ROLES.includes(rol)) {
    return res.status(400).json({ message: 'Rol no valido.' });
  }

  try {
    const hash = await argon2.hash(password);
    const { rows } = await pool.query(
      `INSERT INTO users (email, username, password_hash, rol, phone, address, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       RETURNING id, username, email, phone, address, rol, is_active, created_at`,
      [email.trim().toLowerCase(), nombre, hash, rol, String(telefono), String(direccion)]
    );
    res.status(201).json(aUsuario(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ message: 'El correo o el usuario ya estan registrados.' });
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// PUT /usuarios/:id  solo administrador. Cambia rol, estado (activo/suspendido) o datos.
router.put('/usuarios/:id', ...soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const b = req.body ?? {};

  if (b.rol !== undefined && !ROLES.includes(b.rol)) {
    return res.status(400).json({ message: 'Rol no valido.' });
  }
  if (b.estado !== undefined && !['activo', 'suspendido'].includes(b.estado)) {
    return res.status(400).json({ message: 'Estado no valido.' });
  }
  if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 6)) {
    return res.status(400).json({ message: 'La contrasena debe tener al menos 6 caracteres.' });
  }
  // Un admin no puede quitarse el rol ni suspenderse a si mismo y quedar sin acceso
  if (id === Number(req.user.sub) && ((b.rol && b.rol !== 'administrador') || b.estado === 'suspendido')) {
    return res.status(400).json({ message: 'No puedes quitarte el rol de administrador ni suspenderte.' });
  }

  try {
    const activo = b.estado === undefined ? null : b.estado === 'activo';
    const { rows } = await pool.query(
      `UPDATE users SET
         username  = COALESCE($1, username),
         email     = COALESCE($2, email),
         phone     = COALESCE($3, phone),
         address   = COALESCE($4, address),
         rol       = COALESCE($5, rol),
         is_active = COALESCE($6, is_active)
       WHERE id = $7
       RETURNING id, username, email, phone, address, rol, is_active, created_at`,
      [b.nombre ?? null, b.email ? String(b.email).trim().toLowerCase() : null, b.telefono ?? null,
       b.direccion ?? null, b.rol ?? null, activo, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });

    if (b.password) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await argon2.hash(b.password), id]);
    }
    res.json(aUsuario(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ message: 'El correo o el usuario ya estan registrados.' });
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// DELETE /usuarios/:id  solo administrador. No se puede borrar a si mismo.
router.delete('/usuarios/:id', ...soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  if (id === Number(req.user.sub)) {
    return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta.' });
  }
  try {
    // orders e invoices tienen ON DELETE CASCADE: borrar al usuario borraria su historial
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM orders WHERE user_id = $1)
            + (SELECT count(*) FROM productos WHERE vendedor_id = $1) AS n`,
      [id]
    );
    if (Number(rows[0].n) > 0) {
      return res.status(409).json({ message: 'No se puede eliminar: tiene pedidos o publicaciones. Suspendelo en su lugar.' });
    }

    const r = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ message: 'Usuario no encontrado.' });
    res.json({ message: 'Usuario eliminado' });
  } catch (e) {
    console.error(e.message);
    res.status(409).json({ message: 'No se puede eliminar: tiene pedidos o facturas asociadas. Suspendelo en su lugar.' });
  }
});

module.exports = router;
