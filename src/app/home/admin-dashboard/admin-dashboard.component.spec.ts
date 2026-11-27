import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { DashboardData } from './dashboard.service';

const DATA: DashboardData = {
  users: { total: 3, active: 2 },
  products: { total: 4, low_stock: 1, out_of_stock: 1, inventory_cost: 450.5 },
  sales: { today: { count: 2, total: 71.5 }, last_30_days: { count: 9, total: 1234.5 } },
  low_stock_products: [
    { id: 'p', product_name: 'Leche', product_brand: 'Lala', product_current_stock: 0, product_min_stock: 3 },
  ],
  recent_sales: [{ id: 's', sales_total: 53.5, sales_date: '2026-11-03T10:00:00Z', user_name: 'Empleado 1' }],
  top_products: [{ id: 'p2', product_name: 'Coca', quantity: 7, revenue: 126 }],
  recent_adjustments: [],
};

describe('AdminDashboardComponent', () => {
  let http: HttpTestingController;

  function render() {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [AdminDashboardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService(), provideIonicAngular()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the figures from the API', () => {
    const fixture = render();
    http.expectOne('/api/v1/dashboard').flush(DATA);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const tile = (name: string) => el.querySelector(`[data-tile=${name}] .tile-value`)!.textContent!.trim();
    expect(tile('sales-today')).toBe('$71.50');
    expect(tile('sales-30')).toBe('$1,234.50');
    expect(tile('users')).toBe('2');
    expect(tile('products')).toBe('4');
    expect(tile('low-stock')).toBe('1');
    expect(el.querySelector('[data-panel=low-stock]')!.textContent).toContain('Leche');
    expect(el.querySelector('[data-panel=recent-sales]')!.textContent).toContain('Empleado 1');
    expect(el.querySelector('[data-panel=top-products]')!.textContent).toContain('Coca');
  });

  it('keeps showing the last figures with an error when a refresh fails', () => {
    const fixture = render();
    http.expectOne('/api/v1/dashboard').flush(DATA);
    (fixture.componentInstance as any).load();
    http.expectOne('/api/v1/dashboard').flush(null, { status: 500, statusText: 'x' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.dashboard-error')).not.toBeNull();
    expect(el.querySelector('.tiles')).not.toBeNull();
  });
});
