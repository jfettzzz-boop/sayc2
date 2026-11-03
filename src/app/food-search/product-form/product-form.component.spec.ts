import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { ProductFormComponent } from './product-form.component';

const URL = '/api/v1/products';

describe('ProductFormComponent', () => {
  let fixture: ComponentFixture<ProductFormComponent>;
  let form: any;
  let http: HttpTestingController;

  const instance = () => fixture.componentInstance as any;
  const fill = (values: Record<string, unknown>) => form.patchValue(values);

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [ProductFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService(), provideIonicAngular()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProductFormComponent);
    fixture.detectChanges();
    form = instance().form;
  });

  afterEach(() => http.verify());

  it('needs only a name and a price, and leaves out blank fields', () => {
    fill({ product_name: '  Galletas  ', product_sell_price: '12.50' });
    instance().save();

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ product_name: 'Galletas', product_sell_price: 12.5 });
    req.flush({ id: 'p', product_name: 'Galletas', product_sell_price: 12.5 });
  });

  it('sends the optional fields as the right types, whether inputs report strings or numbers', () => {
    fill({
      product_name: 'Galletas',
      product_sell_price: 12.5,
      product_barcode: ' 123 ',
      product_brand: 'Gamesa',
      product_description: 'Paquete',
      product_costs: '8',
      product_current_stock: 10,
      product_min_stock: '0',
    });
    instance().save();

    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({
      product_name: 'Galletas',
      product_sell_price: 12.5,
      product_barcode: '123',
      product_brand: 'Gamesa',
      product_description: 'Paquete',
      product_costs: 8,
      product_current_stock: 10,
      product_min_stock: 0,
    });
    req.flush({ id: 'p' });
  });

  it.each([
    [{ product_name: '', product_sell_price: '10' }],
    [{ product_name: '   ', product_sell_price: '10' }],
    [{ product_name: 'x', product_sell_price: '' }],
    [{ product_name: 'x', product_sell_price: null }],
    [{ product_name: 'x', product_sell_price: '0' }],
    [{ product_name: 'x', product_sell_price: '-1' }],
    [{ product_name: 'x', product_sell_price: '1.234' }],
    [{ product_name: 'x', product_sell_price: '100000000' }],
    [{ product_name: 'x', product_sell_price: '1', product_costs: '-1' }],
    [{ product_name: 'x', product_sell_price: '1', product_current_stock: '1.5' }],
    [{ product_name: 'x', product_sell_price: '1', product_min_stock: '-1' }],
    [{ product_name: 'x', product_sell_price: '1', product_current_stock: '9999999999' }],
  ])('does not send %j', (values) => {
    fill(values);
    instance().save();
    http.expectNone(URL);
    expect(form.touched).toBe(true);
  });

  it('marks a draft as coming from Open Food Facts and sends its image', () => {
    fixture.componentRef.setInput('draft', {
      name: 'Nutella', barcode: '301', brand: 'Ferrero', description: '400 g', imageUrl: 'https://img/x.jpg',
    });
    fixture.detectChanges();
    expect(form.controls.product_name.value).toBe('Nutella');
    expect(form.controls.product_sell_price.value).toBe('');

    form.controls.product_sell_price.setValue('95.5');
    instance().save();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({
      product_name: 'Nutella',
      product_sell_price: 95.5,
      product_barcode: '301',
      product_brand: 'Ferrero',
      product_description: '400 g',
      product_api_origin: true,
      product_img_url: 'https://img/x.jpg',
    });
    req.flush({ id: 'p' });
  });

  describe('editing', () => {
    const PRODUCT = {
      id: 'p1',
      product_name: 'Coca',
      product_sell_price: 18,
      product_barcode: '750',
      product_brand: 'Coca Cola',
      product_description: null,
      product_costs: 12,
      product_current_stock: 25,
      product_min_stock: 5,
    };

    beforeEach(() => {
      fixture.componentRef.setInput('product', PRODUCT);
      fixture.detectChanges();
    });

    it('starts from the product, including a cost of 0', () => {
      expect(form.controls.product_name.value).toBe('Coca');
      expect(form.controls.product_sell_price.value).toBe(18);
      fixture.componentRef.setInput('product', { ...PRODUCT, product_costs: 0 });
      fixture.detectChanges();
      expect(form.controls.product_costs.value).toBe(0);
    });

    it('sends only what changed, by PATCH', () => {
      form.patchValue({ product_sell_price: '19.50', product_brand: 'Otra' });
      instance().save();
      const req = http.expectOne(`${URL}/p1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ product_sell_price: 19.5, product_brand: 'Otra' });
      req.flush({ ...PRODUCT, product_sell_price: 19.5 });
    });

    it('clears blank text fields but keeps a blank cost and minimum', () => {
      form.patchValue({ product_barcode: '', product_brand: ' ', product_costs: '', product_min_stock: '' });
      instance().save();
      const req = http.expectOne(`${URL}/p1`);
      expect(req.request.body).toEqual({ product_barcode: null, product_brand: null });
      req.flush(PRODUCT);
    });

    it('never sends stock', () => {
      form.patchValue({ product_name: 'Otro', product_current_stock: '99' });
      instance().save();
      const req = http.expectOne(`${URL}/p1`);
      expect(req.request.body).toEqual({ product_name: 'Otro' });
      req.flush(PRODUCT);
    });

    it('closes without a request when nothing changed', () => {
      const cancelled = vi.fn();
      fixture.componentInstance.cancelled.subscribe(cancelled);
      instance().save();
      http.expectNone(`${URL}/p1`);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('explains a barcode that belongs to another product', () => {
      form.patchValue({ product_barcode: '999' });
      instance().save();
      http.expectOne(`${URL}/p1`).flush(
        { error: { code: 'BARCODE_ALREADY_REGISTERED' } },
        { status: 409, statusText: 'x' },
      );
      expect(instance().errorKey()).toBe('products_page.barcode_taken');
    });
  });

  it('asks for the price rather than submitting a draft without one', () => {
    fixture.componentRef.setInput('draft', { name: 'Nutella', barcode: '', brand: '', description: '', imageUrl: '' });
    fixture.detectChanges();
    instance().save();
    http.expectNone(URL);
    expect(instance().priceErrorKey).toBe('products_page.price_required');
  });

  it('announces a saved product once and clears the form', () => {
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    fill({ product_name: 'x', product_sell_price: '1' });
    instance().save();
    instance().save();
    http.expectOne(URL).flush({ id: 'p' });

    expect(saved).toHaveBeenCalledTimes(1);
    expect(form.controls.product_name.value).toBeFalsy();
    expect(instance().isSaving()).toBe(false);
  });

  it.each([
    [409, 'BARCODE_ALREADY_REGISTERED', 'products_page.barcode_taken'],
    [400, 'VALIDATION_ERROR', 'admin.invalid_data'],
    [500, 'INTERNAL_ERROR', 'errors.SERVER_NOT_REACHED'],
    [418, 'OTHER', 'errors.TRY_AGAIN'],
  ])('keeps what was typed and explains a %i', (status, code, key) => {
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    fill({ product_name: 'x', product_sell_price: '1' });
    instance().save();
    http.expectOne(URL).flush({ error: { code } }, { status, statusText: 'x' });

    expect(instance().errorKey()).toBe(key);
    expect(form.controls.product_name.value).toBe('x');
    expect(saved).not.toHaveBeenCalled();
  });
});
