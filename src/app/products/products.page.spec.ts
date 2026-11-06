import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { ProductsService } from './products.service';
import { ProductsPage } from './products.page';

const PRODUCT = {
  id: 'p1', product_barcode: '750', product_name: 'Coca', product_brand: 'Coca Cola',
  product_description: null, product_sell_price: 18, product_costs: 12,
  product_current_stock: 25, product_min_stock: 5, product_api_origin: false,
  product_img_url: null, product_created_at: '', product_updated_at: '',
};

describe('ProductsPage', () => {
  let page: any;
  let productsService: ProductsService;
  let http: HttpTestingController;

  const listUrl = '/api/v1/products?limit=50&offset=0';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ProductsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    productsService = TestBed.inject(ProductsService);
    page = TestBed.createComponent(ProductsPage).componentInstance;
  });

  afterEach(() => http.verify());

  it('loads the first page of products on entry', () => {
    page.ionViewWillEnter();
    http.expectOne(listUrl).flush([PRODUCT]);
    expect(page.products()).toEqual([PRODUCT]);
    expect(page.hasMore()).toBe(false);
  });

  it('opens the create form prefilled from an external draft', () => {
    productsService.draft.set({
      product_barcode: '123',
      product_name: 'OFF product',
      product_brand: 'Brand',
      product_description: '500g',
      product_img_url: 'https://img',
    });

    page.ionViewWillEnter();
    http.expectOne(listUrl).flush([]);

    expect(productsService.draft()).toBeNull();
    expect(page.editor()).not.toBeNull();
    expect(page.form.controls.product_name.value).toBe('OFF product');
    expect(page.form.controls.product_barcode.value).toBe('123');
  });
});
