import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface NewProduct {
  product_name: string;
  product_sell_price: number;
  product_barcode?: string;
  product_brand?: string;
  product_description?: string;
  product_costs?: number;
  product_current_stock?: number;
  product_min_stock?: number;
  product_api_origin?: boolean;
  product_img_url?: string;
}

/** A product as the API returns it. */
export interface InventoryProduct {
  id: string;
  product_name: string;
  product_sell_price: number;
  product_barcode: string | null;
  product_brand: string | null;
  product_description: string | null;
  product_costs: number;
  product_current_stock: number;
  product_min_stock: number;
  product_img_url: string | null;
}

export type ProductSortField = 'name' | 'stock';
export type SortOrder = 'asc' | 'desc';

export interface ProductQuery {
  q: string;
  lowStockOnly: boolean;
  sort: ProductSortField;
  order: SortOrder;
}

/** Stock is left out on purpose: it only changes through sales and adjustments, which keeps its history. */
export interface ProductChanges {
  product_name?: string;
  product_sell_price?: number;
  product_barcode?: string | null;
  product_brand?: string | null;
  product_description?: string | null;
  product_costs?: number;
  product_min_stock?: number;
  product_img_url?: string | null;
}

export interface StockAdjustment {
  id: string;
  adj_type: string;
  adj_previous_amount: number;
  adj_new_amount: number;
  adj_motive: string | null;
  adj_date: string;
  user_name: string;
}

/** What an Open Food Facts result can fill in. It has no price or stock, so those are always asked for. */
export interface ProductDraft {
  name: string;
  barcode: string;
  brand: string;
  description: string;
  imageUrl: string;
}

export const PRODUCTS_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/products';

  list({ q, lowStockOnly, sort, order }: ProductQuery, offset: number): Observable<InventoryProduct[]> {
    return this.http.get<InventoryProduct[]>(this.url, {
      params: {
        limit: PRODUCTS_PAGE_SIZE,
        offset,
        ...(q && { q }),
        ...(lowStockOnly && { low_stock: 'true' }),
        sort,
        order,
      },
    });
  }

  create(product: NewProduct): Observable<InventoryProduct> {
    return this.http.post<InventoryProduct>(this.url, product);
  }

  update(id: string, changes: ProductChanges): Observable<InventoryProduct> {
    return this.http.patch<InventoryProduct>(`${this.url}/${id}`, changes);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  adjustments(productId: string, limit: number): Observable<StockAdjustment[]> {
    return this.http.get<StockAdjustment[]>('/api/v1/inventory/adjustments', {
      params: { product_id: productId, limit },
    });
  }

  /** `change` either sets the exact stock or adds a signed amount to whatever the stock is now. */
  adjustStock(
    productId: string,
    adjType: string,
    change: { adj_new_amount: number } | { adj_quantity: number },
    motive: string | null,
  ): Observable<StockAdjustment> {
    return this.http.post<StockAdjustment>('/api/v1/inventory/adjustments', {
      product_id: productId,
      adj_type: adjType,
      ...change,
      adj_motive: motive,
    });
  }
}
