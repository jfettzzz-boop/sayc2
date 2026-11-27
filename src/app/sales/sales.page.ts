import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertController, IonBadge, IonButton, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonSearchbar, IonSegment, IonSegmentButton, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { addOutline, removeOutline, trashOutline } from 'ionicons/icons';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { Product, ProductsService } from '../products/products.service';
import { Sale, SalesService } from './sales.service';

interface CartLine {
  product: Product;
  quantity: number;
}

const money = (value: number) => Math.round(value * 100) / 100;

function errorKeyFor(err: HttpErrorResponse): string {
  const code = err.error?.error?.code;
  if (code === 'INSUFFICIENT_PAYMENT') return 'pos.insufficient_payment';
  if (code === 'INSUFFICIENT_STOCK') return 'pos.insufficient_stock';
  if (code === 'PRODUCT_NOT_FOUND') return 'pos.product_not_found';
  if (err.status === 400) return 'pos.invalid_data';
  return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
}

@Component({
  selector: 'app-sales',
  templateUrl: './sales.page.html',
  styleUrls: ['./sales.page.scss'],
  imports: [DatePipe, DecimalPipe, ReactiveFormsModule, IonBadge, IonButton, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonSearchbar, IonSegment, IonSegmentButton, IonSpinner, IonText, IonTitle, IonToolbar, TranslatePipe],
})
export class SalesPage implements OnInit, OnDestroy {
  private readonly productsService = inject(ProductsService);
  private readonly salesService = inject(SalesService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);

  protected tab: 'sell' | 'history' = 'sell';

  // --- Point of sale ---
  protected readonly cart = signal<CartLine[]>([]);
  protected readonly results = signal<Product[]>([]);
  protected readonly isSearching = signal(false);
  protected readonly isCharging = signal(false);
  protected readonly chargeErrorKey = signal<string | null>(null);
  protected searchTerm = '';
  protected readonly receivedControl = new FormControl<number | null>(null);

  // --- History ---
  protected readonly sales = signal<Sale[]>([]);
  protected readonly isLoadingSales = signal(false);
  protected readonly salesErrorKey = signal<string | null>(null);
  protected readonly saleDetail = signal<Sale | null>(null);

  private readonly searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;
  private salesSubscription?: Subscription;
  private historyLoaded = false;

  constructor() {
    addIcons({
      'add-outline': addOutline,
      'remove-outline': removeOutline,
      'trash-outline': trashOutline,
    });
  }

  ngOnInit() {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
    ).subscribe((term) => {
      this.searchTerm = term.trim();
      if (!this.searchTerm) {
        this.results.set([]);
        this.isSearching.set(false);
        return;
      }
      this.isSearching.set(true);
      this.productsService.list(this.searchTerm, false, 0)
        .pipe(finalize(() => this.isSearching.set(false)))
        .subscribe({
          next: (products) => this.results.set(products.slice(0, 8)),
          error: () => this.results.set([]),
        });
    });
  }

  ngOnDestroy() {
    this.searchSubscription?.unsubscribe();
    this.salesSubscription?.unsubscribe();
  }

  ionViewWillEnter() {
    if (this.tab === 'history' && !this.historyLoaded) this.loadSales();
  }

  protected get total(): number {
    return money(this.cart().reduce((sum, line) => sum + line.product.product_sell_price * line.quantity, 0));
  }

  protected get change(): number {
    const received = Number(this.receivedControl.value ?? 0);
    return money(Math.max(0, received - this.total));
  }

  protected get canCharge(): boolean {
    return this.cart().length > 0 && !this.isCharging() && Number(this.receivedControl.value ?? 0) >= this.total;
  }

  protected setTab(tab: 'sell' | 'history') {
    this.tab = tab;
    if (tab === 'history' && !this.historyLoaded) this.loadSales();
  }

  protected onSearch(event: Event) {
    const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
    this.searchSubject.next(value);
  }

  protected addToCart(product: Product) {
    if (product.product_current_stock <= 0) return;
    this.cart.update((cart) => {
      const existing = cart.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.product_current_stock) return cart;
        return cart.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...cart, { product, quantity: 1 }];
    });
    this.results.set([]);
    this.searchTerm = '';
  }

  protected changeQuantity(line: CartLine, delta: number) {
    this.cart.update((cart) =>
      cart
        .map((item) => {
          if (item.product.id !== line.product.id) return item;
          const quantity = item.quantity + delta;
          return quantity > 0 ? { ...item, quantity: Math.min(quantity, item.product.product_current_stock) } : item;
        })
        .filter((item) => item.quantity > 0),
    );
  }

  protected removeLine(productId: string) {
    this.cart.update((cart) => cart.filter((line) => line.product.id !== productId));
  }

  protected clearCart() {
    this.cart.set([]);
    this.receivedControl.setValue(null);
    this.chargeErrorKey.set(null);
  }

  protected charge() {
    if (!this.canCharge) return;
    this.isCharging.set(true);
    this.chargeErrorKey.set(null);

    this.salesService.create({
      items: this.cart().map((line) => ({ product_id: line.product.id, quantity: line.quantity })),
      received_pay: Number(this.receivedControl.value),
    }).pipe(finalize(() => this.isCharging.set(false))).subscribe({
      next: async (sale) => {
        this.clearCart();
        this.historyLoaded = false;
        const t = (key: string) => this.translate.instant(key) as string;
        const alert = await this.alerts.create({
          header: t('pos.sale_completed'),
          message: `${t('pos.total')}: $${sale.sales_total.toFixed(2)} — ${t('pos.change')}: $${sale.sales_change.toFixed(2)}`,
          buttons: [t('common.accept')],
        });
        await alert.present();
      },
      error: (err: HttpErrorResponse) => {
        this.chargeErrorKey.set(errorKeyFor(err));
        // Stock may have changed since the product was added; refresh results quietly.
        if (err.error?.error?.code === 'INSUFFICIENT_STOCK') this.results.set([]);
      },
    });
  }

  protected loadSales() {
    this.salesSubscription?.unsubscribe();
    this.isLoadingSales.set(true);
    this.salesErrorKey.set(null);
    this.salesSubscription = this.salesService.list(0)
      .pipe(finalize(() => this.isLoadingSales.set(false)))
      .subscribe({
        next: (sales) => {
          this.sales.set(sales);
          this.historyLoaded = true;
        },
        error: (err: HttpErrorResponse) =>
          this.salesErrorKey.set(err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN'),
      });
  }

  protected openSale(sale: Sale) {
    this.salesService.get(sale.id).subscribe({
      next: (detail) => this.saleDetail.set(detail),
      error: () => this.salesErrorKey.set('errors.TRY_AGAIN'),
    });
  }

  protected closeSaleDetail() {
    this.saleDetail.set(null);
  }
}
