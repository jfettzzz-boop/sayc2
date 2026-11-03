import { Router } from 'express';
import { pool } from '../db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const LIST_SIZE = 5;
const LOW_STOCK_LIST_SIZE = 10;

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireAdmin);

dashboardRouter.get('/', async (req, res) => {
  const [
    [[users]],
    [[products]],
    [[salesToday]],
    [[salesLast30Days]],
    [lowStockProducts],
    [recentSales],
    [topProducts],
    [recentAdjustments],
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(user_state = 'activo'), 0) AS active FROM users`,
    ),
    pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(product_current_stock <= product_min_stock), 0) AS low_stock,
              COALESCE(SUM(product_current_stock = 0), 0) AS out_of_stock,
              COALESCE(SUM(product_current_stock * product_costs), 0) AS inventory_cost
         FROM products`,
    ),
    pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(sales_total), 0) AS total
         FROM sales WHERE sales_date >= CURDATE()`,
    ),
    pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(sales_total), 0) AS total
         FROM sales WHERE sales_date >= CURDATE() - INTERVAL 29 DAY`,
    ),
    // Same definition of low stock as GET /products?low_stock=true.
    pool.query(
      `SELECT id, product_name, product_brand, product_current_stock, product_min_stock
         FROM products
        WHERE product_current_stock <= product_min_stock
        ORDER BY product_current_stock - product_min_stock, product_name
        LIMIT ?`,
      [LOW_STOCK_LIST_SIZE],
    ),
    pool.query(
      `SELECT s.id, s.sales_total, s.sales_date, u.user_name
         FROM sales s JOIN users u ON u.id = s.user_id
        ORDER BY s.sales_date DESC, s.id
        LIMIT ?`,
      [LIST_SIZE],
    ),
    pool.query(
      `SELECT p.id, p.product_name,
              SUM(d.detail_quantity) AS quantity,
              SUM(d.detail_subtotal) AS revenue
         FROM sales_detail d
         JOIN sales s ON s.id = d.sales_id
         JOIN products p ON p.id = d.product_id
        WHERE s.sales_date >= CURDATE() - INTERVAL 29 DAY
        GROUP BY p.id, p.product_name
        ORDER BY quantity DESC, p.product_name
        LIMIT ?`,
      [LIST_SIZE],
    ),
    pool.query(
      `SELECT a.id, a.adj_type, a.adj_previous_amount, a.adj_new_amount, a.adj_date,
              p.product_name, u.user_name
         FROM inventory_adjustments a
         JOIN products p ON p.id = a.product_id
         JOIN users u ON u.id = a.user_id
        ORDER BY a.adj_date DESC, a.id
        LIMIT ?`,
      [LIST_SIZE],
    ),
  ]);

  res.json({
    users,
    products,
    sales: { today: salesToday, last_30_days: salesLast30Days },
    low_stock_products: lowStockProducts,
    recent_sales: recentSales,
    top_products: topProducts,
    recent_adjustments: recentAdjustments,
  });
});
