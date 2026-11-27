DROP DATABASE IF EXISTS sayc_db;

CREATE DATABASE sayc_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE sayc_db;

-- Organizations: each company registered in the system. Every user, product, sale and
-- inventory adjustment belongs to exactly one, and the API only ever shows a user the
-- records of their own organization.
CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    org_name VARCHAR(150) NOT NULL,
    org_tax_id VARCHAR(30),
    org_email VARCHAR(150) NOT NULL,
    org_phone VARCHAR(30),
    org_address VARCHAR(255),
    org_state VARCHAR(20) NOT NULL DEFAULT 'activo',
    org_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    org_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Roles are shared by every organization.
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    role_description TEXT
);

-- Users. The email is unique across organizations, because it is what signs a user in.
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    user_name VARCHAR(100) NOT NULL,
    user_email VARCHAR(150) NOT NULL UNIQUE,
    user_pass_hash VARCHAR(255) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    user_state VARCHAR(20) DEFAULT 'activo',
    user_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    INDEX idx_users_org (organization_id)
);

-- Products. Two organizations may stock the same barcode; one organization may not twice.
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    product_barcode VARCHAR(100),
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
    product_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY uq_products_org_barcode (organization_id, product_barcode)
);

-- Sales
CREATE TABLE sales (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    sales_total DECIMAL(10,2) NOT NULL,
    sales_received_pay DECIMAL(10,2) NOT NULL,
    sales_change DECIMAL(10,2) NOT NULL,
    sales_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_sales_org_date (organization_id, sales_date)
);

-- Sales detail. Belongs to an organization through its sale.
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

-- Inventory: the history of every stock change other than a sale.
CREATE TABLE inventory_adjustments (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    adj_type VARCHAR(50) NOT NULL,
    adj_previous_amount INT NOT NULL,
    adj_new_amount INT NOT NULL,
    adj_motive TEXT,
    adj_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_adjustments_org_date (organization_id, adj_date)
);

-- History of a product's selling price and cost. Ids count up, so they order entries
-- made in the same millisecond. A row is added whenever either changes,
-- so past sales and margins can be explained. Deleting a product deletes its history.
CREATE TABLE product_price_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    price_previous DECIMAL(10,2),
    price_new DECIMAL(10,2) NOT NULL,
    cost_previous DECIMAL(10,2),
    cost_new DECIMAL(10,2) NOT NULL,
    price_changed_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_price_history_product (product_id, price_changed_at)
);

-- Change log: every insert, update and delete the API makes, with the values before and
-- after. audit_record_id has no foreign key, so the entry outlives a deleted record.
CREATE TABLE audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36),
    audit_table VARCHAR(50) NOT NULL,
    audit_record_id VARCHAR(36) NOT NULL,
    audit_action VARCHAR(10) NOT NULL,
    audit_old JSON,
    audit_new JSON,
    audit_date TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_audit_org_date (organization_id, audit_date),
    INDEX idx_audit_record (audit_table, audit_record_id)
);


-- Test data. Passwords are plaintext here; run `npm run db:hash-passwords` in server/
-- afterwards, which replaces them with bcrypt hashes. All test users use 'admin123'.

INSERT INTO organizations (id, org_name, org_tax_id, org_email, org_phone, org_address) VALUES
('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'Abarrotes Don Pepe', 'ADP010101AB1', 'contacto@donpepe.mx', '5551234567', 'Av. Juárez 120, Centro'),
('1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'Minisúper La Esperanza', 'MLE020202CD2', 'hola@laesperanza.mx', '5559876543', 'Calle Hidalgo 45, Col. Del Valle');

INSERT INTO roles (id, role_name, role_description) VALUES
('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Administrador', 'Control total del sistema y configuraciones'),
('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Empleado', 'Acceso al módulo de ventas e inventario básico');

INSERT INTO users (id, organization_id, user_name, user_email, user_pass_hash, role_id, user_state) VALUES
('c3d4e5f6-a7b8-9012-cdef-123456789012', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'Administrador 1', 'admin@sayc.com', 'admin123', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'activo'),
('d4e5f6a7-b8c9-0123-defa-234567890123', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'Empleado 1', 'empleado@sayc.com', 'admin123', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'activo'),
('e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'Laura Méndez', 'admin@laesperanza.mx', 'admin123', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'activo'),
('f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'Jorge Ruiz', 'cajero@laesperanza.mx', 'admin123', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'activo');

-- Abarrotes Don Pepe
INSERT INTO products (id, organization_id, product_barcode, product_name, product_brand, product_description, product_sell_price, product_costs, product_current_stock, product_min_stock, product_img_url) VALUES
('e5f6a7b8-c9d0-1234-efab-345678901234', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '7501001112223', 'Coca Cola 600ml', 'Coca Cola', 'Refresco de cola no retornable', 18.00, 12.00, 25, 5, 'https://tse3.mm.bing.net/th/id/OIP.TUaLsx-PqOHIyOfWZwxRxQHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3'),
('f6a7b8c9-d0e1-2345-fabc-456789012345', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '7501003334445', 'Sabritas Original 45g', 'Sabritas', 'Papas fritas con sal', 17.50, 10.00, 15, 4, 'https://cdn.shopify.com/s/files/1/0105/9212/4964/products/190_1600x.jpg?v=1579317290'),
('a7b8c9d0-e1f2-3456-abcd-567890123456', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '7501005556667', 'Leche Entera 1L', 'Lala', 'Leche pasteurizada entera', 28.00, 22.00, 0, 3, 'https://i5.walmartimages.com.mx/gr/images/product-images/img_large/00750179162193L.jpg?odnHeight=612&odnWidth=612&odnBg=FFFFFF'),
('b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d01', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '7501000111206', 'Pan Blanco Grande', 'Bimbo', 'Pan de caja 680 g', 52.00, 41.00, 8, 3, NULL),
('b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d02', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', '7501052474403', 'Huevo Blanco 12 pzas', 'Bachoco', 'Docena de huevo blanco', 45.00, 36.00, 2, 4, NULL);

-- Minisúper La Esperanza: shares a barcode with Don Pepe, at its own price and stock.
INSERT INTO products (id, organization_id, product_barcode, product_name, product_brand, product_description, product_sell_price, product_costs, product_current_stock, product_min_stock, product_img_url) VALUES
('c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e01', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', '7501001112223', 'Coca Cola 600ml', 'Coca Cola', 'Refresco de cola no retornable', 19.00, 12.50, 40, 10, NULL),
('c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e02', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', '7501030426165', 'Atún en Agua 140g', 'Dolores', 'Atún aleta amarilla en agua', 24.00, 17.00, 30, 6, NULL),
('c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e03', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', '7501008042953', 'Café Soluble 120g', 'Nescafé', 'Café clásico soluble', 89.00, 70.00, 5, 5, NULL);

-- The opening price of every product, so each one has a history from the start.
INSERT INTO product_price_history (organization_id, product_id, user_id, price_previous, price_new, cost_previous, cost_new)
SELECT p.organization_id, p.id, u.id, NULL, p.product_sell_price, NULL, p.product_costs
  FROM products p
  JOIN users u ON u.organization_id = p.organization_id AND u.role_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- A later price rise at Don Pepe.
INSERT INTO product_price_history (organization_id, product_id, user_id, price_previous, price_new, cost_previous, cost_new, price_changed_at) VALUES
('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'e5f6a7b8-c9d0-1234-efab-345678901234', 'c3d4e5f6-a7b8-9012-cdef-123456789012', 17.00, 18.00, 11.50, 12.00, CURRENT_TIMESTAMP(3) + INTERVAL 1 SECOND);

-- Sales: 2 Coca Cola + 1 Sabritas at Don Pepe, 3 Atún at La Esperanza.
INSERT INTO sales (id, organization_id, user_id, sales_total, sales_received_pay, sales_change) VALUES
('b8c9d0e1-f2a3-4678-bcde-678901234567', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'd4e5f6a7-b8c9-0123-defa-234567890123', 53.50, 100.00, 46.50),
('e4f5a6b7-c8d9-4e0f-1a2b-3c4d5e6f7a01', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c', 72.00, 100.00, 28.00);

INSERT INTO sales_detail (id, sales_id, product_id, detail_quantity, detail_unit_price, detail_subtotal) VALUES
('c9d0e1f2-a3b4-5789-cdef-789012345678', 'b8c9d0e1-f2a3-4678-bcde-678901234567', 'e5f6a7b8-c9d0-1234-efab-345678901234', 2, 18.00, 36.00),
('d0e1f2a3-b4c5-6890-defa-890123456789', 'b8c9d0e1-f2a3-4678-bcde-678901234567', 'f6a7b8c9-d0e1-2345-fabc-456789012345', 1, 17.50, 17.50),
('f5a6b7c8-d9e0-4f1a-2b3c-4d5e6f7a8b01', 'e4f5a6b7-c8d9-4e0f-1a2b-3c4d5e6f7a01', 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e02', 3, 24.00, 72.00);

-- An inventory adjustment at each organization.
INSERT INTO inventory_adjustments (id, organization_id, product_id, user_id, adj_type, adj_previous_amount, adj_new_amount, adj_motive) VALUES
('a6b7c8d9-e0f1-4a2b-3c4d-5e6f7a8b9c01', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d02', 'd4e5f6a7-b8c9-0123-defa-234567890123', 'merma', 4, 2, 'Dos piezas rotas al recibir'),
('a6b7c8d9-e0f1-4a2b-3c4d-5e6f7a8b9c02', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e03', 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b', 'entrada', 0, 5, 'Compra a proveedor');

-- The change log starts with each organization's registration.
INSERT INTO audit_log (organization_id, user_id, audit_table, audit_record_id, audit_action, audit_old, audit_new) VALUES
('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'c3d4e5f6-a7b8-9012-cdef-123456789012', 'organizations', '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'INSERT', NULL, JSON_OBJECT('org_name', 'Abarrotes Don Pepe')),
('1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b', 'organizations', '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e', 'INSERT', NULL, JSON_OBJECT('org_name', 'Minisúper La Esperanza')),
('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', 'c3d4e5f6-a7b8-9012-cdef-123456789012', 'products', 'e5f6a7b8-c9d0-1234-efab-345678901234', 'UPDATE', JSON_OBJECT('product_sell_price', 17.00, 'product_costs', 11.50), JSON_OBJECT('product_sell_price', 18.00, 'product_costs', 12.00));
