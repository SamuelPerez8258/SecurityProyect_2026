
ALTER TABLE users ADD COLUMN IF NOT EXISTS rol VARCHAR(20) NOT NULL DEFAULT 'comprador';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_rol;

UPDATE users SET rol = 'administrador' WHERE rol = 'admin';
UPDATE users SET rol = 'comprador' WHERE rol NOT IN ('comprador', 'vendedor', 'administrador');

ALTER TABLE users ALTER COLUMN rol SET DEFAULT 'comprador';
ALTER TABLE users ADD CONSTRAINT chk_user_rol CHECK (rol IN ('comprador', 'vendedor', 'administrador'));