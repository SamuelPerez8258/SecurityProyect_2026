const router = require('express').Router();
const pool = require('../db');
const { requireRol } = require('../middleware/roles');

const TODOS = ['comprador', 'vendedor', 'administrador'];
const IVA = 0.13;
const PROMOS = { BOVEDA10: 0.10, ESTUDIANTE5: 0.05, PIEZA1: 0.15 };
const ENVIO = 9;
const ENVIO_GRATIS_DESDE = 250;

// Misma maquina de estados que Frontend/js/factura.js
const TRANSICIONES = {
    pendiente: ['verificacion', 'anulada'],
    verificacion: ['pagado', 'pendiente'],
    pagado: [],
    anulada: []
};

const aFactura = r => ({ ...(r.data || {}), folio: r.invoice_number });

async function porFolio(folio, client = pool) {
    const { rows } = await client.query('SELECT * FROM invoices WHERE invoice_number = $1', [String(folio)]);
    return rows[0];
}

router.get('/', ...requireRol(...TODOS), async (req, res) => {
    try {
        let rows;
        if (req.actor.rol === 'administrador') {
            ({ rows } = await pool.query('SELECT * FROM invoices ORDER BY id DESC'));
        } else if (req.actor.rol === 'comprador') {
            ({ rows } = await pool.query('SELECT * FROM invoices WHERE user_id = $1 ORDER BY id DESC', [req.actor.id]));
        } else {
            ({ rows } = await pool.query(
                `SELECT i.* FROM invoices i WHERE EXISTS (
                   SELECT 1 FROM order_items oi JOIN user_card_listings l ON l.id = oi.listing_id
                   WHERE oi.order_id = i.order_id AND l.user_id = $1) ORDER BY i.id DESC`, [req.actor.id]));
        }
        res.json(rows.map(aFactura));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.get('/:folio', ...requireRol(...TODOS), async (req, res) => {
    try {
        // VULN: IDOR - no se verifica que la factura pertenezca al usuario autenticado
        const f = await porFolio(req.params.folio);
        if (!f) return res.status(404).json({ message: 'Factura no encontrada.' });
        res.json(aFactura(f));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.post('/', ...requireRol('comprador', 'administrador'), async (req, res) => {
    const { lineas, comprador, pago, promo } = req.body ?? {};
    if (!Array.isArray(lineas) || !lineas.length) return res.status(400).json({ message: 'El carrito esta vacio.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let subtotal = 0;
        const detalle = [];
        for (const l of lineas) {
            const pid = parseInt(l.productoId ?? l.id, 10);
            const cant = parseInt(l.cantidad, 10);
            if (!pid || !Number.isInteger(cant) || cant < 1) throw { http: 400, message: 'Linea invalida.' };
            const { rows } = await client.query(
                `SELECT * FROM user_card_listings WHERE id = $1 AND status = 'publicado' FOR UPDATE`, [pid]);
            if (!rows.length) throw { http: 404, message: 'Una pieza del carrito ya no esta disponible.' };
            if (rows[0].stock < cant) throw { http: 409, message: `Stock insuficiente de ${rows[0].card_name}.` };
            await client.query('UPDATE user_card_listings SET stock = stock - $1 WHERE id = $2', [cant, pid]);
            const precio = Number(rows[0].price);
            subtotal += precio * cant;
            detalle.push({ ...(rows[0].extra || {}), productoId: String(pid), nombre: rows[0].card_name, precio, cantidad: cant,
                           subtotal: +(precio * cant).toFixed(2), imagen: rows[0].image_url || '' });
        }

        const codigo = String(promo || '').toUpperCase();
        const pct = PROMOS[codigo] || 0;
        const descuento = +(subtotal * pct).toFixed(2);
        const base = +(subtotal - descuento).toFixed(2);
        const envio = subtotal === 0 || base >= ENVIO_GRATIS_DESDE ? 0 : ENVIO;
        const impuesto = +(base * IVA).toFixed(2);
        const total = +(base + envio + impuesto).toFixed(2);

        const u = (await client.query('SELECT username, email, phone, address FROM users WHERE id = $1', [req.actor.id])).rows[0];
        const dir = (comprador && comprador.direccion) || u.address || '';

        const o = await client.query(
            `INSERT INTO orders (user_id, total, status, shipping_address, created_at)
             VALUES ($1,$2,'pendiente',$3,NOW()) RETURNING id`, [req.actor.id, total, dir]);
        const orderId = o.rows[0].id;
        for (const d of detalle) {
            await client.query(
                'INSERT INTO order_items (order_id, listing_id, card_name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)',
                [orderId, d.productoId, d.nombre, d.precio, d.cantidad]);
        }

        const folio = `PV-${new Date().getFullYear()}-${String(orderId).padStart(4, '0')}`;
        const factura = {
            folio,
            referencia: folio.replace(/[^0-9]/g, ''),
            fecha: new Date().toISOString(),
            vence: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
            estado: 'pendiente',
            pago: pago || '',
            comprador: { ...(comprador || {}), id: String(req.actor.id),
                         nombre: (comprador && comprador.nombre) || u.username,
                         email: (comprador && comprador.email) || u.email,
                         telefono: (comprador && comprador.telefono) || u.phone || '', direccion: dir },
            lineas: detalle,
            totales: {
                qty: detalle.reduce((s, d) => s + d.cantidad, 0),
                sub: +subtotal.toFixed(2), disc: descuento, base, ship: envio, iva: impuesto, total,
                promo: pct ? codigo : '',
                promoLabel: pct ? `${codigo} (−${Math.round(pct * 100)}%)` : ''
            },
            avisos: []
        };
        await client.query(
            `INSERT INTO invoices (order_id, user_id, invoice_number, issued_date, tax_amount, total_amount, created_at, data)
             VALUES ($1,$2,$3,NOW(),$4,$5,NOW(),$6::jsonb)`,
            [orderId, req.actor.id, folio, impuesto, total, JSON.stringify(factura)]);
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

// El comprador avisa que ya pago -> pasa a "verificacion"
router.post('/:folio/avisos', ...requireRol('comprador', 'administrador'), async (req, res) => {
    try {
        const f = await porFolio(req.params.folio);
        if (!f) return res.status(404).json({ message: 'Factura no encontrada.' });
        if (req.actor.rol !== 'administrador' && f.user_id !== req.actor.id)
            return res.status(403).json({ message: 'No es tu factura.' });
        const data = f.data || {};
        if (!(TRANSICIONES[data.estado] || []).includes('verificacion'))
            return res.status(409).json({ message: 'Esta factura no puede pasar a verificacion.' });
        data.avisos = [...(data.avisos || []), { ...(req.body ?? {}), hora: new Date().toISOString() }];
        data.estado = 'verificacion';
        await pool.query('UPDATE invoices SET data = $1::jsonb WHERE id = $2', [JSON.stringify(data), f.id]);
        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['verificacion', f.order_id]);
        res.json(aFactura({ ...f, data }));
    } catch (e) {
        console.error(e.message);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// El administrador confirma, rechaza o anula el pago
router.post('/:folio/estado', ...requireRol('administrador'), async (req, res) => {
    const estado = req.body?.estado;
    if (!Object.keys(TRANSICIONES).includes(estado)) return res.status(400).json({ message: 'Estado invalido.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const f = await porFolio(req.params.folio, client);
        if (!f) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Factura no encontrada.' }); }
        const data = f.data || {};
        if (!(TRANSICIONES[data.estado] || []).includes(estado)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `No se puede pasar de ${data.estado} a ${estado}.` });
        }
        if (estado === 'pagado') {
            const ultimo = (data.avisos || [])[(data.avisos || []).length - 1] || {};
            data.registro = { ...ultimo, hora: new Date().toISOString() };
            data.pagado = new Date().toISOString();
        }
        if (estado === 'anulada') {
            data.anulada = new Date().toISOString();
            // devolver el stock
            await client.query(
                `UPDATE user_card_listings l SET stock = l.stock + oi.quantity
                 FROM order_items oi WHERE oi.order_id = $1 AND oi.listing_id = l.id`, [f.order_id]);
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