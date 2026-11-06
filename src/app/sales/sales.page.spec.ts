import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { SalesPage } from './sales.page';

const PRODUCT = {
  id: 'p1', product_barcode: '750', product_name: 'Coca', product_brand: 'Coca Cola',
  product_description: null, product_sell_price: 18, product_costs: 12,
  product_current_stock: 25, product_min_stock: 5, product_api_origin: false,
  product_img_url: null, product_created_at: '', product_updated_at: '',
};

describe('SalesPage', () => {
  let page: any;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [SalesPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    page = TestBed.createComponent(SalesPage).componentInstance;
  });

  afterEach(() => http.verify());

  it('adds a product to the cart and computes the total', () => {
    page.addToCart(PRODUCT);
    page.addToCart(PRODUCT);
    expect(page.cart().length).toBe(1);
    expect(page.cart()[0].quantity).toBe(2);
    expect(page.total).toBe(36);
  });

  it('registers a sale and clears the cart', async () => {
    page.addToCart(PRODUCT);
    page.receivedControl.setValue(50);
    expect(page.canCharge).toBe(true);

    page.charge();
    const req = http.expectOne('/api/v1/sales');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      items: [{ product_id: 'p1', quantity: 1 }],
      received_pay: 50,
    });
    req.flush({
      id: 's1', user_id: 'u1', user_name: 'Admin', sales_total: 18,
      sales_received_pay: 50, sales_change: 32, sales_date: '', items: [],
    });

    await Promise.resolve();
    expect(page.cart()).toEqual([]);
  });
});
