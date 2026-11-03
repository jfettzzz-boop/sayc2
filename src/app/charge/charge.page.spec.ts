import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { ChargePage } from './charge.page';
import { Product } from './charge.service';

const product = (id: string, price: number, stock: number): Product => ({
  id,
  product_barcode: `code-${id}`,
  product_name: `Product ${id}`,
  product_brand: null,
  product_sell_price: price,
  product_current_stock: stock,
});

describe('ChargePage', () => {
  let page: any;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ChargePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    page = TestBed.createComponent(ChargePage).componentInstance;
  });

  afterEach(() => http.verify());

  it('totals in cents, without floating point drift', () => {
    const p = product('a', 0.1, 10);
    page.addToCart(p);
    page.addToCart(p);
    page.addToCart(p);
    page.addToCart(product('b', 0.2, 10));
    expect(page.totalCents()).toBe(50);
  });

  it('never adds more than the stock', () => {
    const p = product('a', 1, 2);
    page.addToCart(p);
    page.addToCart(p);
    expect(page.remaining(p)).toBe(0);
    page.addToCart(p);
    expect(page.cart()[0].quantity).toBe(2);
    expect(page.errorKey()).toBe('charge.out_of_stock');
  });

  it('removes a line when decreased from one', () => {
    page.addToCart(product('a', 1, 2));
    page.addToCart(product('a', 1, 2));
    page.decrease(page.cart()[0]);
    expect(page.cart()[0].quantity).toBe(1);
    page.decrease(page.cart()[0]);
    expect(page.cart()).toEqual([]);
  });

  it.each([
    ['', null, false],
    ['abc', null, false],
    ['-5', null, false],
    ['1.234', null, false],
    ['99999999999', null, false],
    ['17.99', -1, false],
    ['18', 0, true],
    ['18.5', 50, true],
    ['100', 8200, true],
  ])('with a total of 18, a payment of "%s" gives change %s', (text, change, allowed) => {
    page.addToCart(product('a', 18, 5));
    page.receivedText.set(text);
    expect(page.changeCents()).toBe(change);
    expect(page.canCharge()).toBe(allowed);
  });

  it('cannot charge an empty sale', () => {
    page.receivedText.set('100');
    expect(page.canCharge()).toBe(false);
    page.charge();
    http.expectNone('/api/v1/sales');
  });

  it('sends only ids, quantities and payment, then clears the sale and shows the receipt', () => {
    page.addToCart(product('a', 18, 5));
    page.addToCart(product('a', 18, 5));
    page.receivedText.set('50');
    page.charge();
    page.charge();

    const req = http.expectOne('/api/v1/sales');
    expect(req.request.body).toEqual({ items: [{ product_id: 'a', quantity: 2 }], received_pay: 50 });
    req.flush({ id: 's', sales_total: 36, sales_received_pay: 50, sales_change: 14, sales_date: '' });

    expect(page.cart()).toEqual([]);
    expect(page.receivedText()).toBe('');
    expect(page.lastSale().sales_change).toBe(14);
    expect(page.isCharging()).toBe(false);
  });

  it('cuts the sale down to the stock left when another sale got there first', () => {
    page.addToCart(product('a', 18, 5));
    page.addToCart(product('a', 18, 5));
    page.addToCart(product('a', 18, 5));
    page.addToCart(product('b', 10, 5));
    page.addToCart(product('c', 10, 5));
    page.receivedText.set('500');
    page.charge();

    http.expectOne('/api/v1/sales').flush(
      {
        error: {
          code: 'INSUFFICIENT_STOCK',
          details: {
            products: [
              { product_id: 'a', product_name: 'Product a', available: 1, requested: 3 },
              { product_id: 'b', product_name: 'Product b', available: 0, requested: 1 },
            ],
          },
        },
      },
      { status: 409, statusText: 'x' },
    );

    expect(page.errorKey()).toBe('charge.insufficient_stock');
    expect(page.errorDetail()).toBe('Product a (1), Product b (0)');
    expect(page.cart().map((l: any) => [l.product.id, l.quantity])).toEqual([['a', 1], ['c', 1]]);
    expect(page.receivedText()).toBe('500');
  });

  it.each([
    [422, 'INSUFFICIENT_PAYMENT', 'charge.insufficient_payment'],
    [404, 'PRODUCT_NOT_FOUND', 'charge.product_missing'],
    [500, 'INTERNAL_ERROR', 'errors.SERVER_NOT_REACHED'],
    [418, 'OTHER', 'errors.TRY_AGAIN'],
  ])('keeps the sale and explains a %i', (status, code, key) => {
    page.addToCart(product('a', 18, 5));
    page.receivedText.set('50');
    page.charge();
    http.expectOne('/api/v1/sales').flush({ error: { code } }, { status, statusText: 'x' });
    expect(page.errorKey()).toBe(key);
    expect(page.cart().length).toBe(1);
  });

  it('adds a scanned barcode directly and clears the search', () => {
    page.onSearchInput('7501001112223');
    page.onSearchEnter();
    http.expectOne('/api/v1/products/barcode/7501001112223').flush(product('a', 18, 5));
    expect(page.cart().length).toBe(1);
    expect(page.searchTerm()).toBe('');
  });

  it('leaves the search alone when Enter is not a barcode', () => {
    page.onSearchInput('coca');
    page.onSearchEnter();
    http.expectOne('/api/v1/products/barcode/coca').flush(null, { status: 404, statusText: 'x' });
    expect(page.cart()).toEqual([]);
    expect(page.searchTerm()).toBe('coca');
  });

  it('debounces searching, keeping only the last term', async () => {
    vi.useFakeTimers();
    try {
      page.onSearchInput('c');
      page.onSearchInput('co');
      vi.advanceTimersByTime(300);
      const req = http.expectOne((r) => r.url === '/api/v1/products');
      expect(req.request.params.get('q')).toBe('co');
      req.flush([product('a', 18, 5)]);
      expect(page.results().length).toBe(1);
      expect(page.isSearching()).toBe(false);

      page.onSearchInput('');
      vi.advanceTimersByTime(300);
      expect(page.results()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
