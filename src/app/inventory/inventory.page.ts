import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AlertController, IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonMenuButton, IonModal, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToggle, IonToolbar } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { addOutline, arrowDownOutline, arrowUpOutline, createOutline, imageOutline, layersOutline, swapVerticalOutline, trashOutline } from 'ionicons/icons';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';

import { ProductFormComponent } from '../food-search/product-form/product-form.component';
import { InventoryProduct, PRODUCTS_PAGE_SIZE, ProductQuery, ProductSortField, ProductsService, SortOrder } from '../food-search/products.service';
import { StockAdjustmentComponent } from './stock-adjustment/stock-adjustment.component';

interface SortOption {
  field: ProductSortField;
  order: SortOrder;
  labelKey: string;
}

const SORT_OPTIONS: SortOption[] = [
  { field: 'name', order: 'asc', labelKey: 'inventory.sort_name_asc' },
  { field: 'name', order: 'desc', labelKey: 'inventory.sort_name_desc' },
  { field: 'stock', order: 'asc', labelKey: 'inventory.sort_stock_asc' },
  { field: 'stock', order: 'desc', labelKey: 'inventory.sort_stock_desc' },
];

/** Null while creating, the product being changed while editing. */
interface Editor {
  product: InventoryProduct | null;
}

@Component({
  selector: 'app-inventory',
  templateUrl: './inventory.page.html',
  styleUrls: ['./inventory.page.scss'],
  imports: [DecimalPipe, IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonMenuButton, IonModal, IonSearchbar, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToggle, IonToolbar, ProductFormComponent, StockAdjustmentComponent, TranslatePipe],
})
export class InventoryPage {
  private readonly productsService = inject(ProductsService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly searches = new Subject<void>();

  protected readonly products = signal<InventoryProduct[]>([]);
  protected readonly searchTerm = signal('');
  protected readonly lowStockOnly = signal(false);
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly sort = signal<SortOption>(SORT_OPTIONS[0]);
  /** Picture addresses that failed to load, so those rows show the placeholder instead. */
  protected readonly failedImages = signal<ReadonlySet<string>>(new Set());
  protected readonly isLoading = signal(false);
  protected readonly isLoadingMore = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly actionErrorKey = signal<string | null>(null);

  protected readonly editor = signal<Editor | null>(null);
  protected readonly adjusting = signal<InventoryProduct | null>(null);

  private loadSubscription?: Subscription;

  constructor() {
    addIcons({
      'add-outline': addOutline,
      'arrow-down-outline': arrowDownOutline,
      'arrow-up-outline': arrowUpOutline,
      'create-outline': createOutline,
      'image-outline': imageOutline,
      'layers-outline': layersOutline,
      'swap-vertical-outline': swapVerticalOutline,
      'trash-outline': trashOutline,
    });
    this.searches.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => this.load());
  }

  ionViewWillEnter() {
    this.load();
  }

  protected onSearchInput(value: string | null | undefined) {
    this.searchTerm.set(value ?? '');
    this.searches.next();
  }

  protected onLowStockChange(checked: boolean) {
    this.lowStockOnly.set(checked);
    this.load();
  }

  protected onSortSelected(labelKey: unknown) {
    const option = SORT_OPTIONS.find((o) => o.labelKey === labelKey);
    if (option && option !== this.sort()) this.applySort(option);
  }

  /** A column header sorts by that column, and flips the order when it's already the one in use. */
  protected toggleSort(field: ProductSortField) {
    const current = this.sort();
    const order: SortOrder = current.field === field && current.order === 'asc' ? 'desc' : 'asc';
    this.applySort(SORT_OPTIONS.find((o) => o.field === field && o.order === order)!);
  }

  protected ariaSort(field: ProductSortField): 'ascending' | 'descending' | 'none' {
    const current = this.sort();
    if (current.field !== field) return 'none';
    return current.order === 'asc' ? 'ascending' : 'descending';
  }

  protected sortIcon(field: ProductSortField): string {
    const direction = this.ariaSort(field);
    if (direction === 'none') return 'swap-vertical-outline';
    return direction === 'ascending' ? 'arrow-up-outline' : 'arrow-down-outline';
  }

  protected showImage(product: InventoryProduct): boolean {
    return !!product.product_img_url && !this.failedImages().has(product.product_img_url);
  }

  protected onImageError(url: string | null) {
    if (url) this.failedImages.update((failed) => new Set(failed).add(url));
  }

  /** Same definition of low stock as the API and the dashboard. */
  protected isLow(product: InventoryProduct): boolean {
    return product.product_current_stock <= product.product_min_stock;
  }

  protected load() {
    this.loadSubscription?.unsubscribe();
    this.isLoading.set(true);
    this.isLoadingMore.set(false);
    this.loadFailed.set(false);
    this.actionErrorKey.set(null);

    this.loadSubscription = this.productsService.list(this.query(), 0).pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: (products) => {
        this.products.set(products);
        this.hasMore.set(products.length === PRODUCTS_PAGE_SIZE);
      },
      error: () => {
        this.products.set([]);
        this.hasMore.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  protected loadMore() {
    this.loadSubscription?.unsubscribe();
    this.isLoadingMore.set(true);
    this.actionErrorKey.set(null);

    this.loadSubscription = this.productsService
      .list(this.query(), this.products().length)
      .pipe(finalize(() => this.isLoadingMore.set(false)))
      .subscribe({
        next: (products) => {
          this.products.update((current) => [...current, ...products]);
          this.hasMore.set(products.length === PRODUCTS_PAGE_SIZE);
        },
        error: () => this.actionErrorKey.set('admin.load_error'),
      });
  }

  protected closeEditor() {
    this.editor.set(null);
  }

  protected onProductSaved(saved: InventoryProduct) {
    const editing = this.editor()?.product;
    this.closeEditor();
    if (editing) {
      this.replace(saved);
    } else {
      // A new product belongs somewhere in the sorted list, or not at all under the filters.
      this.load();
    }
  }

  protected onStockAdjusted(amount: number) {
    const product = this.adjusting();
    this.adjusting.set(null);
    if (product) this.replace({ ...product, product_current_stock: amount });
  }

  protected async confirmDelete(product: InventoryProduct) {
    const t = (key: string) => this.translate.instant(key) as string;
    const alert = await this.alerts.create({
      header: t('inventory.delete'),
      message: `${t('inventory.confirm_delete')} (${product.product_name})`,
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('inventory.delete'), role: 'destructive', handler: () => this.delete(product) },
      ],
    });
    await alert.present();
  }

  protected delete(product: InventoryProduct) {
    this.actionErrorKey.set(null);
    this.productsService.delete(product.id).subscribe({
      next: () => this.removeRow(product),
      error: (err: HttpErrorResponse) => {
        if (err.status === 404) {
          // Someone else already deleted it, which is what was asked for.
          this.removeRow(product);
          return;
        }
        this.actionErrorKey.set(
          err.error?.error?.code === 'RESOURCE_IN_USE' ? 'inventory.delete_in_use'
            : err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED'
              : 'errors.TRY_AGAIN',
        );
      },
    });
  }

  private applySort(option: SortOption) {
    this.sort.set(option);
    this.load();
  }

  private query(): ProductQuery {
    const { field, order } = this.sort();
    return { q: this.searchTerm().trim(), lowStockOnly: this.lowStockOnly(), sort: field, order };
  }

  private replace(saved: InventoryProduct) {
    this.products.update((products) => products.map((p) => (p.id === saved.id ? saved : p)));
  }

  private removeRow(product: InventoryProduct) {
    this.products.update((products) => products.filter((p) => p.id !== product.id));
  }
}
