ALTER TABLE users 
ADD COLUMN rol VARCHAR(20) NOT NULL DEFAULT 'guest';

ALTER TABLE users 
ADD CONSTRAINT chk_user_rol CHECK (rol IN ('admin', 'verified', 'guest'));

ALTER TABLE users 
ADD COLUMN phone VARCHAR(20);

ALTER TABLE users 
ADD COLUMN address TEXT;