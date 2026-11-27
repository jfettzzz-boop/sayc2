import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { AuthService, AuthUser } from '../auth/auth.service';
import { InventoryPage } from './inventory.page';

const product = (id: string, stock = 10, min = 5) => ({
  id,
  product_name: `Product ${id}`,
  product_sell_price: 18,
  product_barcode: null,
  product_brand: null,
  product_description: null,
  product_costs: 12,
  product_current_stock: stock,
  product_min_stock: min,
});

const listUrl = (offset: number, sort = 'name', order = 'asc') =>
  `/api/v1/products?limit=50&offset=${offset}&sort=${sort}&order=${order}`;

describe('InventoryPage', () => {
  let fixture: ComponentFixture<InventoryPage>;
  let page: any;
  let http: HttpTestingController;

  const rendered = (selector: string) => fixture.nativeElement.querySelectorAll(selector).length;

  function setup(role: string) {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [InventoryPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    TestBed.inject(AuthService).currentUser.set({ id: 'u', role_name: role } as AuthUser);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InventoryPage);
    page = fixture.componentInstance;
    page.ionViewWillEnter();
  }

  afterEach(() => http.verify());

  it('lists products on entry', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush([product('a'), product('b')]);
    expect(page.products().length).toBe(2);
    expect(page.hasMore()).toBe(false);
    expect(page.isLoading()).toBe(false);
  });

  it.each(['Empleado', 'Administrador'])('offers every action to %s', (role) => {
    setup(role);
    http.expectOne(listUrl(0)).flush([product('a')]);
    fixture.detectChanges();
    expect(rendered('.adjust-stock')).toBe(1);
    expect(rendered('.edit-product')).toBe(1);
    expect(rendered('.delete-product')).toBe(1);
  });

  describe('sorting', () => {
    beforeEach(() => {
      setup('Empleado');
      http.expectOne(listUrl(0)).flush([]);
    });

    it.each([
      ['inventory.sort_name_desc', 'name', 'desc'],
      ['inventory.sort_stock_asc', 'stock', 'asc'],
      ['inventory.sort_stock_desc', 'stock', 'desc'],
    ])('the select applies %s on the server', (labelKey, sort, order) => {
      page.onSortSelected(labelKey);
      http.expectOne(listUrl(0, sort, order)).flush([]);
    });

    it('does not reload when the select reports the sort already in use', () => {
      page.onSortSelected('inventory.sort_name_asc');
      http.expectNone(listUrl(0));
    });

    it('a header flips its own column and starts ascending on another', () => {
      page.toggleSort('name');
      http.expectOne(listUrl(0, 'name', 'desc')).flush([]);
      expect(page.ariaSort('name')).toBe('descending');
      expect(page.ariaSort('stock')).toBe('none');

      page.toggleSort('stock');
      http.expectOne(listUrl(0, 'stock', 'asc')).flush([]);
      expect(page.ariaSort('stock')).toBe('ascending');
      expect(page.sortIcon('stock')).toBe('arrow-up-outline');
      expect(page.sortIcon('name')).toBe('swap-vertical-outline');

      page.toggleSort('stock');
      http.expectOne(listUrl(0, 'stock', 'desc')).flush([]);
      expect(page.sortIcon('stock')).toBe('arrow-down-outline');
    });

    it('later pages keep the sort', () => {
      page.onSortSelected('inventory.sort_stock_desc');
      http.expectOne(listUrl(0, 'stock', 'desc')).flush(Array.from({ length: 50 }, (_, i) => product(`p${i}`)));
      page.loadMore();
      http.expectOne(listUrl(50, 'stock', 'desc')).flush([]);
    });

    it('the search keeps the sort', () => {
      page.onSortSelected('inventory.sort_stock_asc');
      http.expectOne(listUrl(0, 'stock', 'asc')).flush([]);
      page.searchTerm.set('coca');
      page.load();
      const req = http.expectOne((r) => r.url === '/api/v1/products');
      expect(req.request.params.get('sort')).toBe('stock');
      expect(req.request.params.get('q')).toBe('coca');
      req.flush([]);
    });
  });

  describe('pictures', () => {
    const withImage = { ...product('a'), product_img_url: 'https://img/a.jpg' };
    const noImage = { ...product('b'), product_img_url: null };

    beforeEach(() => {
      setup('Empleado');
      http.expectOne(listUrl(0)).flush([withImage, noImage]);
      fixture.detectChanges();
    });

    it('shows the picture, and a placeholder when there is none', () => {
      const image = fixture.nativeElement.querySelector('.product-image');
      expect(image.getAttribute('src')).toBe('https://img/a.jpg');
      expect(image.getAttribute('alt')).toBe('Product a');
      expect(rendered('.image-placeholder')).toBe(1);
    });

    it('falls back to the placeholder when a picture fails to load', () => {
      fixture.nativeElement.querySelector('.product-image').dispatchEvent(new Event('error'));
      fixture.detectChanges();
      expect(rendered('.product-image')).toBe(0);
      expect(rendered('.image-placeholder')).toBe(2);
    });

    it('tries again when the picture changes', () => {
      page.onImageError('https://img/a.jpg');
      expect(page.showImage(withImage)).toBe(false);
      expect(page.showImage({ ...withImage, product_img_url: 'https://img/new.jpg' })).toBe(true);
    });
  });

  it('filters by low stock, keeping the search', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush([]);
    page.searchTerm.set(' coca ');
    page.onLowStockChange(true);
    const req = http.expectOne((r) => r.url === '/api/v1/products');
    expect(req.request.params.get('q')).toBe('coca');
    expect(req.request.params.get('low_stock')).toBe('true');
    req.flush([]);
  });

  it('debounces the search', () => {
    vi.useFakeTimers();
    try {
      setup('Empleado');
      http.expectOne(listUrl(0)).flush([]);
      page.onSearchInput('c');
      page.onSearchInput('co');
      vi.advanceTimersByTime(300);
      const req = http.expectOne((r) => r.url === '/api/v1/products');
      expect(req.request.params.get('q')).toBe('co');
      req.flush([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues from what is loaded, keeping the filters', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush(Array.from({ length: 50 }, (_, i) => product(`p${i}`)));
    expect(page.hasMore()).toBe(true);

    page.onLowStockChange(false);
    http.expectOne(listUrl(0)).flush(Array.from({ length: 50 }, (_, i) => product(`p${i}`)));
    page.loadMore();
    http.expectOne(listUrl(50)).flush([product('last')]);
    expect(page.products().length).toBe(51);
    expect(page.hasMore()).toBe(false);
  });

  it('a newer load replaces one still in flight', () => {
    setup('Empleado');
    const stale = http.expectOne(listUrl(0));
    page.load();
    expect(stale.cancelled).toBe(true);
    http.expectOne(listUrl(0)).flush([product('fresh')]);
    expect(page.products()[0].id).toBe('fresh');
  });

  it('offers a retry when the list fails', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush(null, { status: 500, statusText: 'x' });
    fixture.detectChanges();
    expect(page.loadFailed()).toBe(true);
    expect(rendered('.load-error')).toBe(1);
  });

  it('recognizes low stock at the minimum, like the API', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush([]);
    expect(page.isLow(product('a', 5, 5))).toBe(true);
    expect(page.isLow(product('a', 6, 5))).toBe(false);
  });

  it('updates the row in place after an edit', () => {
    setup('Administrador');
    http.expectOne(listUrl(0)).flush([product('a'), product('b')]);
    page.editor.set({ product: product('a') });
    page.onProductSaved({ ...product('a'), product_name: 'Renamed' });
    expect(page.products()[0].product_name).toBe('Renamed');
    expect(page.editor()).toBeNull();
  });

  it('reloads after creating, since the list is sorted and filtered', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush([]);
    page.editor.set({ product: null });
    page.onProductSaved(product('new'));
    http.expectOne(listUrl(0)).flush([product('new')]);
    expect(page.products().length).toBe(1);
  });

  it('updates the stock in place after an adjustment', () => {
    setup('Empleado');
    http.expectOne(listUrl(0)).flush([product('a', 10)]);
    page.adjusting.set(page.products()[0]);
    page.onStockAdjusted(3);
    expect(page.products()[0].product_current_stock).toBe(3);
    expect(page.adjusting()).toBeNull();
  });

  it('removes a deleted row', () => {
    setup('Administrador');
    http.expectOne(listUrl(0)).flush([product('a'), product('b')]);
    page.delete(product('a'));
    const req = http.expectOne('/api/v1/products/a');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(page.products().map((p: any) => p.id)).toEqual(['b']);
  });

  it('removes a row someone else already deleted', () => {
    setup('Administrador');
    http.expectOne(listUrl(0)).flush([product('a')]);
    page.delete(product('a'));
    http.expectOne('/api/v1/products/a').flush(null, { status: 404, statusText: 'x' });
    expect(page.products()).toEqual([]);
    expect(page.actionErrorKey()).toBeNull();
  });

  it('keeps a product with history and explains why', () => {
    setup('Administrador');
    http.expectOne(listUrl(0)).flush([product('a')]);
    page.delete(product('a'));
    http.expectOne('/api/v1/products/a').flush(
      { error: { code: 'RESOURCE_IN_USE' } },
      { status: 409, statusText: 'x' },
    );
    expect(page.products().length).toBe(1);
    expect(page.actionErrorKey()).toBe('inventory.delete_in_use');
  });
});
