import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { IonButton, IonInput, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonText, IonTextarea } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';

import { Field, text, wholeNumber } from '../../food-search/product-form/product-form.component';
import { InventoryProduct, ProductsService, StockAdjustment } from '../../food-search/products.service';

const ADJUSTMENT_TYPES = ['entrada', 'salida', 'correccion', 'merma'];
const HISTORY_SIZE = 5;
const MAX_STOCK = 2147483647;

type Mode = 'change' | 'set';

function signedWholeNumber(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  if (!value) return null;
  const valid = /^[+-]?\d+$/.test(value) && Number(value) !== 0 && Math.abs(Number(value)) <= MAX_STOCK;
  return valid ? null : { signedWholeNumber: true };
}

/**
 * Changes the stock of a product, which the API records with who did it and why.
 * Either adds or subtracts an amount, with quick buttons or typed, or sets an exact total.
 */
@Component({
  selector: 'app-stock-adjustment',
  templateUrl: './stock-adjustment.component.html',
  styleUrls: ['./stock-adjustment.component.scss'],
  imports: [DatePipe, ReactiveFormsModule, IonButton, IonInput, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonText, IonTextarea, TranslatePipe],
})
export class StockAdjustmentComponent implements OnInit {
  private readonly products = inject(ProductsService);

  readonly product = input.required<InventoryProduct>();
  /** Emits the new stock, as recorded by the API. */
  readonly adjusted = output<number>();
  readonly cancelled = output<void>();

  protected readonly types = ADJUSTMENT_TYPES;
  protected readonly increments = [-10, -5, -1, 1, 5, 10];
  protected readonly mode = signal<Mode>('change');
  protected readonly history = signal<StockAdjustment[]>([]);
  protected readonly historyFailed = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = new FormGroup({
    adj_type: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    adj_quantity: new FormControl<Field>('', [Validators.required, signedWholeNumber]),
    adj_new_amount: new FormControl<Field>({ value: '', disabled: true }, [Validators.required, wholeNumber]),
    adj_motive: new FormControl('', { nonNullable: true }),
  });

  ngOnInit() {
    this.products.adjustments(this.product().id, HISTORY_SIZE).subscribe({
      next: (history) => this.history.set(history),
      error: () => this.historyFailed.set(true),
    });
  }

  protected get quantityErrorKey(): string {
    return this.form.controls.adj_quantity.hasError('required')
      ? 'validation.required'
      : 'inventory.quantity_invalid';
  }

  protected get amountErrorKey(): string {
    return this.form.controls.adj_new_amount.hasError('required')
      ? 'validation.required'
      : 'products_page.number_invalid';
  }

  /** The stock this change would give, or null until the amount is valid. */
  protected get resultingStock(): number | null {
    const control = this.form.controls.adj_quantity;
    return text(control.value) && control.valid
      ? this.product().product_current_stock + Number(text(control.value))
      : null;
  }

  /** Types recorded some other way have no translation, so they show as stored. */
  protected typeLabel(type: string): string {
    return ADJUSTMENT_TYPES.includes(type) ? `inventory.adj_types.${type}` : type;
  }

  protected incrementLabel(increment: number): string {
    return increment > 0 ? `+${increment}` : String(increment);
  }

  protected onModeChange(value: unknown) {
    if (value !== 'change' && value !== 'set') return;
    this.mode.set(value);
    this.errorKey.set(null);
    // Only the active field is validated. What was typed in the other stays for coming back.
    const { adj_quantity, adj_new_amount } = this.form.controls;
    if (value === 'change') {
      adj_quantity.enable();
      adj_new_amount.disable();
    } else {
      adj_new_amount.enable();
      adj_quantity.disable();
    }
  }

  /** Quick buttons build on what's there, so +10 then +5 means +15. */
  protected applyIncrement(increment: number) {
    const control = this.form.controls.adj_quantity;
    const current = Number(text(control.value));
    const next = (Number.isFinite(current) ? Math.trunc(current) : 0) + increment;
    this.errorKey.set(null);
    control.setValue(next === 0 ? '' : next);
    control.markAsTouched();
  }

  protected save() {
    if (this.isSaving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { adj_type, adj_quantity, adj_new_amount, adj_motive } = this.form.getRawValue();
    const current = this.product().product_current_stock;
    let change: { adj_new_amount: number } | { adj_quantity: number };

    if (this.mode() === 'change') {
      const quantity = Number(text(adj_quantity));
      if (current + quantity < 0) {
        this.errorKey.set('inventory.negative_stock');
        return;
      }
      change = { adj_quantity: quantity };
    } else {
      const amount = Number(text(adj_new_amount));
      if (amount === current) {
        this.errorKey.set('inventory.no_change');
        return;
      }
      change = { adj_new_amount: amount };
    }

    this.isSaving.set(true);
    this.errorKey.set(null);
    this.products.adjustStock(this.product().id, adj_type, change, adj_motive.trim() || null).pipe(
      finalize(() => this.isSaving.set(false)),
    ).subscribe({
      next: (saved) => this.adjusted.emit(saved.adj_new_amount),
      error: (err: HttpErrorResponse) => this.errorKey.set(this.errorKeyFor(err)),
    });
  }

  private errorKeyFor(err: HttpErrorResponse): string {
    if (err.error?.error?.code === 'STOCK_WOULD_BE_NEGATIVE') return 'inventory.negative_stock';
    if (err.status === 404) return 'inventory.product_missing';
    if (err.status === 400) return 'admin.invalid_data';
    return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
  }
}
