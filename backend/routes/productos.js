const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireRole, sesionOpcional } = require('../middleware/auth');
const v = require('../lib/validar');

const SELECT_PRODUCTO = `
  SELECT
    id,
    nombre,
    descripcion,
    categoria,
    set_coleccion      AS "set",
    numero,
    rareza,
    etiqueta,
    codigo,
    certificadora,
    nota,
    numero_certificado AS "numeroCertificado",
    precio::float      AS precio,
    stock,
    imagen,
    origen,
    vendedor_id::text  AS "vendedorId",
    vendedor_nombre    AS "vendedorNombre",
    estado,
    unica,
    anio,
    idioma,
    centrado,
    conservacion,
    creado
  FROM productos
`;

const ESTADOS = ['publicado', 'en_revision', 'rechazado'];

// Cada campo que el cliente puede mandar, con su columna y su validacion.
// La llave es el nombre que usa el front; nunca entra texto del usuario como columna.
const CAMPOS = {
  nombre: ['nombre', x => v.texto(x, 'El nombre', { min: 2, max: 120, requerido: true })],
  descripcion: ['descripcion', x => v.texto(x, 'La descripcion', { max: 1000, contenido: true })],
  categoria: ['categoria', x => v.texto(x, 'La categoria', { max: 30 })],
  set: ['set_coleccion', x => v.texto(x, 'El set', { max: 80 })],
  numero: ['numero', x => v.texto(x, 'El numero', { max: 30 })],
  rareza: ['rareza', x => v.texto(x, 'La rareza', { max: 60 })],
  etiqueta: ['etiqueta', x => v.texto(x, 'La etiqueta', { max: 120 })],
  codigo: ['codigo', x => v.texto(x, 'El codigo', { max: 120 })],
  certificadora: ['certificadora', x => v.texto(x, 'La certificadora', { max: 40 })],
  nota: ['nota', x => v.texto(x, 'La nota', { max: 40 })],
  numeroCertificado: ['numero_certificado', x => v.texto(x, 'El numero de certificado', { max: 40 }) || '-'],
  precio: ['precio', x => v.numero(x, 'El precio', { min: 0.01, max: 1000000 })],
  stock: ['stock', x => v.numero(x, 'El stock', { min: 0, max: 999, entero: true })],
  imagen: ['imagen', x => v.imagen(x)],
  unica: ['unica', x => x === true || x === 'true'],
  anio: ['anio', x => v.texto(x, 'El anio', { max: 10 }) || null],
  idioma: ['idioma', x => v.texto(x, 'El idioma', { max: 30 }) || null],
  centrado: ['centrado', x => v.texto(x, 'El centrado', { max: 30 }) || null],
  conservacion: ['conservacion', x => v.texto(x, 'La conservacion', { max: 40 }) || null]
};

function aError(res, err) {
  if (err.http) return res.status(err.http).json({ message: err.message });
  console.error(err.stack || err);
  return res.status(500).json({ message: 'Error interno del servidor' });
}

// GET /productos  publico: solo publicados. Con sesion: tambien los propios.
// El administrador ve todos (para moderar).
router.get('/productos', sesionOpcional, async (req, res) => {
  try {
    let rows;
    if (req.user && req.user.rol === 'administrador') {
      ({ rows } = await pool.query(`${SELECT_PRODUCTO} ORDER BY creado DESC`));
    } else if (req.user) {
      ({ rows } = await pool.query(
        `${SELECT_PRODUCTO} WHERE estado = 'publicado' OR vendedor_id = $1 ORDER BY creado DESC`,
        [req.user.sub]
      ));
    } else {
      ({ rows } = await pool.query(`${SELECT_PRODUCTO} WHERE estado = 'publicado' ORDER BY creado DESC`));
    }
    res.json(rows);
  } catch (err) {
    aError(res, err);
  }
});

// POST /productos  requiere sesion activa. Los usuarios publican en la comunidad
// (quedan en revision); el administrador carga piezas de la tienda ya publicadas.
router.post('/productos', requireAuth, requireRole('comprador', 'vendedor', 'administrador'), async (req, res) => {
  const b = req.body ?? {};
  try {
    const d = {};
    for (const clave in CAMPOS) {
      if (clave === 'imagen' || clave === 'nombre' || b[clave] !== undefined) d[clave] = CAMPOS[clave][1](b[clave]);
    }
    if (d.precio === undefined) throw new v.ErrorValidacion('El precio es obligatorio.');
    if (d.stock === undefined) d.stock = 1;
    if (d.unica) d.stock = Math.min(1, d.stock);

    const esAdmin = req.user.rol === 'administrador';
    const u = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.sub]);
    const vendedorNombre = u.rows[0] ? u.rows[0].username : null;
    const id = 'pv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    await pool.query(
      `INSERT INTO productos
        (id, nombre, descripcion, categoria, set_coleccion, numero, rareza, etiqueta, codigo,
         certificadora, nota, numero_certificado, precio, stock, imagen, origen,
         vendedor_id, vendedor_nombre, estado, unica, anio, idioma, centrado, conservacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        id, d.nombre, d.descripcion || '', d.categoria || null, d.set || '', d.numero || '',
        d.rareza || '', d.etiqueta || '', d.codigo || '', d.certificadora || null, d.nota || null,
        d.numeroCertificado || '-', d.precio, d.stock, d.imagen,
        esAdmin ? 'tienda' : 'comunidad', req.user.sub, vendedorNombre,
        esAdmin ? 'publicado' : 'en_revision', !!d.unica,
        d.anio || null, d.idioma || null, d.centrado || null, d.conservacion || null
      ]
    );
    const { rows } = await pool.query(`${SELECT_PRODUCTO} WHERE id = $1`, [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    aError(res, err);
  }
});

// PUT /productos/:id  el dueno modifica su publicacion (vuelve a revision);
// el administrador puede modificar cualquiera y es el unico que cambia el estado.
router.put('/productos/:id', requireAuth, requireRole(), async (req, res) => {
  const id = v.idProducto(req.params.id);
  if (!id) return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });

  const esAdmin = req.user.rol === 'administrador';
  const b = req.body ?? {};
  try {
    const sets = [];
    const values = [];
    for (const clave in CAMPOS) {
      if (b[clave] !== undefined) {
        values.push(CAMPOS[clave][1](b[clave]));
        sets.push(`${CAMPOS[clave][0]} = $${values.length}`);
      }
    }
    if (b.estado !== undefined && esAdmin) {
      if (!ESTADOS.includes(b.estado)) throw new v.ErrorValidacion('Estado no valido.');
      values.push(b.estado);
      sets.push(`estado = $${values.length}`);
    } else if (!esAdmin && sets.length > 0) {
      // cualquier cambio del vendedor pasa otra vez por moderacion
      sets.push(`estado = 'en_revision'`);
    }
    if (sets.length === 0) return res.status(400).json({ message: 'Nada que actualizar' });

    values.push(id, req.user.sub, esAdmin);
    const n = values.length;
    const r = await pool.query(
      `UPDATE productos SET ${sets.join(', ')}
       WHERE id = $${n - 2} AND (vendedor_id = $${n - 1} OR $${n}::boolean)`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });

    const { rows } = await pool.query(`${SELECT_PRODUCTO} WHERE id = $1`, [id]);
    res.json(rows[0]);
  } catch (err) {
    aError(res, err);
  }
});

// DELETE /productos/:id  el dueno borra su publicacion; el administrador cualquiera.
router.delete('/productos/:id', requireAuth, requireRole(), async (req, res) => {
  const id = v.idProducto(req.params.id);
  if (!id) return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });
  try {
    const esAdmin = req.user.rol === 'administrador';
    const r = await pool.query(
      'DELETE FROM productos WHERE id = $1 AND (vendedor_id = $2 OR $3::boolean)',
      [id, req.user.sub, esAdmin]
    );
    if (r.rowCount === 0) return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    // un producto con facturas no se puede borrar: se deja de publicar
    if (err.code === '23503') return res.status(409).json({ message: 'La pieza tiene ventas registradas: rechazala o deja el stock en 0.' });
    aError(res, err);
  }
});

module.exports = router;
