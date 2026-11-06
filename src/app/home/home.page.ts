import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonCol, IonRow, IonGrid, IonContent, IonHeader, IonTitle, IonToolbar, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle } from '@ionic/angular';

import { addIcons } from 'ionicons';
import { peopleOutline, searchOutline } from 'ionicons/icons';


//Multilanguage
import { TranslatePipe } from '@ngx-translate/core';
// //Multilanguage end

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonIcon, IonCol, IonRow, IonGrid, IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule, TranslatePipe, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle]
})
export class HomePage {

  constructor() {

        addIcons({  
          'people-outline': peopleOutline
        });

  }

}
