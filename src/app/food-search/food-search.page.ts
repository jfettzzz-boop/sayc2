import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner, IonIcon, IonButton, IonButtons, IonMenuButton, IonSegment, IonSegmentButton, IonText } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, checkmarkCircleOutline, refreshOutline } from 'ionicons/icons';
import { Observable, Subject, Subscription, defer, merge, of, throwError, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize, catchError, map } from 'rxjs/operators';

// Multilanguage
import { TranslatePipe } from '@ngx-translate/core';
// Multilanguage end

import { ProductFormComponent } from './product-form/product-form.component';
import { InventoryProduct, ProductDraft } from './products.service';

type Mode = 'search' | 'add';

/** Open Food Facts allows about 10 searches a minute per client; spacing them keeps under that. */
export const SEARCH_INTERVAL_MS = 6000;
/** Longest wait honoured from a Retry-After header, so a bad value can't lock the search. */
const MAX_RETRY_AFTER_MS = 60000;

/**
 * Wait before the retry button works again, counted from when the search failed: the search
 * interval, doubled for each failure in a row (6 s, 12 s, 24 s...), up to a minute.
 */
export function retryCooldownMs(failures: number): number {
  return Math.min(SEARCH_INTERVAL_MS * 2 ** Math.max(failures - 1, 0), MAX_RETRY_AFTER_MS);
}

/** How long the server asked us to wait, from a Retry-After header in seconds or as a date. */
export function retryAfterMs(err: unknown, now = Date.now()): number {
  if (!(err instanceof HttpErrorResponse)) return 0;
  const header = err.headers?.get('Retry-After');
  if (!header) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : 0;
}

/**
 * Open Food Facts' search service. It answers quickly and allows calls from the browser, while the
 * older search.pl is often too busy to answer (503), so it is only used when this one fails.
 */
export const SEARCH_URL = 'https://search.openfoodfacts.org/search';
const SEARCH_FIELDS = 'code,product_name,brands,quantity,image_front_small_url';

/** The older search. In a browser the dev proxy calls it, with the User-Agent it asks for. */
export function legacySearchUrl(native = Capacitor.isNativePlatform()): string {
  return `${native ? 'https://world.openfoodfacts.org' : '/api'}/cgi/search.pl`;
}

/** Brands come as a list from the search service ("xx:" marks a name in no set language) and as text from search.pl. */
function brandText(brands: unknown): string {
  const list = Array.isArray(brands) ? brands : String(brands ?? '').split(',');
  return list.map((brand) => String(brand).trim().replace(/^[a-z]{2}:/, '')).filter(Boolean).join(', ');
}

/** Gives a result from either search the same shape. */
export function normalizeProduct(product: any): any {
  return { ...product, code: product.code || product._id, brands: brandText(product.brands) };
}

/** Keeps what fits the products table. Anything too long is left for the user to type. */
export function draftFromOpenFoodFacts(product: any): ProductDraft {
  const fits = (value: unknown, max: number) => {
    const text = String(value ?? '').trim();
    return text.length <= max ? text : '';
  };
  const image = fits(product.image_front_small_url, 255);

  return {
    name: fits(product.product_name, 150),
    barcode: fits(product.code || product._id, 100),
    // Open Food Facts lists every brand name, comma-separated, most relevant first.
    brand: fits(brandText(product.brands).split(',')[0], 100),
    description: fits(product.quantity, 5000),
    imageUrl: /^https?:\/\//.test(image) ? image : '',
  };
}

@Component({
  selector: 'app-food-search',
  templateUrl: './food-search.page.html',
  styleUrls: ['./food-search.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonSearchbar,
    IonList,
    IonItem,
    IonThumbnail,
    IonLabel,
    IonNote,
    IonSpinner,
    IonIcon,
    IonButton,
    IonButtons,
    IonMenuButton,
    IonSegment,
    IonSegmentButton,
    IonText,
    ProductFormComponent,
    TranslatePipe
  ]
})
export class FoodSearchPage implements OnInit, OnDestroy {
  searchTerm: string = '';
  products: any[] = [];
  isLoading: boolean = false;
  hasSearched: boolean = false;
  hasError: boolean = false;

  protected readonly mode = signal<Mode>('search');
  protected readonly draft = signal<ProductDraft | null>(null);
  /** Name of the product just registered, shown as confirmation. */
  protected readonly savedName = signal<string | null>(null);
  /** Barcodes registered from this page, so a result isn't offered twice. */
  protected readonly savedBarcodes = signal<ReadonlySet<string>>(new Set());

  /** Seconds left before another search may be sent; 0 when one can go now. */
  protected readonly waitSeconds = signal(0);

  private searchSubject = new Subject<string>();
  private retrySubject = new Subject<string>();
  private searchSubscription!: Subscription;
  /** When the next search may be sent, as a Date.now() time. */
  private nextAllowedAt = 0;
  /** Searches that failed in a row; each one lengthens the retry cooldown. */
  private failures = 0;
  private ticker?: ReturnType<typeof setInterval>;

  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({ 'add-outline': addOutline, 'checkmark-circle-outline': checkmarkCircleOutline, 'refresh-outline': refreshOutline });
  }

  ngOnInit() {
    // A retry resends the same words, so it skips the check that drops repeated searches.
    const typed = this.searchSubject.pipe(debounceTime(800), distinctUntilChanged());
    this.searchSubscription = merge(typed, this.retrySubject).pipe(
      switchMap((query) => {
        const trimmedQuery = (query || '').trim();

        if (!trimmedQuery) {
          this.products = [];
          this.hasSearched = false;
          this.hasError = false;
          this.isLoading = false;
          this.cdr.detectChanges();
          return of({ products: [] });
        }

        this.isLoading = true;
        this.hasSearched = true;
        this.hasError = false;
        this.cdr.detectChanges();

        const request = defer(() => {
          this.nextAllowedAt = Date.now() + SEARCH_INTERVAL_MS;
          this.startTicker();
          return this.searchOpenFoodFacts(trimmedQuery);
        }).pipe(
          map((response) => {
            this.failures = 0;
            return response;
          }),
          catchError((err) => {
            console.error('Open Food Facts search failed', err);
            // Counted from now: a slow failure must not use up the wait before the error shows.
            // A busy server (429/503) may also say how long to back off; wait at least that long.
            this.failures++;
            const cooldown = Math.max(retryCooldownMs(this.failures), retryAfterMs(err));
            this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + cooldown);
            this.startTicker();
            this.hasError = true;
            return of({ products: [], failed: true });
          })
        );

        // Searches closer together than the interval wait their turn instead of being sent.
        const wait = this.nextAllowedAt - Date.now();
        return (wait > 0 ? timer(wait).pipe(switchMap(() => request)) : request).pipe(
          finalize(() => {
            this.isLoading = false;
            this.cdr.detectChanges();
          })
        );
      })
    ).subscribe({
      next: (response: any) => {
        if (response && response.products) {
          this.products = response.products;
          this.hasError = Boolean(response.failed);
        } else {
          this.products = [];
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al conectar con Open Food Facts:', err);
        this.products = [];
        this.hasError = true;
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy() {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    this.stopTicker();
  }

  /** Asks the search service, then search.pl if that fails; errors only when both do. */
  private searchOpenFoodFacts(query: string): Observable<{ products: any[] }> {
    const terms = encodeURIComponent(query);
    const primary = this.http
      .get<any>(`${SEARCH_URL}?q=${terms}&page_size=20&fields=${SEARCH_FIELDS}`)
      .pipe(map((response) => response?.hits ?? []));
    const fallback = () =>
      this.http
        .get<any>(`${legacySearchUrl()}?search_terms=${terms}&search_simple=1&action=process&json=1&page_size=20`)
        .pipe(map((response) => response?.products ?? []));

    return primary.pipe(
      catchError((first) =>
        fallback().pipe(
          // Report the error asking for the longer wait, so neither server is pressed again too soon.
          catchError((second) => throwError(() => (retryAfterMs(first) > retryAfterMs(second) ? first : second)))
        )
      ),
      map((products: any[]) => ({ products: products.map(normalizeProduct) }))
    );
  }

  /** Sends the last search again once the wait between requests is over. */
  protected retry() {
    if (this.waitSeconds() > 0 || !this.searchTerm.trim()) return;
    this.retrySubject.next(this.searchTerm);
  }

  /** Counts down waitSeconds until nextAllowedAt, for the retry button and loading note. */
  private startTicker() {
    const update = () => {
      const seconds = Math.max(0, Math.ceil((this.nextAllowedAt - Date.now()) / 1000));
      this.waitSeconds.set(seconds);
      if (seconds === 0) this.stopTicker();
    };
    if (!this.ticker) this.ticker = setInterval(update, 250);
    update();
  }

  private stopTicker() {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  onSearchChange(event: any) {
    const value = event?.detail?.value !== undefined ? event.detail.value : (event?.target?.value || '');
    this.searchTerm = value;
    this.savedName.set(null);
    this.searchSubject.next(value);
  }

  protected isSaved(product: any): boolean {
    const code = draftFromOpenFoodFacts(product).barcode;
    return code !== '' && this.savedBarcodes().has(code);
  }

  protected onModeChange(value: unknown) {
    if (value !== 'search' && value !== 'add') return;
    this.mode.set(value);
    this.savedName.set(null);
  }

  /** Opens the form with what Open Food Facts knows, to ask for the rest. */
  protected addToInventory(product: any) {
    this.savedName.set(null);
    this.draft.set(draftFromOpenFoodFacts(product));
    this.mode.set('add');
  }

  protected addManually() {
    this.savedName.set(null);
    this.draft.set(null);
    this.mode.set('add');
  }

  protected onSaved(product: InventoryProduct) {
    this.savedName.set(product.product_name);
    const barcode = product.product_barcode;
    if (barcode) this.savedBarcodes.update((codes) => new Set(codes).add(barcode));
    // A product from a search goes back to those results, to add more of them.
    if (this.draft()) this.mode.set('search');
    this.draft.set(null);
  }

  protected onCancelled() {
    this.draft.set(null);
    this.mode.set('search');
  }
}
