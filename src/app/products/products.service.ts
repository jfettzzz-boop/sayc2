import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

export interface Product {
  id: string;
  product_barcode: string | null;
  product_name: string;
  product_brand: string | null;
  product_description: string | null;
  product_sell_price: number;
  product_costs: number;
  product_current_stock: number;
  product_min_stock: number;
  product_api_origin: boolean;
  product_img_url: string | null;
  product_created_at: string;
  product_updated_at: string;
}

export interface ProductInput {
  product_barcode?: string | null;
  product_name: string;
  product_brand?: string | null;
  product_description?: string | null;
  product_sell_price: number;
  product_costs?: number;
  product_current_stock?: number;
  product_min_stock?: number;
  product_api_origin?: boolean;
  product_img_url?: string | null;
}

export type ProductChanges = Partial<ProductInput>;

export const PRODUCTS_PAGE_SIZE = 50;

/** Fields of an Open Food Facts hit that map onto a new product. */
export interface ProductDraft {
  product_barcode: string;
  product_name: string;
  product_brand: string;
  product_description: string;
  product_img_url: string;
}

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/products';

  /** Product prefilled from an external search, consumed by the products page. */
  readonly draft = signal<ProductDraft | null>(null);

  list(query: string, lowStock: boolean, offset: number): Observable<Product[]> {
    let params = new HttpParams().set('limit', PRODUCTS_PAGE_SIZE).set('offset', offset);
    if (query.trim()) params = params.set('q', query.trim());
    if (lowStock) params = params.set('low_stock', 'true');
    return this.http.get<Product[]>(this.url, { params });
  }

  byBarcode(barcode: string): Observable<Product> {
    return this.http.get<Product>(`${this.url}/barcode/${encodeURIComponent(barcode)}`);
  }

  get(id: string): Observable<Product> {
    return this.http.get<Product>(`${this.url}/${id}`);
  }

  create(product: ProductInput): Observable<Product> {
    return this.http.post<Product>(this.url, product);
  }

  update(id: string, changes: ProductChanges): Observable<Product> {
    return this.http.patch<Product>(`${this.url}/${id}`, changes);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
