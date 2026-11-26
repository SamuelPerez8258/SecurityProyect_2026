-- Facturas sobre el catalogo de la tabla productos
-- invoices.data guarda la factura completa que muestra el frontend (lineas, totales, avisos)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- order_items de schema.sql solo aceptaba sobres (booster_packs); ahora tambien productos
ALTER TABLE order_items ALTER COLUMN booster_pack_id DROP NOT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS producto_id TEXT REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS nombre VARCHAR(200);
