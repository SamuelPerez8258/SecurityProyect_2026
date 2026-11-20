-- Usuarios de prueba por rol 
-- admin@pokevault.local / Admin12345
-- vendedor@pokevault.local / Vendedor123
-- comprador@pokevault.local / Comprador123
INSERT INTO users (username, email, password_hash, rol, phone, address, is_active) VALUES
('admin', 'admin@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$UmF+dHn9GMhaR+wn8Jrl3g$MdCguammcKFSk38jGlevdQwBhC92vK9Br3kzMI7So/s', 'administrador', '7000-0001', 'San Salvador', true),
('vendedor', 'vendedor@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$bKhhngvhU+uaVpwspjc+tQ$xaAanEpzvPJGeDjivsVBK6qQLcw/YINjNacgGGSU2pE', 'vendedor', '7000-0002', 'Santa Tecla', true),
('comprador', 'comprador@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$h2wWwBL6ORbAntM2dL95ow$uiQby7ifzgrpUJUAaiO+7Sf7doNC45mDtVOwQ2uvm1M', 'comprador', '7000-0003', 'Antiguo Cuscatlan', true)
ON CONFLICT (email) DO UPDATE SET rol = EXCLUDED.rol, password_hash = EXCLUDED.password_hash, is_active = true;