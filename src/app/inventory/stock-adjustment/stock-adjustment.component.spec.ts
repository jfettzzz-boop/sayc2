import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { StockAdjustmentComponent } from './stock-adjustment.component';

const PRODUCT = {
  id: 'p1',
  product_name: 'Coca',
  product_sell_price: 18,
  product_barcode: null,
  product_brand: null,
  product_description: null,
  product_costs: 12,
  product_current_stock: 25,
  product_min_stock: 5,
};
const HISTORY_URL = '/api/v1/inventory/adjustments?product_id=p1&limit=5';
const URL = '/api/v1/inventory/adjustments';

describe('StockAdjustmentComponent', () => {
  let fixture: ComponentFixture<StockAdjustmentComponent>;
  let page: any;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [StockAdjustmentComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService(), provideIonicAngular()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StockAdjustmentComponent);
    fixture.componentRef.setInput('product', PRODUCT);
    fixture.detectChanges();
    page = fixture.componentInstance;
    http.expectOne(HISTORY_URL).flush([]);
  });

  afterEach(() => http.verify());

  it('starts on adding or subtracting', () => {
    expect(page.mode()).toBe('change');
    expect(page.form.controls.adj_quantity.enabled).toBe(true);
    expect(page.form.controls.adj_new_amount.enabled).toBe(false);
  });

  describe('adding or subtracting', () => {
    it('builds up the amount from the quick buttons', () => {
      page.applyIncrement(10);
      page.applyIncrement(5);
      expect(page.form.controls.adj_quantity.value).toBe(15);
      expect(page.resultingStock).toBe(40);
      page.applyIncrement(-1);
      expect(page.form.controls.adj_quantity.value).toBe(14);
    });

    it('combines the quick buttons with a typed amount', () => {
      page.form.controls.adj_quantity.setValue('37');
      page.applyIncrement(1);
      expect(page.form.controls.adj_quantity.value).toBe(38);
    });

    it('treats returning to 0 as no amount, rather than an invalid one', () => {
      page.applyIncrement(1);
      page.applyIncrement(-1);
      expect(page.form.controls.adj_quantity.value).toBe('');
      expect(page.resultingStock).toBeNull();
    });

    it.each(['7', 7, '+7', '137', '-3', -3])('sends the typed amount %s', (typed) => {
      page.form.patchValue({ adj_type: 'entrada', adj_quantity: typed });
      page.save();
      const req = http.expectOne(URL);
      expect(req.request.body).toEqual({
        product_id: 'p1',
        adj_type: 'entrada',
        adj_quantity: Number(typed),
        adj_motive: null,
      });
      req.flush({ id: 'a', adj_new_amount: 1 });
    });

    it.each(['', '0', '1.5', '99999999999'])('does not send %j', (typed) => {
      page.form.patchValue({ adj_type: 'entrada', adj_quantity: typed });
      page.save();
      http.expectNone(URL);
    });

    it('needs a type', () => {
      page.applyIncrement(1);
      page.save();
      http.expectNone(URL);
    });

    it('stops a subtraction that exceeds the stock, but allows reaching 0', () => {
      page.form.patchValue({ adj_type: 'salida', adj_quantity: -26 });
      page.save();
      http.expectNone(URL);
      expect(page.errorKey()).toBe('inventory.negative_stock');

      page.form.patchValue({ adj_quantity: -25 });
      page.save();
      http.expectOne(URL).flush({ id: 'a', adj_new_amount: 0 });
    });

    it('announces the stock the API recorded, which may differ after a concurrent sale', () => {
      const adjusted = vi.fn();
      fixture.componentInstance.adjusted.subscribe(adjusted);
      page.form.patchValue({ adj_type: 'entrada', adj_quantity: 5 });
      page.save();
      http.expectOne(URL).flush({ id: 'a', adj_new_amount: 22 });
      expect(adjusted).toHaveBeenCalledExactlyOnceWith(22);
    });

    it('explains when a concurrent sale made the subtraction impossible', () => {
      page.form.patchValue({ adj_type: 'salida', adj_quantity: -20 });
      page.save();
      http.expectOne(URL).flush(
        { error: { code: 'STOCK_WOULD_BE_NEGATIVE' } },
        { status: 409, statusText: 'x' },
      );
      expect(page.errorKey()).toBe('inventory.negative_stock');
    });
  });

  describe('setting an exact amount', () => {
    beforeEach(() => page.onModeChange('set'));

    it('validates only the active field', () => {
      expect(page.form.controls.adj_new_amount.enabled).toBe(true);
      expect(page.form.controls.adj_quantity.enabled).toBe(false);
    });

    it.each([
      [{ adj_type: '', adj_new_amount: '10' }],
      [{ adj_type: 'entrada', adj_new_amount: '' }],
      [{ adj_type: 'entrada', adj_new_amount: '-1' }],
      [{ adj_type: 'entrada', adj_new_amount: '1.5' }],
    ])('does not send %j', (values) => {
      page.form.patchValue(values);
      page.save();
      http.expectNone(URL);
    });

    it('refuses an amount that changes nothing', () => {
      page.form.patchValue({ adj_type: 'entrada', adj_new_amount: 25 });
      page.save();
      http.expectNone(URL);
      expect(page.errorKey()).toBe('inventory.no_change');
    });

    it('sends the amount and the trimmed motive once', () => {
      const adjusted = vi.fn();
      fixture.componentInstance.adjusted.subscribe(adjusted);
      page.form.patchValue({ adj_type: 'merma', adj_new_amount: '20', adj_motive: '  Rotos  ' });
      page.save();
      page.save();

      const req = http.expectOne(URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ product_id: 'p1', adj_type: 'merma', adj_new_amount: 20, adj_motive: 'Rotos' });
      req.flush({ id: 'a', adj_new_amount: 20 });
      expect(adjusted).toHaveBeenCalledExactlyOnceWith(20);
    });

    it('allows setting stock to 0', () => {
      page.form.patchValue({ adj_type: 'correccion', adj_new_amount: 0 });
      page.save();
      const req = http.expectOne(URL);
      expect(req.request.body.adj_new_amount).toBe(0);
      req.flush({ id: 'a', adj_new_amount: 0 });
    });
  });

  it('keeps what was typed when changing mode and back', () => {
    page.form.patchValue({ adj_quantity: 7 });
    page.onModeChange('set');
    page.onModeChange('change');
    expect(page.form.controls.adj_quantity.value).toBe(7);
  });

  it.each([
    [404, 'inventory.product_missing'],
    [400, 'admin.invalid_data'],
    [500, 'errors.SERVER_NOT_REACHED'],
    [418, 'errors.TRY_AGAIN'],
  ])('explains a %i', (status, key) => {
    page.form.patchValue({ adj_type: 'entrada', adj_quantity: 5 });
    page.save();
    http.expectOne(URL).flush(null, { status, statusText: 'x' });
    expect(page.errorKey()).toBe(key);
    expect(page.isSaving()).toBe(false);
  });

  it('labels known types through translation and shows others as stored', () => {
    expect(page.typeLabel('entrada')).toBe('inventory.adj_types.entrada');
    expect(page.typeLabel('importado')).toBe('importado');
  });
});

describe('StockAdjustmentComponent history', () => {
  it('loads the history of the product, and copes when it fails', () => {
    for (const fail of [false, true]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [StockAdjustmentComponent],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService(), provideIonicAngular()],
      });
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(StockAdjustmentComponent);
      fixture.componentRef.setInput('product', PRODUCT);
      fixture.detectChanges();
      const page = fixture.componentInstance as any;
      const req = http.expectOne(HISTORY_URL);
      if (fail) {
        req.flush(null, { status: 500, statusText: 'x' });
        expect(page.historyFailed()).toBe(true);
      } else {
        req.flush([{ id: 'a', adj_type: 'entrada' }]);
        expect(page.history().length).toBe(1);
      }
    }
  });
});
