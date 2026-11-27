import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonMenuButton, IonSearchbar, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { addOutline, checkmarkCircleOutline, removeOutline, trashOutline } from 'ionicons/icons';
import { EMPTY, Subject, of } from 'rxjs';
import { catchError, debounceTime, finalize, switchMap } from 'rxjs/operators';

import { ChargeService, Product, Sale } from './charge.service';

interface CartLine {
  product: Product;
  quantity: number;
}

/** Stock the API reported as short: product id to units available. */
interface ShortStock {
  product_id: string;
  available: number;
}

const MAX_PAYMENT_CENTS = 9999999999;

const toCents = (amount: number) => Math.round(amount * 100);

/** Parses a typed payment. Null unless it is a valid amount with at most two decimals. */
function parseCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = toCents(Number(trimmed));
  return cents <= MAX_PAYMENT_CENTS ? cents : null;
}

@Component({
  selector: 'app-charge',
  templateUrl: './charge.page.html',
  styleUrls: ['./charge.page.scss'],
  imports: [DecimalPipe, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonMenuButton, IonSearchbar, IonSpinner, IonText, IonTitle, IonToolbar, TranslatePipe],
})
export class ChargePage {
  private readonly charges = inject(ChargeService);
  private readonly searches = new Subject<string>();

  protected readonly searchTerm = signal('');
  protected readonly results = signal<Product[]>([]);
  protected readonly isSearching = signal(false);
  protected readonly hasSearched = signal(false);
  protected readonly searchFailed = signal(false);

  protected readonly cart = signal<CartLine[]>([]);
  protected readonly receivedText = signal('');
  protected readonly isCharging = signal(false);
  protected readonly lastSale = signal<Sale | null>(null);
  protected readonly errorKey = signal<string | null>(null);
  /** Names the products behind errorKey, when there are any. */
  protected readonly errorDetail = signal('');

  // Prices are for display: the API charges the prices in the database.
  protected readonly totalCents = computed(() =>
    this.cart().reduce((sum, line) => sum + toCents(line.product.product_sell_price) * line.quantity, 0),
  );
  protected readonly receivedCents = computed(() => parseCents(this.receivedText()));
  protected readonly changeCents = computed(() => {
    const received = this.receivedCents();
    return received === null ? null : received - this.totalCents();
  });
  protected readonly canCharge = computed(() => {
    const change = this.changeCents();
    return this.cart().length > 0 && change !== null && change >= 0 && !this.isCharging();
  });

  constructor() {
    addIcons({
      'add-outline': addOutline,
      'checkmark-circle-outline': checkmarkCircleOutline,
      'remove-outline': removeOutline,
      'trash-outline': trashOutline,
    });

    this.searches.pipe(
      debounceTime(300),
      switchMap((term) => {
        this.searchFailed.set(false);
        if (!term) {
          this.results.set([]);
          this.hasSearched.set(false);
          this.isSearching.set(false);
          return EMPTY;
        }
        this.isSearching.set(true);
        return this.charges.search(term).pipe(
          catchError(() => {
            this.searchFailed.set(true);
            return of([]);
          }),
          finalize(() => this.isSearching.set(false)),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe((results) => {
      this.results.set(results);
      this.hasSearched.set(true);
    });
  }

  protected onSearchInput(value: string | null | undefined) {
    this.setSearchTerm(value ?? '');
  }

  /** A barcode scanner types the code and presses Enter, which adds that product directly. */
  protected onSearchEnter() {
    const code = this.searchTerm().trim();
    if (!code) return;
    this.charges.findByBarcode(code).subscribe({
      next: (product) => {
        this.addToCart(product);
        this.setSearchTerm('');
      },
      // Not a barcode: the search results for what was typed are still showing.
      error: () => undefined,
    });
  }

  /** Units of a product that can still be added to the sale. */
  protected remaining(product: Product): number {
    const line = this.cart().find((l) => l.product.id === product.id);
    return product.product_current_stock - (line?.quantity ?? 0);
  }

  protected addToCart(product: Product) {
    this.clearMessages();
    if (this.remaining(product) <= 0) {
      this.errorKey.set('charge.out_of_stock');
      this.errorDetail.set(product.product_name);
      return;
    }
    this.cart.update((lines) =>
      lines.some((l) => l.product.id === product.id)
        ? lines.map((l) => (l.product.id === product.id ? { product, quantity: l.quantity + 1 } : l))
        : [...lines, { product, quantity: 1 }],
    );
  }

  protected decrease(line: CartLine) {
    this.clearMessages();
    if (line.quantity <= 1) {
      this.remove(line);
      return;
    }
    this.cart.update((lines) =>
      lines.map((l) => (l.product.id === line.product.id ? { ...l, quantity: l.quantity - 1 } : l)),
    );
  }

  protected remove(line: CartLine) {
    this.clearMessages();
    this.cart.update((lines) => lines.filter((l) => l.product.id !== line.product.id));
  }

  protected charge() {
    const received = this.receivedCents();
    if (!this.canCharge() || received === null) return;

    this.isCharging.set(true);
    this.clearMessages();
    const items = this.cart().map((l) => ({ product_id: l.product.id, quantity: l.quantity }));

    this.charges.charge(items, received / 100).pipe(
      finalize(() => this.isCharging.set(false)),
    ).subscribe({
      next: (sale) => {
        this.lastSale.set(sale);
        this.cart.set([]);
        this.receivedText.set('');
        this.setSearchTerm('');
        // Results on screen carry stock from before this sale.
        this.results.set([]);
      },
      error: (err: HttpErrorResponse) => this.handleChargeError(err),
    });
  }

  private handleChargeError(err: HttpErrorResponse) {
    const error = err.error?.error;
    switch (error?.code) {
      case 'INSUFFICIENT_STOCK':
        this.errorKey.set('charge.insufficient_stock');
        this.applyShortStock(error.details?.products ?? []);
        break;
      case 'INSUFFICIENT_PAYMENT':
        this.errorKey.set('charge.insufficient_payment');
        break;
      case 'PRODUCT_NOT_FOUND':
        this.errorKey.set('charge.product_missing');
        break;
      default:
        this.errorKey.set(err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN');
    }
  }

  /** Someone else sold this stock first: cut the sale down to what is left and say so. */
  private applyShortStock(short: (ShortStock & { product_name: string })[]) {
    this.errorDetail.set(short.map((p) => `${p.product_name} (${p.available})`).join(', '));
    this.cart.update((lines) =>
      lines.flatMap((line) => {
        const entry = short.find((p) => p.product_id === line.product.id);
        if (!entry) return [line];
        if (entry.available <= 0) return [];
        return [{
          product: { ...line.product, product_current_stock: entry.available },
          quantity: Math.min(line.quantity, entry.available),
        }];
      }),
    );
  }

  private setSearchTerm(term: string) {
    this.searchTerm.set(term);
    this.searches.next(term.trim());
  }

  private clearMessages() {
    this.errorKey.set(null);
    this.errorDetail.set('');
    this.lastSale.set(null);
  }
}
