# Marvin's PDF Merger

Eine moderne, benutzerfreundliche Web-Anwendung zum Zusammenfügen von PDF-Dateien mit industrieller qpdf-wasm Engine. **100% offline und sicher** - alle Verarbeitungen finden lokal in Ihrem Browser statt.

## ✨ Features

### � PDF-Engine (qpdf-wasm)

- ⚡ **Industrielle Qualität** - qpdf-wasm als primäre Engine für professionelle PDF-Verarbeitung
- 🔧 **Robuste Reparatur** - Automatische Korrektur beschädigter PDFs
- 🗜️ **Echte Linearisierung** - Web-optimierte PDFs für schnelleres Laden
- 🔐 **Professionelle Verschlüsselung** - Industriestandard-Sicherheit
- 💾 **Speicher-optimiert** - Besseres Memory-Management für große Dateien (400+ Seiten)
- 🛠️ **CLI-Kompatibilität** - Über 100 qpdf-Operationen verfügbar

### �📄 PDF-Funktionen

- 🎨 **Moderne UI** - Elegante Benutzeroberfläche mit Aurora-Effekten
- 📁 **Drag & Drop** - Einfaches Hochladen von PDF-Dateien und Bildern
- 🔄 **Seiten-Reordering** - Intuitive Neuanordnung der PDF-Seiten
- 📊 **Größenschätzung** - Automatische Berechnung der finalen PDF-Größe
- 🗜️ **Komprimierung** - 5 verschiedene Komprimierungsstufen
- 📝 **Metadaten-Bearbeitung** - Titel, Autor und weitere Eigenschaften anpassen
- 🔒 **Passwort-Schutz** - Sichere Verschlüsselung der erstellten PDFs
- 🔐 **Geschützte PDF-Unterstützung** - Lädt auch passwortgeschützte PDFs

### 🖼️ Bildverarbeitung

- 📸 **Universelle Formate** - JPEG, PNG, WebP, BMP, GIF, TIFF, SVG, ICO, AVIF, HEIC/HEIF + alle browser-unterstützten Formate
- 🔄 **Canvas-Konvertierung** - Automatische Umwandlung beliebiger Bildformate durch Browser-Engine
- 📏 **Intelligente Skalierung** - Optimale Größenanpassung mit Aspect-Ratio-Erhaltung
- 🎯 **DPI-Einstellungen** - Web (150), Druck (300), Archiv (600) DPI oder Original beibehalten
- 🔄 **Transformationen** - Drehen (90°), horizontal/vertikal spiegeln für perfekte Orientierung
- 🎨 **Qualitätskontrolle** - Einstellbare JPEG-Komprimierung (60-100%) und Format-Optimierung
- 📄 **Seitenformat** - Auto, Portrait, Landscape für optimale PDF-Darstellung
- 🌈 **Transparenz-Support** - PNG-Transparenz automatisch erkannt und beibehalten
- 📱 **Mobile-optimiert** - Perfekt für Handy-Fotos und gescannte Dokumente
- 🔗 **Nahtlose Integration** - Mische Bilder und PDFs beliebig, verarbeitet durch qpdf-wasm

### � Multi-Engine-Architektur

- 🥇 **qpdf-wasm** - Primäre Engine für professionelle Anwendungen
- � **PDF-lib** - Fallback für einfache Operationen
- �️ **PDFKit** - Legacy-Support für spezielle Fälle
- �️ **PDFium** - Rendering und Vorschau-Generierung

### 🎨 Benutzerfreundlichkeit

- 🌙 **Dark/Light Mode** - Umschaltbarer Dunkelmodus
- 💫 **Animationen** - Schwebende Icons und sanfte Übergänge
- 📱 **Responsive Design** - Optimiert für alle Bildschirmgrößen
- ⌨️ **Keyboard-Shortcuts** - F1 (Hilfe), ESC (Reset), Ctrl+Enter (Merge)
- 🛡️ **Datenschutz** - Keine Server, keine Cloud - alles bleibt lokal

## 🚀 Verwendung

### PDF-Dateien zusammenfügen:

1. Öffne `index.html` in einem modernen Webbrowser
2. Lade PDF-Dateien per Drag & Drop oder über den Button hoch
3. Bei passwortgeschützten PDFs wird automatisch nach dem Passwort gefragt
4. Ordne die Seiten nach Wunsch an
5. Wähle eine Komprimierungsstufe
6. Optional: Bearbeite Metadaten (Titel, Autor)
7. Optional: Setze ein Passwort für die neue PDF
8. Lade die zusammengefügte PDF herunter

### Bilder zu PDF konvertieren:

1. Lade Bilder in unterstützten Formaten hoch (JPEG, PNG)
2. Kombiniere Bilder mit PDF-Seiten beliebig
3. Stelle Komprimierung und Qualität ein
4. Lade die finale PDF herunter (verarbeitet durch qpdf-wasm)

### Unterstützte Formate:

- **PDF-Dateien**: Alle Standard-PDFs, auch passwortgeschützte und beschädigte (qpdf-Reparatur)
- **Bilder**: Praktisch alle Formate durch Canvas-API
  - **Nativ optimiert**: JPEG, PNG
  - **Web-Standard**: WebP, GIF, BMP, SVG
  - **Profi-Formate**: TIFF, AVIF, HEIC/HEIF, ICO
  - **Beliebige weitere**: Alle vom Browser unterstützten Bildformate
- **Ausgabe**: Industriestandard-PDFs durch qpdf-wasm Engine

## 🛠️ Technologie

- **HTML5** - Moderne Web-Standards
- **CSS3** - Tailwind CSS für Styling
- **JavaScript** - Vanilla JS für Funktionalität
- **qpdf-wasm** - Industrielle PDF-Engine (primär)
- **PDF-lib** - JavaScript PDF-Bibliothek (fallback)
- **PDFKit** - Legacy PDF-Support
- **PDFium** - PDF-Rendering und Vorschau
- **Canvas API** - Bildverarbeitung
- **Font Awesome** - Icons

## 🏗️ Engine-Architektur

### Primäre Engine: qpdf-wasm ⚡

- **Vorteile**: Industrielle Qualität, robuste Reparatur, echte Linearisierung
- **Einsatz**: Alle PDF-Merge-Operationen, große Dateien (400+ Seiten)
- **Performance**: Exzellent für komplexe PDFs

### Fallback Engines:

- **PDF-lib**: Einfache Operationen, kleine Dateien
- **PDFKit**: Legacy-Support, spezielle Anwendungsfälle
- **PDFium**: Rendering, Vorschau-Generierung

## 🚀 Verwendung

### PDF-Dateien zusammenfügen:

1. Öffne `index.html` in einem modernen Webbrowser
2. Lade PDF-Dateien per Drag & Drop oder über den Button hoch
3. Bei passwortgeschützten PDFs wird automatisch nach dem Passwort gefragt
4. Ordne die Seiten nach Wunsch an (qpdf-wasm verarbeitet automatisch)
5. Wähle eine Komprimierungsstufe
6. Optional: Bearbeite Metadaten (Titel, Autor)
7. Optional: Setze ein Passwort für die neue PDF
8. Lade die zusammengefügte PDF herunter

### Engine-Auswahl:

- **Automatisch**: qpdf-wasm wird bevorzugt für beste Qualität
- **Fallback**: Bei Problemen automatischer Wechsel zu PDF-lib
- **Transparent**: Nutzer sieht die beste verfügbare Engine-Leistung

## 📋 Browser-Kompatibilität

### Unterstützte Browser:

- **Chrome 90+** ✅ Vollständig unterstützt (qpdf-wasm optimiert)
- **Firefox 88+** ✅ Vollständig unterstützt
- **Safari 14+** ✅ Vollständig unterstützt
- **Edge 90+** ✅ Vollständig unterstützt

### Engine-Kompatibilität:

- **qpdf-wasm**: Alle modernen Browser mit WebAssembly-Support ✅
- **PDF-lib**: Universelle Browser-Unterstützung ✅
- **Automatisches Fallback**: Bei WASM-Problemen ✅

## 📄 Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe `LICENSE.md` für Details.

## 🔧 Entwicklung

Das Projekt benötigt keine Installation oder Build-Prozess. Einfach die `index.html` öffnen!

## 🤝 Beitragen

Beiträge sind willkommen! Bitte erstelle einen Pull Request oder öffne ein Issue für Verbesserungsvorschläge.
