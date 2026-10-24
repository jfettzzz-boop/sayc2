# sayc
Sistema de administración y cobro. Aplicación híbrida desarrollada con Ionic 7 y Angular (empleando componentes Standalone y arquitectura modular basada en rutas) y soporte para internacionalización (ngx-translate).

---

## Función principal
Búsqueda de Productos con Open Food Facts: Módulo de búsqueda de alimentos en tiempo reale con control de errores, reintentos, debouncing (`rxjs`) y cabeceras personalizadas (`User-Agent`).

---

## Estructura

```text
└── src
    ├── app
    │   ├── food-search
    │   │   ├── food-search.page.html
    │   │   └── food-search.page.ts
    │   ├── home
    │   │   ├── home.page.html
    │   │   └── home.page.ts
    │   ├── app.component.html
    │   ├── app.component.ts
    │   └── app.routes.ts
    ├── index.html
    └── main.ts
    ├── .gitignore
├── package.json
└── README.md
```

## Instalación

```bash
npm install
```

## Instalación y ejecución

```bash
npm start
```