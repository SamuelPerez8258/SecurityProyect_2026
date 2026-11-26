// Facturas: compra, aviso de pago y conciliacion.
// Basado en el trabajo de Samuel (feature/Login), adaptado a la tabla productos de develop.
const router = require('express').Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

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

async function porFolio(folio, client = pool) {
  const { rows } = await client.query('SELECT * FROM invoices WHERE invoice_number = $1', [String(folio)]);
  return rows[0];
}

// GET /facturas  admin ve todas; los demas, sus compras y las ventas de sus productos
router.get('/facturas', ...conSesion, async (req, res) => {
  try {
    let rows;
    if (req.user.rol === 'administrador') {
      ({ rows } = await pool.query('SELECT * FROM invoices ORDER BY id DESC'));
    } else {
      ({ rows } = await pool.query(
        `SELECT i.* FROM invoices i
         WHERE i.user_id = $1
            OR EXISTS (SELECT 1 FROM order_items oi JOIN productos p ON p.id = oi.producto_id
                       WHERE oi.order_id = i.order_id AND p.vendedor_id = $1)
         ORDER BY i.id DESC`,
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
    // VULN: IDOR (introducida a proposito por Samuel). No se verifica que la factura
    // pertenezca al usuario autenticado y el folio es secuencial (PV-AAAA-0001, 0002...).
    const f = await porFolio(req.params.folio);
    if (!f) return res.status(404).json({ message: 'Factura no encontrada.' });
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0;
    const detalle = [];

    for (const l of lineas) {
      const pid = String(l.productoId ?? l.id ?? '');
      const cant = parseInt(l.cantidad, 10);
      if (!pid || !Number.isInteger(cant) || cant < 1) throw { http: 400, message: 'Linea invalida en el carrito.' };

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

    const codigo = String(promo || '').toUpperCase();
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
    const c = comprador && typeof comprador === 'object' ? comprador : {};
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
      pago: pago && typeof pago === 'object'
        ? { metodo: String(pago.metodo || ''), tipo: String(pago.tipo || '') }
        : String(pago || ''),
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
  try {
    const f = await porFolio(req.params.folio);
    if (!f) return res.status(404).json({ message: 'Factura no encontrada.' });
    if (req.user.rol !== 'administrador' && f.user_id !== Number(req.user.sub)) {
      return res.status(403).json({ message: 'No es tu factura.' });
    }

    const data = f.data || {};
    if (!(TRANSICIONES[data.estado] || []).includes('verificacion')) {
      return res.status(409).json({ message: 'Esta factura no puede pasar a verificacion.' });
    }

    const b = req.body ?? {};
    data.avisos = [...(data.avisos || []), {
      banco: String(b.banco || ''),
      referencia: String(b.referencia || ''),
      fecha: String(b.fecha || ''),
      monto: Number(b.monto) || 0,
      depositante: String(b.depositante || ''),
      hora: new Date().toISOString()
    }];
    data.estado = 'verificacion';

    await pool.query('UPDATE invoices SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), f.id]);
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['verificacion', f.order_id]);
    res.json(aFactura({ ...f, data }));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
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
    const f = await porFolio(req.params.folio, client);
    if (!f) {
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
