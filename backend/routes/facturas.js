// Facturas: compra, aviso de pago y conciliacion.
// Basado en el trabajo de Samuel (feature/Login), adaptado a la tabla productos de develop.
const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const v = require('../lib/validar');

const TODOS = ['comprador', 'vendedor', 'administrador'];
const conSesion = [requireAuth, requireRole(...TODOS)];

// Mismas reglas que Frontend/js/factura.js
const IVA = 0.13;
const PROMOS = { BOVEDA10: 0.10, ESTUDIANTE5: 0.05, PIEZA1: 0.15 };
const ENVIO = 9;
const ENVIO_GRATIS_DESDE = 250;
const PLAZO_HORAS = 72;
const TRANSICIONES = {
  pendiente: ['verificacion', 'anulada'],
  verificacion: ['pagado', 'pendiente'],
  pagado: [],
  anulada: []
};

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const aFactura = r => ({ ...(r.data || {}), folio: r.invoice_number });

// bloquear = true: SELECT ... FOR UPDATE dentro de una transaccion, para que dos
// peticiones al mismo tiempo no pisen el estado de la factura (condicion de carrera)
async function porFolio(folio, client = pool, bloquear = false) {
  const f = v.folio(folio);
  if (!f) return undefined;
  const { rows } = await client.query(
    `SELECT * FROM invoices WHERE invoice_number = $1${bloquear ? ' FOR UPDATE' : ''}`, [f]
  );
  return rows[0];
}

// La factura (con DUI, direccion y correo del comprador) solo la ven quien compro
// y el administrador
function puedeVer(f, user) {
  return user.rol === 'administrador' || f.user_id === Number(user.sub);
}

const CONDICIONES = ['C', 'E', 'P'];

// Datos fiscales del comprador: solo campos conocidos y sin HTML
function limpiarComprador(c) {
  const t = (x, n, o) => v.texto(x, n, o);
  const rfc = t(c.rfc, 'El DUI', { max: 10 });
  if (rfc && !/^\d{8}-\d$/.test(rfc)) throw new v.ErrorValidacion('El DUI lleva 9 digitos: 12345678-9.');
  const cp = t(c.cp, 'El codigo postal', { max: 4 });
  if (cp && !/^\d{4}$/.test(cp)) throw new v.ErrorValidacion('El codigo postal son 4 digitos.');
  const condicion = CONDICIONES.includes(c.condicion) ? c.condicion : 'C';
  return {
    nombre: t(c.nombre, 'El nombre', { max: 120 }),
    rfc,
    email: c.email ? v.email(c.email) : '',
    telefono: t(c.telefono, 'El telefono', { max: 20 }),
    direccion: t(c.direccion, 'La direccion', { max: 200, contenido: true }),
    ciudad: t(c.ciudad, 'El municipio', { max: 80 }),
    departamento: t(c.departamento, 'El departamento', { max: 40 }),
    cp,
    condicion,
    condicionLabel: t(c.condicionLabel, 'La condicion', { max: 120, contenido: true })
  };
}

// GET /facturas  admin ve todas; los demas, sus compras y las ventas de sus productos
router.get('/facturas', ...conSesion, async (req, res) => {
  try {
    let rows;
    if (req.user.rol === 'administrador') {
      ({ rows } = await pool.query('SELECT * FROM invoices ORDER BY id DESC'));
    } else {
      ({ rows } = await pool.query(
        'SELECT * FROM invoices WHERE user_id = $1 ORDER BY id DESC',
        [req.user.sub]
      ));
    }
    res.json(rows.map(aFactura));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// GET /facturas/:folio
router.get('/facturas/:folio', ...conSesion, async (req, res) => {
  try {
    const f = await porFolio(req.params.folio);
    // Misma respuesta si no existe o si no es tuya: no se revela que folios existen
    if (!f || !puedeVer(f, req.user)) return res.status(404).json({ message: 'Factura no encontrada.' });
    res.json(aFactura(f));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// POST /facturas  crea el pedido y la factura en una transaccion y descuenta stock.
// Los precios salen de la base de datos, nunca del cliente.
router.post('/facturas', ...conSesion, async (req, res) => {
  const { lineas, comprador, pago, promo } = req.body ?? {};
  if (!Array.isArray(lineas) || lineas.length === 0 || lineas.length > 50) {
    return res.status(400).json({ message: 'El carrito esta vacio.' });
  }

  let c;
  let pagoLimpio;
  let codigo;
  try {
    c = limpiarComprador(comprador && typeof comprador === 'object' ? comprador : {});
    pagoLimpio = pago && typeof pago === 'object'
      ? { metodo: v.texto(pago.metodo, 'La forma de pago', { max: 60 }), tipo: v.texto(pago.tipo, 'El tipo de pago', { max: 30 }) }
      : v.texto(pago, 'La forma de pago', { max: 60 });
    codigo = String(promo || '').toUpperCase();
    if (codigo && !/^[A-Z0-9]{1,20}$/.test(codigo)) codigo = '';
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0;
    const detalle = [];

    for (const l of lineas) {
      const pid = v.idProducto(l && (l.productoId ?? l.id));
      const cant = Number(l && l.cantidad);
      if (!pid || !Number.isInteger(cant) || cant < 1 || cant > 99) throw { http: 400, message: 'Linea invalida en el carrito.' };

      const { rows } = await client.query(
        `SELECT * FROM productos WHERE id = $1 AND estado = 'publicado' FOR UPDATE`, [pid]
      );
      const p = rows[0];
      if (!p) throw { http: 404, message: 'Una pieza del carrito ya no esta disponible.' };
      if (p.stock < cant) throw { http: 409, message: `Stock insuficiente de ${p.nombre}.` };

      await client.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [cant, pid]);

      const precio = Number(p.precio);
      subtotal += precio * cant;
      detalle.push({
        productoId: p.id,
        nombre: p.nombre,
        set: p.set_coleccion || '',
        numero: p.numero || '',
        rareza: p.rareza || '',
        certificadora: p.certificadora || '',
        nota: p.nota || '',
        numeroCertificado: p.numero_certificado || '-',
        cantidad: cant,
        precio,
        stock: p.stock - cant,
        unica: !!p.unica
      });
    }

    const pct = PROMOS[codigo] || 0;
    const sub = round2(subtotal);
    const disc = round2(sub * pct);
    const base = round2(sub - disc);
    const ship = sub === 0 ? 0 : base >= ENVIO_GRATIS_DESDE ? 0 : ENVIO;
    const iva = round2(base * IVA);
    const total = round2(base + ship + iva);

    const u = (await client.query(
      'SELECT username, email, phone, address FROM users WHERE id = $1', [req.user.sub]
    )).rows[0];
    const dir = c.direccion || u.address || '';

    const o = await client.query(
      `INSERT INTO orders (user_id, total, status, shipping_address, created_at)
       VALUES ($1, $2, 'pendiente', $3, NOW()) RETURNING id`,
      [req.user.sub, total, dir]
    );
    const orderId = o.rows[0].id;

    for (const d of detalle) {
      await client.query(
        `INSERT INTO order_items (order_id, producto_id, nombre, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, d.productoId, d.nombre, d.precio, d.cantidad]
      );
    }

    const folio = `PV-${new Date().getFullYear()}-${String(orderId).padStart(4, '0')}`;
    const factura = {
      folio,
      referencia: folio.replace(/[^0-9]/g, ''),
      fecha: new Date().toISOString(),
      vence: new Date(Date.now() + PLAZO_HORAS * 3600 * 1000).toISOString(),
      estado: 'pendiente',
      pago: pagoLimpio,
      comprador: {
        ...c,
        id: String(req.user.sub),
        nombre: c.nombre || u.username,
        email: c.email || u.email,
        telefono: c.telefono || u.phone || '',
        direccion: dir
      },
      lineas: detalle,
      totales: {
        qty: detalle.reduce((s, d) => s + d.cantidad, 0),
        sub, disc, base, ship, iva, total,
        promo: pct ? codigo : '',
        promoLabel: pct ? `${codigo} (-${Math.round(pct * 100)}%)` : ''
      },
      avisos: []
    };

    await client.query(
      `INSERT INTO invoices (order_id, user_id, invoice_number, issued_date, tax_amount, total_amount, created_at, data)
       VALUES ($1, $2, $3, NOW(), $4, $5, NOW(), $6::jsonb)`,
      [orderId, req.user.sub, folio, iva, total, JSON.stringify(factura)]
    );

    await client.query('COMMIT');
    res.status(201).json(factura);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.http) return res.status(e.http).json({ message: e.message });
    console.error(e.message || e);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
});

// POST /facturas/:folio/avisos  el comprador avisa que ya transfirio: pasa a "verificacion"
router.post('/facturas/:folio/avisos', ...conSesion, async (req, res) => {
  const b = req.body ?? {};
  let aviso;
  try {
    const fecha = v.texto(b.fecha, 'La fecha', { max: 10 });
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new v.ErrorValidacion('La fecha no es valida.');
    aviso = {
      banco: v.texto(b.banco, 'El banco', { max: 60 }),
      referencia: v.texto(b.referencia, 'La referencia', { max: 40 }),
      fecha,
      monto: b.monto === undefined || b.monto === '' ? 0 : v.numero(b.monto, 'El monto', { min: 0, max: 10000000 }),
      depositante: v.texto(b.depositante, 'El depositante', { max: 120 }),
      hora: new Date().toISOString()
    };
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await porFolio(req.params.folio, client, true);
    if (!f || !puedeVer(f, req.user)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Factura no encontrada.' });
    }

    const data = f.data || {};
    if (!(TRANSICIONES[data.estado] || []).includes('verificacion')) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Esta factura no puede pasar a verificacion.' });
    }
    if ((data.avisos || []).length >= 10) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Demasiados avisos para esta factura.' });
    }

    data.avisos = [...(data.avisos || []), aviso];
    data.estado = 'verificacion';
    await client.query('UPDATE invoices SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), f.id]);
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['verificacion', f.order_id]);
    await client.query('COMMIT');
    res.json(aFactura({ ...f, data }));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
});

// POST /facturas/:folio/estado  el admin concilia, devuelve a pendiente o anula.
// El comprador solo puede anular su propia factura mientras siga pendiente.
router.post('/facturas/:folio/estado', ...conSesion, async (req, res) => {
  const estado = req.body?.estado;
  if (!Object.keys(TRANSICIONES).includes(estado)) {
    return res.status(400).json({ message: 'Estado invalido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const f = await porFolio(req.params.folio, client, true);
    if (!f || !puedeVer(f, req.user)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Factura no encontrada.' });
    }

    const data = f.data || {};
    const esAdmin = req.user.rol === 'administrador';
    const esDueno = f.user_id === Number(req.user.sub);
    if (!esAdmin && !(esDueno && data.estado === 'pendiente' && estado === 'anulada')) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'No tienes permiso para cambiar esta factura.' });
    }
    if (!(TRANSICIONES[data.estado] || []).includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `No se puede pasar de ${data.estado} a ${estado}.` });
    }

    if (estado === 'pagado') {
      const avisos = data.avisos || [];
      data.registro = { ...(avisos[avisos.length - 1] || {}), hora: new Date().toISOString() };
      data.pagado = new Date().toISOString();
    }
    if (estado === 'anulada') {
      data.anulada = new Date().toISOString();
      // devolver el stock a la boveda
      await client.query(
        `UPDATE productos p SET stock = p.stock + oi.quantity
         FROM order_items oi WHERE oi.order_id = $1 AND oi.producto_id = p.id`,
        [f.order_id]
      );
    }

    data.estado = estado;
    await client.query('UPDATE invoices SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), f.id]);
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [estado, f.order_id]);
    await client.query('COMMIT');
    res.json(aFactura({ ...f, data }));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  } finally {
    client.release();
  }
});

module.exports = router;
