import { Component, inject, input } from '@angular/core';
import { IonItem, IonLabel, IonList } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { LANGUAGES, PreferencesService, THEMES } from './preferences.service';

/** The language or theme choices, for showing inside a popover. */
@Component({
  selector: 'app-preference-options',
  templateUrl: './preference-options.component.html',
  styleUrls: ['./preference-options.component.scss'],
  imports: [IonItem, IonLabel, IonList, TranslatePipe],
})
export class PreferenceOptionsComponent {
  protected readonly preferences = inject(PreferencesService);

  readonly kind = input.required<'language' | 'theme'>();

  protected readonly languages = LANGUAGES;
  protected readonly themes = THEMES;
}
