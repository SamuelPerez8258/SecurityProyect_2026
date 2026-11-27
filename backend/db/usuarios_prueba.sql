-- Usuarios de prueba por rol
-- admin@pokevault.local / PvAdm-NPByRu#4HYZRY
-- vendedor@pokevault.local / PvVen-H7k7EY#JnQ8XJ
-- comprador@pokevault.local / PvCom-iKZh9W#vexAJv
INSERT INTO users (username, email, password_hash, rol, phone, address, is_active) VALUES
('admin', 'admin@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$dp4FG3HS4kJbbJGj50wXTg$MDWVOhjLQ9oVcz0e2q3YhIpeAFsVz7YoAzWrm4S+wts', 'administrador', '7000-0001', 'San Salvador', true),
('vendedor', 'vendedor@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$MJM63+/nY5IO42bCPp2yiw$HGS8itKvppAXjMwRXYzB4f2JaWZeEeXFwLdEAcfuXC4', 'vendedor', '7000-0002', 'Santa Tecla', true),
('comprador', 'comprador@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$tJUdSFogITjFlvKSnNYQvQ$xoesdQSNzDtryafKEOJ5+h9ZP/gF8LIrre30bNT9BUI', 'comprador', '7000-0003', 'Antiguo Cuscatlan', true)
ON CONFLICT (email) DO UPDATE SET rol = EXCLUDED.rol, password_hash = EXCLUDED.password_hash, is_active = true;
