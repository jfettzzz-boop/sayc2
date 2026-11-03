DROP database if exists sayc_db;

CREATE DATABASE sayc_db;
USE sayc_db;

-- Roles
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY, 
    role_name VARCHAR(50) NOT NULL UNIQUE,
    role_description TEXT
);

-- Users
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(150) NOT NULL UNIQUE,
    user_pass_hash VARCHAR(255) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    user_state VARCHAR(20) DEFAULT 'activo',
    user_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Products
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,
    product_barcode VARCHAR(100) UNIQUE,
    product_name VARCHAR(150) NOT NULL,
    product_brand VARCHAR(100),
    product_description TEXT,
    product_sell_price DECIMAL(10,2) NOT NULL,
    product_costs DECIMAL(10,2) DEFAULT 0.00,
    product_current_stock INT DEFAULT 0,
    product_min_stock INT DEFAULT 5,
    product_api_origin BOOLEAN DEFAULT FALSE,
    product_img_url VARCHAR(255),
    product_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    product_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Sales
CREATE TABLE sales (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    sales_total DECIMAL(10,2) NOT NULL,
    sales_received_pay DECIMAL(10,2) NOT NULL,
    sales_change DECIMAL(10,2) NOT NULL,
    sales_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sales detail
CREATE TABLE sales_detail (
    id VARCHAR(36) PRIMARY KEY,
    sales_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    detail_quantity INT NOT NULL,
    detail_unit_price DECIMAL(10,2) NOT NULL,
    detail_subtotal DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (sales_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Inventory
CREATE TABLE inventory_adjustments (
    id VARCHAR(36) PRIMARY KEY,
    product_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    adj_type VARCHAR(50) NOT NULL,
    adj_previous_amount INT NOT NULL,
    adj_new_amount INT NOT NULL,
    adj_motive TEXT,
    adj_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);


-- Test data

-- Insert roles
INSERT INTO roles (id, role_name, role_description) VALUES 
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Administrador', 'Control total del sistema y configuraciones'),
('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Empleado', 'Acceso al módulo de ventas e inventario básico');

-- Insert users (temp pass: 'admin123')
INSERT INTO users (id, user_name, user_email, user_pass_hash, role_id, user_state) VALUES 
('c3d4e5f6-a7b8-9012-cdef-123456789012', 'Administrador 1', 'admin@sayc.com', 'admin123', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'activo'),
('d4e5f6a7-b8c9-0123-defa-234567890123', 'Empleado 1', 'empleado@sayc.com', 'admin123', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'activo');

-- Insert products
INSERT INTO products (id, product_barcode, product_name, product_brand, product_description, product_sell_price, product_costs, product_current_stock, product_min_stock, product_img_url) VALUES 
('e5f6a7b8-c9d0-1234-efab-345678901234', '7501001112223', 'Coca Cola 600ml', 'Coca Cola', 'Refresco de cola no retornable', 18.00, 12.00, 25, 5, 'https://tse3.mm.bing.net/th/id/OIP.TUaLsx-PqOHIyOfWZwxRxQHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3'),
('f6a7b8c9-d0e1-2345-fabc-456789012345', '7501003334445', 'Sabritas Original 45g', 'Sabritas', 'Papas fritas con sal', 17.50, 10.00, 15, 4, 'https://cdn.shopify.com/s/files/1/0105/9212/4964/products/190_1600x.jpg?v=1579317290'),
('a7b8c9d0-e1f2-3456-abcd-567890123456', '7501005556667', 'Leche Entera 1L', 'Lala', 'Leche pasteurizada entera', 28.00, 22.00, 0, 3, 'https://i5.walmartimages.com.mx/gr/images/product-images/img_large/00750179162193L.jpg?odnHeight=612&odnWidth=612&odnBg=FFFFFF');

-- Insert sales
INSERT INTO sales (id, user_id, sales_total, sales_received_pay, sales_change) VALUES 
('b8c9d0e1-f2a3-4678-bcde-678901234567', 'd4e5f6a7-b8c9-0123-defa-234567890123', 53.50, 100.00, 46.50);

-- Insert el sales detail (2 Coca Cola + 1 Sabritas)
INSERT INTO sales_detail (id, sales_id, product_id, detail_quantity, detail_unit_price, detail_subtotal) VALUES 
('c9d0e1f2-a3b4-5789-cdef-789012345678', 'b8c9d0e1-f2a3-4678-bcde-678901234567', 'e5f6a7b8-c9d0-1234-efab-345678901234', 2, 18.00, 36.00),
('d0e1f2a3-b4c5-6890-defa-890123456789', 'b8c9d0e1-f2a3-4678-bcde-678901234567', 'f6a7b8c9-d0e1-2345-fabc-456789012345', 1, 17.50, 17.50);
