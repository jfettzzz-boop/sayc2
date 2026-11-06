import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Adjustment {
  id: string;
  product_id: string;
  product_name: string;
  user_id: string;
  user_name: string;
  adj_type: string;
  adj_previous_amount: number;
  adj_new_amount: number;
  adj_motive: string | null;
  adj_date: string;
}

export interface AdjustmentInput {
  product_id: string;
  adj_type: string;
  adj_new_amount: number;
  adj_motive?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/inventory/adjustments';

  list(productId?: string): Observable<Adjustment[]> {
    return this.http.get<Adjustment[]>(this.url, {
      params: productId ? { product_id: productId } : {},
    });
  }

  create(adjustment: AdjustmentInput): Observable<Adjustment> {
    return this.http.post<Adjustment>(this.url, adjustment);
  }
}
