import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface DashboardData {
  users: { total: number; active: number };
  products: { total: number; low_stock: number; out_of_stock: number; inventory_cost: number };
  sales: {
    today: { count: number; total: number };
    last_30_days: { count: number; total: number };
  };
  low_stock_products: {
    id: string;
    product_name: string;
    product_brand: string | null;
    product_current_stock: number;
    product_min_stock: number;
  }[];
  recent_sales: { id: string; sales_total: number; sales_date: string; user_name: string }[];
  top_products: { id: string; product_name: string; quantity: number; revenue: number }[];
  recent_adjustments: {
    id: string;
    adj_type: string;
    adj_previous_amount: number;
    adj_new_amount: number;
    adj_date: string;
    product_name: string;
    user_name: string;
  }[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  load(): Observable<DashboardData> {
    return this.http.get<DashboardData>('/api/v1/dashboard');
  }
}
