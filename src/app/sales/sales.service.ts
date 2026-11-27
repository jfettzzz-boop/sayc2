import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface SaleItem {
  id: string;
  product_id: string;
  product_name: string;
  product_barcode: string | null;
  detail_quantity: number;
  detail_unit_price: number;
  detail_subtotal: number;
}

export interface Sale {
  id: string;
  user_id: string;
  user_name: string;
  sales_total: number;
  sales_received_pay: number;
  sales_change: number;
  sales_date: string;
  items?: SaleItem[];
}

export interface SaleInput {
  items: { product_id: string; quantity: number }[];
  received_pay: number;
}

export const SALES_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class SalesService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/sales';

  list(offset: number): Observable<Sale[]> {
    const params = new HttpParams().set('limit', SALES_PAGE_SIZE).set('offset', offset);
    return this.http.get<Sale[]>(this.url, { params });
  }

  get(id: string): Observable<Sale> {
    return this.http.get<Sale>(`${this.url}/${id}`);
  }

  create(sale: SaleInput): Observable<Sale> {
    return this.http.post<Sale>(this.url, sale);
  }
}
