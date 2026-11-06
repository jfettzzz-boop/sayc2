import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertController, IonBadge, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonImg, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToggle, IonToolbar } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { addOutline, createOutline, pricetagOutline, refreshOutline, searchOutline, trashOutline } from 'ionicons/icons';
import { Subject, Subscription, debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { InventoryService } from '../inventory/inventory.service';
import { Product, ProductDraft, PRODUCTS_PAGE_SIZE, ProductsService } from './products.service';

interface Editor {
  product: Product | null;
}

/** Adjustment types offered to the user; stored verbatim in adj_type. */
const ADJUSTMENT_TYPES = ['entrada', 'salida', 'conteo'] as const;

function errorKeyFor(err: HttpErrorResponse): string {
  const code = err.error?.error?.code;
  if (code === 'BARCODE_ALREADY_REGISTERED') return 'errors.BARCODE_ALREADY_REGISTERED';
  if (code === 'RESOURCE_IN_USE') return 'errors.PRODUCT_IN_USE';
  if (err.status === 400) return 'products.invalid_data';
  return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
}

@Component({
  selector: 'app-products',
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
  imports: [DecimalPipe, ReactiveFormsModule, IonBadge, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonImg, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToggle, IonToolbar, TranslatePipe],
})
export class ProductsPage implements OnInit, OnDestroy {
  private readonly productsService = inject(ProductsService);
  private readonly inventoryService = inject(InventoryService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);

  protected readonly products = signal<Product[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isLoadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadErrorKey = signal<string | null>(null);
  protected readonly actionErrorKey = signal<string | null>(null);

  protected readonly lowStockOnly = signal(false);
  protected searchTerm = '';

  protected readonly editor = signal<Editor | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly adjustTarget = signal<Product | null>(null);
  protected readonly isAdjusting = signal(false);
  protected readonly adjustErrorKey = signal<string | null>(null);

  protected readonly adjustmentTypes = ADJUSTMENT_TYPES;

  protected readonly form = new FormGroup({
    product_barcode: new FormControl('', { nonNullable: true }),
    product_name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    product_brand: new FormControl('', { nonNullable: true }),
    product_description: new FormControl('', { nonNullable: true }),
    product_sell_price: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0)] }),
    product_costs: new FormControl<number | null>(0, { validators: [Validators.min(0)] }),
    product_min_stock: new FormControl<number | null>(0, { validators: [Validators.min(0)] }),
    product_current_stock: new FormControl<number | null>(0, { validators: [Validators.min(0)] }),
    product_img_url: new FormControl('', { nonNullable: true }),
  });

  protected readonly adjustForm = new FormGroup({
    adj_new_amount: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0)] }),
    adj_type: new FormControl<string>('entrada', { nonNullable: true, validators: [Validators.required] }),
    adj_motive: new FormControl('', { nonNullable: true }),
  });

  private readonly searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;
  private loadSubscription?: Subscription;

  constructor() {
    addIcons({
      'add-outline': addOutline,
      'create-outline': createOutline,
      'pricetag-outline': pricetagOutline,
      'refresh-outline': refreshOutline,
      'search-outline': searchOutline,
      'trash-outline': trashOutline,
    });
  }

  protected get isAdmin(): boolean {
    return this.auth.user()?.role_name === 'Administrador';
  }

  protected isLowStock(product: Product): boolean {
    return product.product_current_stock <= product.product_min_stock;
  }

  // Ionic keeps pages alive, so reload on every entry. Also picks up a draft
  // left by the Open Food Facts search page.
  ionViewWillEnter() {
    if (!this.auth.user() && this.auth.isAuthenticated()) {
      this.auth.loadUser().subscribe({ error: () => undefined });
    }
    this.load();
    this.consumeDraft();
  }

  ngOnInit() {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
    ).subscribe((term) => {
      this.searchTerm = term;
      this.load();
    });
  }

  ngOnDestroy() {
    this.searchSubscription?.unsubscribe();
    this.loadSubscription?.unsubscribe();
  }

  protected onSearch(event: Event) {
    const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
    this.searchSubject.next(value);
  }

  protected toggleLowStock() {
    this.lowStockOnly.update((value) => !value);
    this.load();
  }

  protected load() {
    this.loadSubscription?.unsubscribe();
    this.isLoading.set(true);
    this.loadErrorKey.set(null);
    this.actionErrorKey.set(null);

    this.loadSubscription = this.productsService
      .list(this.searchTerm, this.lowStockOnly(), 0)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (products) => {
          this.products.set(products);
          this.hasMore.set(products.length === PRODUCTS_PAGE_SIZE);
        },
        error: (err: HttpErrorResponse) => {
          this.products.set([]);
          this.hasMore.set(false);
          this.loadErrorKey.set(
            err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN',
          );
        },
      });
  }

  protected loadMore() {
    this.isLoadingMore.set(true);
    this.actionErrorKey.set(null);
    this.productsService
      .list(this.searchTerm, this.lowStockOnly(), this.products().length)
      .pipe(finalize(() => this.isLoadingMore.set(false)))
      .subscribe({
        next: (products) => {
          this.products.update((current) => [...current, ...products]);
          this.hasMore.set(products.length === PRODUCTS_PAGE_SIZE);
        },
        error: () => this.actionErrorKey.set('products.load_error'),
      });
  }

  protected openEditor(product: Product | null, draft?: ProductDraft | null) {
    this.form.reset({
      product_barcode: product?.product_barcode ?? draft?.product_barcode ?? '',
      product_name: product?.product_name ?? draft?.product_name ?? '',
      product_brand: product?.product_brand ?? draft?.product_brand ?? '',
      product_description: product?.product_description ?? draft?.product_description ?? '',
      product_sell_price: product?.product_sell_price ?? null,
      product_costs: product?.product_costs ?? 0,
      product_min_stock: product?.product_min_stock ?? 0,
      product_current_stock: product?.product_current_stock ?? 0,
      product_img_url: product?.product_img_url ?? draft?.product_img_url ?? '',
    });
    this.saveErrorKey.set(null);
    this.editor.set({ product });
  }

  protected closeEditor() {
    this.editor.set(null);
    this.form.reset();
  }

  protected save() {
    const editor = this.editor();
    if (!editor || this.isSaving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const payload = {
      product_barcode: value.product_barcode || null,
      product_name: value.product_name,
      product_brand: value.product_brand || null,
      product_description: value.product_description || null,
      product_sell_price: Number(value.product_sell_price),
      product_costs: Number(value.product_costs ?? 0),
      product_min_stock: Number(value.product_min_stock ?? 0),
      product_img_url: value.product_img_url || null,
      ...(editor.product ? {} : { product_current_stock: Number(value.product_current_stock ?? 0) }),
    };

    const request = editor.product
      ? this.productsService.update(editor.product.id, payload)
      : this.productsService.create(payload);

    this.isSaving.set(true);
    this.saveErrorKey.set(null);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (saved) => {
        this.replaceOrAdd(saved);
        this.closeEditor();
      },
      error: (err: HttpErrorResponse) => this.saveErrorKey.set(errorKeyFor(err)),
    });
  }

  protected openAdjust(product: Product) {
    this.adjustForm.reset({
      adj_new_amount: product.product_current_stock,
      adj_type: 'entrada',
      adj_motive: '',
    });
    this.adjustErrorKey.set(null);
    this.adjustTarget.set(product);
  }

  protected closeAdjust() {
    this.adjustTarget.set(null);
    this.adjustForm.reset();
  }

  protected saveAdjustment() {
    const product = this.adjustTarget();
    if (!product || this.isAdjusting() || this.adjustForm.invalid) {
      this.adjustForm.markAllAsTouched();
      return;
    }

    const { adj_new_amount, adj_type, adj_motive } = this.adjustForm.getRawValue();
    this.isAdjusting.set(true);
    this.adjustErrorKey.set(null);
    this.inventoryService
      .create({
        product_id: product.id,
        adj_type,
        adj_new_amount: Number(adj_new_amount),
        adj_motive: adj_motive || null,
      })
      .pipe(finalize(() => this.isAdjusting.set(false)))
      .subscribe({
        next: (adjustment) => {
          this.products.update((list) =>
            list.map((p) =>
              p.id === product.id ? { ...p, product_current_stock: adjustment.adj_new_amount } : p,
            ),
          );
          this.closeAdjust();
        },
        error: (err: HttpErrorResponse) =>
          this.adjustErrorKey.set(
            err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN',
          ),
      });
  }

  protected async confirmDelete(product: Product) {
    const t = (key: string) => this.translate.instant(key) as string;
    const alert = await this.alerts.create({
      header: t('products.delete'),
      message: `${t('products.confirm_delete')} (${product.product_name})`,
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('products.delete'), role: 'destructive', handler: () => this.remove(product) },
      ],
    });
    await alert.present();
  }

  private remove(product: Product) {
    this.actionErrorKey.set(null);
    this.productsService.remove(product.id).subscribe({
      next: () => this.products.update((list) => list.filter((p) => p.id !== product.id)),
      error: (err: HttpErrorResponse) => this.actionErrorKey.set(errorKeyFor(err)),
    });
  }

  private consumeDraft() {
    const draft = this.productsService.draft();
    if (!draft) return;
    this.productsService.draft.set(null);
    this.openEditor(null, draft);
  }

  private replaceOrAdd(saved: Product) {
    this.products.update((list) =>
      list.some((p) => p.id === saved.id)
        ? list.map((p) => (p.id === saved.id ? saved : p))
        : [...list, saved].sort((a, b) => a.product_name.localeCompare(b.product_name)),
    );
  }
}
