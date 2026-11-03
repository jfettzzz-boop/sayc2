import { Component, OnInit, OnDestroy, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner, IonIcon, IonButton, IonButtons, IonMenuButton, IonSegment, IonSegmentButton, IonText } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize, catchError } from 'rxjs/operators';

// Multilanguage
import { TranslatePipe } from '@ngx-translate/core';
// Multilanguage end

import { ProductFormComponent } from './product-form/product-form.component';
import { InventoryProduct, ProductDraft } from './products.service';

type Mode = 'search' | 'add';

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
    brand: fits(String(product.brands ?? '').split(',')[0], 100),
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

  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {
    addIcons({ 'add-outline': addOutline, 'checkmark-circle-outline': checkmarkCircleOutline });
  }

  ngOnInit() {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(800),
      distinctUntilChanged(),
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

        // The dev proxy sets the User-Agent that Open Food Facts asks for; browsers refuse to.
        const url = `/api/cgi/search.pl?search_terms=${encodeURIComponent(trimmedQuery)}&search_simple=1&action=process&json=1&page_size=20`;

        return this.http.get<any>(url).pipe(
          catchError((err) => {
            console.error('Servidor ocupado (503) ', err);
            this.hasError = true;
            return of({ products: [], failed: true });
          }),
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
