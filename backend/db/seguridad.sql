-- Migracion de seguridad (se puede correr varias veces)

-- Nombre de usuario unico sin importar mayusculas: nadie puede registrarse
-- con el mismo nombre que otro (por ejemplo "Admin" contra "admin").
-- Si ya habia repetidos, a los mas nuevos se les agrega el id al final.
UPDATE users u SET username = u.username || '_' || u.id
WHERE EXISTS (
  SELECT 1 FROM users o
  WHERE lower(o.username) = lower(u.username) AND o.id < u.id
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unico ON users (lower(username));

-- Los tokens emitidos antes de esta fecha dejan de servir
-- (se actualiza al cerrar sesion, cambiar contrasena o suspender la cuenta).
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_validos_desde TIMESTAMPTZ;
