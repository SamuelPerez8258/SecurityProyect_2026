-- Usuarios de prueba por rol
-- admin@pokevault.local / $PKadmin67$
-- vendedor@pokevault.local / $PKvendedor67$
-- comprador@pokevault.local / $PKcomprador67$
INSERT INTO users (username, email, password_hash, rol, phone, address, is_active) VALUES
('admin', 'admin@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$KMhh13oMi/YgP6OhX+gK2g$TXQ7sgvQlFWB205DN8jWtsAOADImz2z4Vl/s0n6EANg', 'administrador', '7000-0001', 'San Salvador', true),
('vendedor', 'vendedor@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$bJJ97mU1xPqiI2uFU0z1Cw$Wj3Zr8lxAVFL0DpN/3gJ7hzWKy7QT78g5nVwpNZSask', 'vendedor', '7000-0002', 'Santa Tecla', true),
('comprador', 'comprador@pokevault.local', '$argon2id$v=19$m=65536,t=3,p=4$8vKvQPtGRjLa7lcJYOZHlA$rUknFrEI2nAcpRuz4eU7fvd3FDlRiuLlDDl9gfPvSDM', 'comprador', '7000-0003', 'Antiguo Cuscatlan', true)
ON CONFLICT (email) DO UPDATE SET rol = EXCLUDED.rol, password_hash = EXCLUDED.password_hash, is_active = true;
