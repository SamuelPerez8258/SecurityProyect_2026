-- Tabla para los usuarios
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    

    is_active BOOLEAN DEFAULT TRUE,                        
    reset_password_token VARCHAR(255) DEFAULT NULL,          
    reset_password_expires TIMESTAMP DEFAULT NULL,           
    last_login TIMESTAMP DEFAULT NULL,                       
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0, 
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP DEFAULT NULL;



-- Tabla de expansiones 
CREATE TABLE IF NOT EXISTS expansions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE,
    release_date DATE,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- Tabla de sobres individuales 
CREATE TABLE IF NOT EXISTS booster_packs (
    id SERIAL PRIMARY KEY,
    expansion_id INT NOT NULL REFERENCES expansions(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

