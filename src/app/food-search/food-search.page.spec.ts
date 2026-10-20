import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FoodSearchPage } from './food-search.page';

describe('FoodSearchPage', () => {
  let component: FoodSearchPage;
  let fixture: ComponentFixture<FoodSearchPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(FoodSearchPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
