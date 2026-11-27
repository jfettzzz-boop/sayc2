import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { LandingPage } from './landing.page';

describe('LandingPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [provideRouter([]), provideTranslateService(), provideIonicAngular()],
    });
  });

  it('presents every feature and step, and links to registration and sign-in', () => {
    const fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelectorAll('.feature').length).toBe(6);
    expect(element.querySelectorAll('.step').length).toBe(3);

    const links = [...element.querySelectorAll('[routerLink], [ng-reflect-router-link]')]
      .map((link) => link.getAttribute('routerLink') ?? link.getAttribute('ng-reflect-router-link'));
    expect(links).toContain('/register');
    expect(links).toContain('/login');
  });
});
