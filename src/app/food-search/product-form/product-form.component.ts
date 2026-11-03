import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { IonButton, IonInput, IonSpinner, IonText, IonTextarea } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';

import { InventoryProduct, NewProduct, ProductChanges, ProductDraft, ProductsService } from '../products.service';

const MAX_MONEY = 99999999.99;
const MAX_INT = 2147483647;

// Number inputs may report a number or a string, and empty as '' or null.
export type Field = string | number | null;

export const text = (value: Field) => String(value ?? '').trim();

function money(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  if (!value) return null;
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= MAX_MONEY ? null : { money: true };
}

export function wholeNumber(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  if (!value) return null;
  return /^\d+$/.test(value) && Number(value) <= MAX_INT ? null : { wholeNumber: true };
}

function aboveZero(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  return value && Number(value) <= 0 ? { aboveZero: true } : null;
}

function imageUrl(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  return !value || /^https?:\/\/\S+$/i.test(value) ? null : { imageUrl: true };
}

function errorKeyFor(err: HttpErrorResponse): string {
  if (err.error?.error?.code === 'BARCODE_ALREADY_REGISTERED') return 'products_page.barcode_taken';
  if (err.status === 400) return 'admin.invalid_data';
  return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
}

/** Registers a product, or edits one when given `product`. Only the name and price are required. */
@Component({
  selector: 'app-product-form',
  templateUrl: './product-form.component.html',
  styleUrls: ['./product-form.component.scss'],
  imports: [ReactiveFormsModule, IonButton, IonInput, IonSpinner, IonText, IonTextarea, TranslatePipe],
})
export class ProductFormComponent {
  private readonly products = inject(ProductsService);

  /** Prefills a new product from an Open Food Facts result. */
  readonly draft = input<ProductDraft | null>(null);
  /** The product to edit. */
  readonly product = input<InventoryProduct | null>(null);
  readonly cancellable = input(false);

  readonly saved = output<InventoryProduct>();
  readonly cancelled = output<void>();

  protected readonly isSaving = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = new FormGroup({
    product_name: new FormControl<Field>('', [Validators.required, Validators.pattern(/\S/)]),
    product_sell_price: new FormControl<Field>('', [Validators.required, money, aboveZero]),
    product_barcode: new FormControl<Field>(''),
    product_brand: new FormControl<Field>(''),
    product_description: new FormControl<Field>(''),
    product_costs: new FormControl<Field>('', [money]),
    product_current_stock: new FormControl<Field>('', [wholeNumber]),
    product_min_stock: new FormControl<Field>('', [wholeNumber]),
    product_img_url: new FormControl<Field>('', [imageUrl]),
  });

  constructor() {
    effect(() => {
      const draft = this.draft();
      const product = this.product();
      untracked(() => {
        this.errorKey.set(null);
        this.form.reset({
          product_name: product?.product_name ?? draft?.name ?? '',
          product_sell_price: product?.product_sell_price ?? '',
          product_barcode: product?.product_barcode ?? draft?.barcode ?? '',
          product_brand: product?.product_brand ?? draft?.brand ?? '',
          product_description: product?.product_description ?? draft?.description ?? '',
          product_costs: product?.product_costs ?? '',
          product_current_stock: '',
          product_min_stock: product?.product_min_stock ?? '',
          product_img_url: product?.product_img_url ?? draft?.imageUrl ?? '',
        });
      });
    });
  }

  protected get priceErrorKey(): string {
    return this.form.controls.product_sell_price.hasError('required')
      ? 'products_page.price_required'
      : 'products_page.price_invalid';
  }

  protected save() {
    if (this.isSaving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const product = this.product();
    let request;
    if (product) {
      const changes = this.buildChanges(product);
      if (Object.keys(changes).length === 0) {
        this.cancelled.emit();
        return;
      }
      request = this.products.update(product.id, changes);
    } else {
      request = this.products.create(this.buildProduct());
    }

    this.isSaving.set(true);
    this.errorKey.set(null);
    request.pipe(
      finalize(() => this.isSaving.set(false)),
    ).subscribe({
      next: (saved) => {
        this.form.reset();
        this.saved.emit(saved);
      },
      error: (err: HttpErrorResponse) => this.errorKey.set(errorKeyFor(err)),
    });
  }

  /** Leaves out blank optional fields, so the database applies its defaults. */
  private buildProduct(): NewProduct {
    const v = this.form.getRawValue();
    const optional = (value: Field, parse: (s: string) => string | number = (s) => s) =>
      text(value) ? parse(text(value)) : undefined;

    const product: NewProduct = {
      product_name: text(v.product_name),
      product_sell_price: Number(text(v.product_sell_price)),
      product_barcode: optional(v.product_barcode) as string | undefined,
      product_brand: optional(v.product_brand) as string | undefined,
      product_description: optional(v.product_description) as string | undefined,
      product_costs: optional(v.product_costs, Number) as number | undefined,
      product_current_stock: optional(v.product_current_stock, Number) as number | undefined,
      product_min_stock: optional(v.product_min_stock, Number) as number | undefined,
      product_img_url: optional(v.product_img_url) as string | undefined,
    };
    if (this.draft()) product.product_api_origin = true;
    return product;
  }

  /**
   * Sends only what changed. Blank text fields are cleared. Blank cost and minimum stock
   * keep their values, because those columns always hold a number.
   */
  private buildChanges(product: InventoryProduct): ProductChanges {
    const v = this.form.getRawValue();
    const changes: ProductChanges = {};

    const name = text(v.product_name);
    if (name !== product.product_name) changes.product_name = name;

    const price = Number(text(v.product_sell_price));
    if (price !== product.product_sell_price) changes.product_sell_price = price;

    const barcode = text(v.product_barcode) || null;
    if (barcode !== product.product_barcode) changes.product_barcode = barcode;

    const brand = text(v.product_brand) || null;
    if (brand !== product.product_brand) changes.product_brand = brand;

    const description = text(v.product_description) || null;
    if (description !== product.product_description) changes.product_description = description;

    const image = text(v.product_img_url) || null;
    if (image !== (product.product_img_url ?? null)) changes.product_img_url = image;

    const cost = text(v.product_costs);
    if (cost && Number(cost) !== product.product_costs) changes.product_costs = Number(cost);

    const minStock = text(v.product_min_stock);
    if (minStock && Number(minStock) !== product.product_min_stock) changes.product_min_stock = Number(minStock);

    return changes;
  }
}
