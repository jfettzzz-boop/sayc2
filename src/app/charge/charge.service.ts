import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Product {
  id: string;
  product_barcode: string | null;
  product_name: string;
  product_brand: string | null;
  product_sell_price: number;
  product_current_stock: number;
}

export interface SaleItem {
  product_id: string;
  quantity: number;
}

export interface Sale {
  id: string;
  sales_total: number;
  sales_received_pay: number;
  sales_change: number;
  sales_date: string;
}

@Injectable({ providedIn: 'root' })
export class ChargeService {
  private readonly http = inject(HttpClient);

  search(q: string): Observable<Product[]> {
    return this.http.get<Product[]>('/api/v1/products', { params: { q, limit: 20 } });
  }

  findByBarcode(barcode: string): Observable<Product> {
    return this.http.get<Product>(`/api/v1/products/barcode/${encodeURIComponent(barcode)}`);
  }

  charge(items: SaleItem[], received_pay: number): Observable<Sale> {
    return this.http.post<Sale>('/api/v1/sales', { items, received_pay });
  }
}
