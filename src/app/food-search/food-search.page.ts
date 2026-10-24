import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner, IonIcon, IonButton } from '@ionic/angular';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize, catchError } from 'rxjs/operators';

// Multilanguage
import { TranslatePipe } from '@ngx-translate/core';
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
  searchTerm: string = 1245;
  products: any[] = [];
  isLoading: boolean = false;
  hasSearched: boolean = false;
  hasError: boolean = false;

  private searchSubject = new Subject<string>();
  private searchSubscription!: Subscription;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

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
    const productData = {
      name: product.product_name || 'Producto sin nombre',
      brand: product.brands || 'Desconocida',
      quantity: product.quantity || 'N/D',
      code: product.code || product._id || '',
      image: product.image_front_small_url || ''
    };
    alert(`Producto: "${productData.name}" añadido al inventario.`);
  }
}