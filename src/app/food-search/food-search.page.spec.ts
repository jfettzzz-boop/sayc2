import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { FoodSearchPage, SEARCH_INTERVAL_MS, SEARCH_URL, draftFromOpenFoodFacts, legacySearchUrl, normalizeProduct, retryAfterMs } from './food-search.page';

const isSearch = (r: any) => r.url.startsWith(SEARCH_URL);
const isLegacy = (r: any) => r.url.startsWith('/api/cgi/search.pl');
/** Both searches failing, as a search counts as failed only then. */
const failBoth = (http: HttpTestingController, status = 503, headers: Record<string, string> = {}) => {
  http.expectOne(isSearch).flush(null, { status, statusText: 'x', headers });
  http.expectOne(isLegacy).flush(null, { status, statusText: 'x', headers });
};

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

describe('normalizeProduct', () => {
  it('turns the search service brand list into text, without language prefixes', () => {
    expect(normalizeProduct({ code: '1', brands: ['xx:El Corte Ingles', 'Hacendado'] }).brands).toBe('El Corte Ingles, Hacendado');
    expect(normalizeProduct({ _id: '2', brands: 'Ferrero, Nutella' })).toEqual({ _id: '2', code: '2', brands: 'Ferrero, Nutella' });
    expect(draftFromOpenFoodFacts(normalizeProduct({ brands: ['xx:coca'] })).brand).toBe('coca');
  });

  it('calls search.pl directly from the installed app and through the proxy in a browser', () => {
    expect(legacySearchUrl(true)).toBe('https://world.openfoodfacts.org/cgi/search.pl');
    expect(legacySearchUrl(false)).toBe('/api/cgi/search.pl');
  });
});

describe('retryAfterMs', () => {
  const withHeader = (value: string) =>
    new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': value }) });

  it('reads seconds or a date, and caps the wait', () => {
    expect(retryAfterMs(withHeader('12'))).toBe(12000);
    expect(retryAfterMs(withHeader(new Date(10000).toUTCString()), 0)).toBe(10000);
    expect(retryAfterMs(withHeader('3600'))).toBe(60000);
  });

  it('is 0 with no usable header', () => {
    expect(retryAfterMs(new HttpErrorResponse({ status: 503 }))).toBe(0);
    expect(retryAfterMs(withHeader('soon'))).toBe(0);
    expect(retryAfterMs(new Error('x'))).toBe(0);
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
      failBoth(http);
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
      const req = http.expectOne(isSearch);
      expect(req.request.url).toContain('q=nutella');
      expect(req.request.headers.has('User-Agent')).toBe(false);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({ hits: [{ ...OFF_PRODUCT, brands: ['Ferrero', 'Nutella'] }] });
      http.expectNone(isLegacy);
      expect(page.products).toEqual([OFF_PRODUCT]);
      expect(page.hasError).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to search.pl when the search service fails', async () => {
    vi.useFakeTimers();
    try {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      http.expectOne(isSearch).flush(null, { status: 503, statusText: 'x' });
      const legacy = http.expectOne(isLegacy);
      expect(legacy.request.headers.has('Authorization')).toBe(false);
      legacy.flush({ products: [OFF_PRODUCT] });
      expect(page.products).toEqual([OFF_PRODUCT]);
      expect(page.hasError).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('spacing and retrying searches', () => {
    const search = isSearch;

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      fixture.destroy();
      vi.useRealTimers();
    });

    it('holds a search sent too soon after another until the interval is over', () => {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      http.expectOne(search).flush({ hits: [OFF_PRODUCT] });

      page.onSearchChange({ detail: { value: 'leche' } });
      vi.advanceTimersByTime(800);
      expect(page.isLoading).toBe(true);
      expect(page.waitSeconds()).toBeGreaterThan(0);
      http.expectNone(search);

      vi.advanceTimersByTime(SEARCH_INTERVAL_MS - 800);
      http.expectOne((r) => search(r) && r.url.includes('leche')).flush({ hits: [] });
      expect(page.isLoading).toBe(false);
    });

    it('retries the same search once the wait is over, not before', () => {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      failBoth(http);
      expect(page.hasError).toBe(true);

      page.retry();
      vi.advanceTimersByTime(0);
      http.expectNone(search);

      vi.advanceTimersByTime(SEARCH_INTERVAL_MS);
      expect(page.waitSeconds()).toBe(0);
      page.retry();
      http.expectOne((r) => search(r) && r.url.includes('nutella')).flush({ hits: [OFF_PRODUCT] });
      expect(page.hasError).toBe(false);
      expect(page.products.length).toBe(1);
    });

    it('waits as long as the server asks when it is busy', () => {
      page.onSearchChange({ detail: { value: 'nutella' } });
      vi.advanceTimersByTime(800);
      http.expectOne(search).flush(null, { status: 429, statusText: 'x', headers: { 'Retry-After': '20' } });
      http.expectOne(isLegacy).flush(null, { status: 503, statusText: 'x' });

      vi.advanceTimersByTime(SEARCH_INTERVAL_MS);
      expect(page.waitSeconds()).toBeGreaterThan(10);
      vi.advanceTimersByTime(20000);
      expect(page.waitSeconds()).toBe(0);
    });
  });
});
