import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonInput, IonLabel, IonSegment, IonSegmentButton, IonSpinner, IonText } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline, closeCircleOutline } from 'ionicons/icons';

import { ConnectionMode, ConnectionService, isValidServerUrl, normalizeServerUrl } from './connection.service';

type TestResult = 'ok' | 'failed' | null;

/** Chooses between the database inside the app and a server, at any address. */
@Component({
  selector: 'app-connection-settings',
  templateUrl: './connection-settings.component.html',
  styleUrls: ['./connection-settings.component.scss'],
  imports: [FormsModule, IonButton, IonIcon, IonInput, IonLabel, IonSegment, IonSegmentButton, IonSpinner, IonText, TranslatePipe],
})
export class ConnectionSettingsComponent {
  protected readonly connection = inject(ConnectionService);

  readonly closed = output<void>();

  protected readonly mode = signal<ConnectionMode>(this.connection.mode());
  protected readonly url = signal(this.connection.serverUrl());
  protected readonly isTesting = signal(false);
  protected readonly testResult = signal<TestResult>(null);
  protected readonly urlInvalid = signal(false);

  constructor() {
    addIcons({ 'checkmark-circle-outline': checkmarkCircleOutline, 'close-circle-outline': closeCircleOutline });
  }

  protected onModeChange(value: unknown) {
    if (value === 'local' || value === 'server') this.mode.set(value);
    this.urlInvalid.set(false);
    this.testResult.set(null);
  }

  protected onUrlInput(value: string | null | undefined) {
    this.url.set(value ?? '');
    this.urlInvalid.set(false);
    this.testResult.set(null);
  }

  /** A browser can leave the address blank, to use the server it was loaded from. An installed app can't. */
  private urlIsAcceptable(): boolean {
    const url = normalizeServerUrl(this.url());
    if (!url) return !this.connection.isNative;
    return isValidServerUrl(url);
  }

  protected async test() {
    if (!this.urlIsAcceptable()) {
      this.urlInvalid.set(true);
      return;
    }
    this.isTesting.set(true);
    this.testResult.set(null);
    const reachable = await this.connection.testServer(this.url());
    this.testResult.set(reachable ? 'ok' : 'failed');
    this.isTesting.set(false);
  }

  protected save() {
    if (this.mode() === 'server' && !this.urlIsAcceptable()) {
      this.urlInvalid.set(true);
      return;
    }
    this.connection.save(this.mode(), this.url());
    this.closed.emit();
  }
}
