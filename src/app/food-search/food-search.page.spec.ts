import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';
import { FoodSearchPage } from './food-search.page';

describe('FoodSearchPage', () => {
  let component: FoodSearchPage;
  let fixture: ComponentFixture<FoodSearchPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FoodSearchPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideIonicAngular(), provideTranslateService()],
    });
    fixture = TestBed.createComponent(FoodSearchPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
