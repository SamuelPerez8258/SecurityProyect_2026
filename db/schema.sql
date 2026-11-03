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