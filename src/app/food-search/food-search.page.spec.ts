import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { FoodSearchPage, draftFromOpenFoodFacts } from './food-search.page';

const OFF_PRODUCT = {
  code: '3017620422003',
  product_name: 'Nutella',
  brands: 'Ferrero, Nutella',
  quantity: '400 g',
  image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
};

describe('draftFromOpenFoodFacts', () => {
  it('maps a full result, using the first brand', () => {
    expect(draftFromOpenFoodFacts(OFF_PRODUCT)).toEqual({
      name: 'Nutella',
      barcode: '3017620422003',
      brand: 'Ferrero',
      description: '400 g',
      imageUrl: 'https://images.openfoodfacts.org/x.jpg',
    });
  });

  it('copes with the fields Open Food Facts often leaves out', () => {
    expect(draftFromOpenFoodFacts({})).toEqual({ name: '', barcode: '', brand: '', description: '', imageUrl: '' });
    expect(draftFromOpenFoodFacts({ _id: '123' }).barcode).toBe('123');
  });

  it('leaves out what would not fit the table or is not a web image', () => {
    const draft = draftFromOpenFoodFacts({
      product_name: 'x'.repeat(151),
      code: '1'.repeat(101),
      brands: 'b'.repeat(101),
      image_front_small_url: `https://x/${'y'.repeat(250)}`,
    });
    expect(draft).toEqual({ name: '', barcode: '', brand: '', description: '', imageUrl: '' });
    expect(draftFromOpenFoodFacts({ image_front_small_url: 'javascript:alert(1)' }).imageUrl).toBe('');
  });
});

describe('FoodSearchPage', () => {
  let fixture: ComponentFixture<FoodSearchPage>;
  let page: any;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [FoodSearchPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService(), provideIonicAngular()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FoodSearchPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('starts on search', () => {
    expect(page.mode()).toBe('search');
  });

  it('adding a result opens the form prefilled', () => {
    page.addToInventory(OFF_PRODUCT);
    expect(page.mode()).toBe('add');
    expect(page.draft().name).toBe('Nutella');
  });

  it('returns to the results after saving a result, and does not offer it again', () => {
    page.addToInventory(OFF_PRODUCT);
    expect(page.isSaved(OFF_PRODUCT)).toBe(false);

    page.onSaved({ id: 'p', product_name: 'Nutella', product_sell_price: 95, product_barcode: OFF_PRODUCT.code });
    expect(page.mode()).toBe('search');
    expect(page.draft()).toBeNull();
    expect(page.savedName()).toBe('Nutella');
    expect(page.isSaved(OFF_PRODUCT)).toBe(true);
  });

  it('stays on the form after a manual product, ready for the next', () => {
    page.addManually();
    page.onSaved({ id: 'p', product_name: 'Galletas', product_sell_price: 10 });
    expect(page.mode()).toBe('add');
    expect(page.savedName()).toBe('Galletas');
  });

  it('a product with no barcode is never treated as already saved', () => {
    page.onSaved({ id: 'p', product_name: 'Galletas', product_sell_price: 10 });
    expect(page.isSaved({ product_name: 'Otro' })).toBe(false);
  });

  it('cancelling returns to the results and drops the draft', () => {
    page.addToInventory(OFF_PRODUCT);
    page.onCancelled();
    expect(page.mode()).toBe('search');
    expect(page.draft()).toBeNull();
  });

  it('adding by hand after cancelling a draft does not reuse it', () => {
    page.addToInventory(OFF_PRODUCT);
    page.addManually();
    expect(page.draft()).toBeNull();
  });

  it('reports a failed search as an error rather than as no results', async () => {
    vi.useFakeTimers();
    try {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      http.expectOne((r) => r.url.startsWith('/api/cgi/search.pl')).flush(null, { status: 503, statusText: 'x' });
      expect(page.hasError).toBe(true);
      expect(page.isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('searches Open Food Facts without an Authorization header or a forbidden User-Agent', async () => {
    vi.useFakeTimers();
    try {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      const req = http.expectOne((r) => r.url.startsWith('/api/cgi/search.pl'));
      expect(req.request.headers.has('User-Agent')).toBe(false);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({ products: [OFF_PRODUCT] });
      expect(page.products.length).toBe(1);
      expect(page.hasError).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
