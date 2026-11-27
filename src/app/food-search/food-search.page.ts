import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner, IonIcon, IonButton } from '@ionic/angular';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize, catchError } from 'rxjs/operators';

// Multilanguage
import { TranslatePipe } from '@ngx-translate/core';

import { ProductsService } from '../products/products.service';
// Multilanguage end

@Component({
  selector: 'app-food-search',
  templateUrl: './food-search.page.html',
  styleUrls: ['./food-search.page.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
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
    TranslatePipe
  ]
})
export class FoodSearchPage implements OnInit, OnDestroy {
  searchTerm: string = '';
  products: any[] = [];
  isLoading: boolean = false;
  hasSearched: boolean = false;
  hasError: boolean = false;

  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly productsService = inject(ProductsService);

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

        const url = `/api/cgi/search.pl?search_terms=${encodeURIComponent(trimmedQuery)}&search_simple=1&action=process&json=1&page_size=20`;

        const headers = new HttpHeaders({
          'User-Agent': 'SAYCApp - Ionic App - Version 1.0 - Contact: support@saycapp.local',
          'Accept': 'application/json'
        });

        return this.http.get<any>(url, { headers }).pipe(
          catchError((err) => {
            console.error('Servidor ocupado (503) ', err);
            this.hasError = true;
            return of({ products: [] });
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
          this.hasError = false;
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
    this.searchSubject.next(value);
  }

  addToInventory(product: any) {
    this.productsService.draft.set({
      product_barcode: product.code || product._id || '',
      product_name: product.product_name || product.abbreviated_product_name || 'Producto sin nombre',
      product_brand: (product.brands || 'Desconocida').split(',')[0].trim(),
      product_description: product.quantity || '',
      product_img_url: product.image_front_small_url || product.image_front_url || '',
    });
    this.router.navigateByUrl('/products');
  }
}