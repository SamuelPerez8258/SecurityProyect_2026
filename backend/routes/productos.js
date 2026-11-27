const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

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



const CAMPOS = {
  nombre: 'nombre',
  descripcion: 'descripcion',
  categoria: 'categoria',
  set: 'set_coleccion',
  numero: 'numero',
  rareza: 'rareza',
  etiqueta: 'etiqueta',
  codigo: 'codigo',
  certificadora: 'certificadora',
  nota: 'nota',
  numeroCertificado: 'numero_certificado',
  precio: 'precio',
  stock: 'stock',
  imagen: 'imagen',
  estado: 'estado',
  unica: 'unica',
  anio: 'anio',
  idioma: 'idioma',
  centrado: 'centrado',
  conservacion: 'conservacion'
};


router.get('/productos', async (req, res) => {
  try {
    const { rows } = await pool.query(`${SELECT_PRODUCTO} ORDER BY creado DESC`);
    res.json(rows);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});


router.post('/productos', requireAuth, requireRole('comprador', 'vendedor', 'administrador'), async (req, res) => {
  const b = req.body ?? {};

  if (typeof b.nombre !== 'string' || b.nombre.trim() === '') {
    return res.status(400).json({ message: 'El nombre es obligatorio' });
  }

  try {
    const u = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.sub]);
    const vendedorNombre = u.rows[0] ? u.rows[0].username : null;

    const id = 'pv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const precio = Number(b.precio) || 0;
    const unica = !!b.unica;
    let stock = Number(b.stock) || 0;
    if (unica) stock = Math.min(1, stock);

    const insert = `
      INSERT INTO productos
        (id, nombre, descripcion, categoria, set_coleccion, numero, rareza, etiqueta, codigo,
         certificadora, nota, numero_certificado, precio, stock, imagen, origen,
         vendedor_id, vendedor_nombre, estado, unica, anio, idioma, centrado, conservacion)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'comunidad',
         $16,$17,'en_revision',$18,$19,$20,$21,$22)
    `;
    const values = [
      id,
      b.nombre.trim(),
      (b.descripcion || '').trim(),
      b.categoria || null,
      (b.set || '').trim(),
      (b.numero || '').trim(),
      (b.rareza || '').trim(),
      (b.etiqueta || '').trim(),
      (b.codigo || '').trim(),
      b.certificadora || null,
      b.nota || null,
      b.numeroCertificado || '-',
      precio,
      stock,
      b.imagen || null,
      req.user.sub,
      vendedorNombre,
      unica,
      b.anio || null,
      b.idioma || null,
      b.centrado || null,
      b.conservacion || null
    ];

    await pool.query(insert, values);
    const { rows } = await pool.query(`${SELECT_PRODUCTO} WHERE id = $1`, [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});


router.put('/productos/:id', requireAuth, requireRole(), async (req, res) => {
  const esAdmin = req.user.rol === 'administrador';
  const parche = { ...(req.body ?? {}) };
  if (!esAdmin) delete parche.estado;
  const sets = [];
  const values = [];
  let i = 1;

  for (const clave in CAMPOS) {
    if (parche[clave] !== undefined) {
      let valor = parche[clave];
      if (clave === 'precio' || clave === 'stock') valor = Number(valor) || 0;
      if (clave === 'unica') valor = !!valor;
      sets.push(`${CAMPOS[clave]} = $${i}`);
      values.push(valor);
      i++;
    }
  }

  if (sets.length === 0) {
    return res.status(400).json({ message: 'Nada que actualizar' });
  }

  try {
    values.push(req.params.id);
    values.push(req.user.sub);
    values.push(esAdmin);
    const q = `UPDATE productos SET ${sets.join(', ')}
               WHERE id = $${i} AND (vendedor_id = $${i + 1} OR $${i + 2}::boolean)`;
    const r = await pool.query(q, values);

    if (r.rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });
    }

    const { rows } = await pool.query(`${SELECT_PRODUCTO} WHERE id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});


router.delete('/productos/:id', requireAuth, requireRole(), async (req, res) => {
  try {
    const esAdmin = req.user.rol === 'administrador';
    const r = await pool.query(
      'DELETE FROM productos WHERE id = $1 AND (vendedor_id = $2 OR $3::boolean)',
      [req.params.id, req.user.sub, esAdmin]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ message: 'Producto no encontrado o no te pertenece' });
    }

    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error(err.stack);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

module.exports = router;