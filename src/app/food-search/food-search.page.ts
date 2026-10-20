import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner } from '@ionic/angular';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-food-search',
  templateUrl: './food-search.page.html',
  styleUrls: ['./food-search.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonTitle, IonToolbar, IonSearchbar, IonList, IonItem, IonThumbnail, IonLabel, IonNote, IonSpinner]
})
export class FoodSearchPage {
  searchTerm: string = '';
  products: any[] = [];
  isLoading: boolean = false;
  hasSearched: boolean = false;
  hasError: boolean = false;

  private currentRequest: any = null;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  searchProducts() {
    const query = (this.searchTerm || '').trim();
    
    console.log('Término procesado:', query);

    if (!query) {
      if (this.currentRequest) {
        this.currentRequest.unsubscribe();
      }
      this.products = [];
      this.hasSearched = false;
      this.hasError = false;
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    if (this.currentRequest) {
      this.currentRequest.unsubscribe();
    }
    this.products = [];
    this.isLoading = true;
    this.hasSearched = true;
    this.hasError = false;
    this.cdr.detectChanges();

    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20`;

    this.currentRequest = this.http.get<any>(url).pipe(
      finalize(() => {
        this.isLoading = false;
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: (response) => {
        console.log('Productos obtenidos:', response.products);
        this.products = response.products || [];
        this.hasError = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al conectar con Open Food Facts:', err);
        this.products = [];
        this.hasError = false; 
        this.cdr.detectChanges();
      }
    });
  }
}