import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { IonButton, IonInput, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonText, IonTextarea } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { finalize } from 'rxjs/operators';

import { Field, text, wholeNumber } from '../../food-search/product-form/product-form.component';
import { InventoryProduct, ProductsService, StockAdjustment } from '../../food-search/products.service';

const STOCK_IN = 'entrada';
const STOCK_OUT = 'salida';
const SHRINKAGE = 'merma';
const CORRECTION = 'correccion';
const ADJUSTMENT_TYPES = [STOCK_IN, STOCK_OUT, CORRECTION, SHRINKAGE];
const HISTORY_SIZE = 5;
const MAX_STOCK = 2147483647;

type Mode = 'change' | 'set';

function signedWholeNumber(control: AbstractControl<Field>): ValidationErrors | null {
  const value = text(control.value);
  if (!value) return null;
  const valid = /^[+-]?\d+$/.test(value) && Number(value) !== 0 && Math.abs(Number(value)) <= MAX_STOCK;
  return valid ? null : { signedWholeNumber: true };
}

/** A correction can go either way. Every other type has a direction. */
function typeFits(type: string, delta: number): boolean {
  if (type === CORRECTION) return true;
  if (type === STOCK_IN) return delta > 0;
  return (type === STOCK_OUT || type === SHRINKAGE) && delta < 0;
}

/**
 * Changes the stock of a product, which the API records with who did it and why.
 * Either adds or subtracts an amount, with quick buttons or typed, or sets an exact total.
 * The type and the direction of the change always agree: each one corrects the other.
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

  private readonly quantityValue = toSignal(this.form.controls.adj_quantity.valueChanges, { initialValue: '' as Field });
  private readonly amountValue = toSignal(this.form.controls.adj_new_amount.valueChanges, { initialValue: '' as Field });

  /** How much the active field would change the stock. Null until there is a valid, non-zero change. */
  private readonly delta = computed(() => {
    const quantity = this.quantityValue();
    const amount = this.amountValue();
    const { adj_quantity, adj_new_amount } = this.form.controls;

    let delta: number | null = null;
    if (this.mode() === 'change') {
      if (text(quantity) && adj_quantity.valid) delta = Number(text(quantity));
    } else if (text(amount) && adj_new_amount.valid) {
      delta = Number(text(amount)) - this.product().product_current_stock;
    }
    return delta === 0 ? null : delta;
  });

  /** The stock this change would give, for the summary. */
  protected readonly resultingStock = computed(() => {
    const delta = this.delta();
    return delta === null ? null : this.product().product_current_stock + delta;
  });

  constructor() {
    const { adj_type, adj_quantity, adj_new_amount } = this.form.controls;
    adj_quantity.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.selectFittingType());
    adj_new_amount.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.selectFittingType());
    // Types set from code don't emit, so this only sees the user's own choices.
    adj_type.valueChanges.pipe(takeUntilDestroyed()).subscribe((type) => this.applyTypeDirection(type));
  }

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
    this.selectFittingType();
  }

  /**
   * Quick buttons build on what's there, so +10 then +5 means +15. They always select
   * stock in or stock out, following the total: +5 then -10 is 5 out.
   */
  protected applyIncrement(increment: number) {
    const control = this.form.controls.adj_quantity;
    const current = Number(text(control.value));
    const next = (Number.isFinite(current) ? Math.trunc(current) : 0) + increment;
    this.errorKey.set(null);
    control.setValue(next === 0 ? '' : next);
    control.markAsTouched();
    if (next !== 0) this.setType(next > 0 ? STOCK_IN : STOCK_OUT);
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

  /** A typed amount replaces a type that contradicts it, and leaves one that fits, like shrinkage. */
  private selectFittingType() {
    const delta = this.delta();
    if (delta !== null && !typeFits(this.form.controls.adj_type.value, delta)) {
      this.setType(delta > 0 ? STOCK_IN : STOCK_OUT);
    }
  }

  /** Choosing stock out with +5 means 5 out, so the amount and the summary follow the type. */
  private applyTypeDirection(type: string) {
    const control = this.form.controls.adj_quantity;
    if (this.mode() !== 'change' || !control.valid) return;

    const quantity = Number(text(control.value));
    if (quantity > 0 && (type === STOCK_OUT || type === SHRINKAGE)) control.setValue(-quantity);
    if (quantity < 0 && type === STOCK_IN) control.setValue(-quantity);
  }

  private setType(type: string) {
    this.form.controls.adj_type.setValue(type, { emitEvent: false });
  }

  private errorKeyFor(err: HttpErrorResponse): string {
    if (err.error?.error?.code === 'STOCK_WOULD_BE_NEGATIVE') return 'inventory.negative_stock';
    if (err.status === 404) return 'inventory.product_missing';
    if (err.status === 400) return 'admin.invalid_data';
    return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
  }
}
