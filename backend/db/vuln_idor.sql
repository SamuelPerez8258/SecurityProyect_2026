-- VULN IDOR: factura "cebo" del administrador.
-- Sirve para demostrar la vulnerabilidad de control de acceso de
-- GET /facturas/:folio. El folio es bajo (PV-2026-0001...), asi que un atacante
-- que ve el patron de su propio folio puede adivinarlo y leer esta factura ajena,
-- con los datos personales del admin y un mensaje oculto.
DO $$
DECLARE
  admin_id INT;
  nueva_orden INT;
  folio TEXT;
  p productos%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE data->>'bandera' IS NOT NULL) THEN
    RETURN;
  END IF;

  SELECT id INTO admin_id FROM users WHERE email = 'admin@pokevault.local';
  IF admin_id IS NULL THEN RETURN; END IF;

  SELECT * INTO p FROM productos WHERE id = 'pv-001';

  INSERT INTO orders (user_id, total, status, shipping_address, created_at)
  VALUES (admin_id, 1250.00, 'pagado', 'Bodega central PokeVault, San Salvador', NOW())
  RETURNING id INTO nueva_orden;

  folio := 'PV-2026-' || LPAD(nueva_orden::text, 4, '0');

  IF p.id IS NOT NULL THEN
    INSERT INTO order_items (order_id, producto_id, nombre, unit_price, quantity)
    VALUES (nueva_orden, p.id, p.nombre, p.precio, 1);
  END IF;

  INSERT INTO invoices (order_id, user_id, invoice_number, issued_date, tax_amount, total_amount, created_at, data)
  VALUES (nueva_orden, admin_id, folio, NOW(), 143.75, 1250.00, NOW(),
    jsonb_build_object(
      'folio', folio,
      'referencia', regexp_replace(folio, '[^0-9]', '', 'g'),
      'fecha', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'vence', to_char(NOW() + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'estado', 'pagado',
      'bandera', 'Felicidades, encontraste la primera. Para la segunda, mira como trata la galeria los archivos SVG: no siempre una imagen es solo una imagen. Lo demas lo armas vos. — Anthony',
      'pago', jsonb_build_object('metodo', 'Transferencia bancaria', 'tipo', 'Transferencia'),
      'comprador', jsonb_build_object(
        'id', admin_id::text,
        'nombre', 'Administrador PokeVault',
        'email', 'admin@pokevault.local',
        'telefono', '7000-0001',
        'direccion', 'Bodega central PokeVault, San Salvador',
        'rfc', '00000000-0',
        'ciudad', 'San Salvador',
        'departamento', 'San Salvador',
        'cp', '1101',
        'condicion', 'C',
        'condicionLabel', 'Consumidor final'
      ),
      'lineas', jsonb_build_array(jsonb_build_object(
        'productoId', COALESCE(p.id, 'pv-001'),
        'nombre', COALESCE(p.nombre, 'Carta de coleccion'),
        'set', COALESCE(p.set_coleccion, ''),
        'numero', COALESCE(p.numero, ''),
        'rareza', COALESCE(p.rareza, ''),
        'certificadora', COALESCE(p.certificadora, ''),
        'nota', COALESCE(p.nota, ''),
        'numeroCertificado', COALESCE(p.numero_certificado, '-'),
        'cantidad', 1,
        'precio', COALESCE(p.precio, 1106.25),
        'stock', COALESCE(p.stock, 0),
        'unica', COALESCE(p.unica, false)
      )),
      'totales', jsonb_build_object(
        'qty', 1, 'sub', 1106.25, 'disc', 0, 'base', 1106.25,
        'ship', 0, 'iva', 143.75, 'total', 1250.00, 'promo', '', 'promoLabel', ''
      ),
      'avisos', '[]'::jsonb
    )
  );
END $$;
