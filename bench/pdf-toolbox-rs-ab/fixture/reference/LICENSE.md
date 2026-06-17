# MIT License

**PDF Merger**  
Copyright (c) 2025 Marvin Kalani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Verwendete Bibliotheken

### PDF-lib
- **Lizenz:** MIT License
- **Copyright:** (c) 2019 Andrew Dillon
- **Quelle:** https://github.com/Hopding/pdf-lib
- **Verwendung:** Erstellung und Bearbeitung von PDF-Dokumenten ohne Verschlüsselung

### PDFKit
- **Lizenz:** MIT License
- **Copyright:** (c) Devon Govett
- **Quelle:** https://github.com/foliojs/pdfkit
- **Verwendung:** PDF-Erstellung mit Verschlüsselungsunterstützung

### blob-stream
- **Lizenz:** MIT License
- **Copyright:** (c) Devon Govett
- **Quelle:** https://github.com/devongovett/blob-stream
- **Verwendung:** Stream-zu-Blob Konvertierung für PDFKit

### PDF.js
- **Lizenz:** Apache License 2.0
- **Copyright:** (c) 2011 Mozilla Foundation
- **Quelle:** https://github.com/mozilla/pdf.js
- **Verwendung:** Rendering von PDF-Seiten für Vorschaubilder und Verschlüsselung

### TailwindCSS
- **Lizenz:** MIT License
- **Copyright:** (c) Tailwind Labs, Inc.
- **Quelle:** https://github.com/tailwindlabs/tailwindcss
- **Verwendung:** CSS-Framework für das User Interface

### Font Awesome
- **Lizenz:** SIL OFL 1.1 License (Icons), MIT License (Code)
- **Copyright:** (c) Fonticons, Inc.
- **Quelle:** https://fontawesome.com
- **Verwendung:** Icons für das User Interface

---

## Über das Projekt

PDF Merger ist ein vollständig clientseitiges PDF-Bearbeitungstool, das PDF-Dateien zusammenfügen, Seiten neu anordnen und bearbeiten kann, ohne dass Daten an externe Server gesendet werden müssen. Alle Verarbeitungsoperationen finden lokal im Browser des Benutzers statt.

### Hauptfeatures:
- ✅ PDF-Dateien zusammenfügen
- ✅ **PDF-Verschlüsselung mit Passwortschutz**
- ✅ **Granulare Berechtigungen** (Drucken, Kopieren, Bearbeiten, etc.)
- ✅ **Intelligente Komprimierung** mit verschiedenen Qualitätsstufen
- ✅ **Browser-Metadaten-Bereinigung** (ersetzt Browser-Strings durch "Marvin's PDF Merger")
- ✅ Seiten per Drag & Drop neu anordnen
- ✅ Seitenvorschauen mit Thumbnails
- ✅ Farbkodierung für verschiedene PDF-Quellen
- ✅ **Detaillierte Größen-Logging** (Original vs. Komprimiert)
- ✅ Aurora-Hintergrundanimationen
- ✅ Hell/Dunkel-Modus
- ✅ Vollständig offline-fähig
- ✅ Datenschutzfreundlich (keine Server-Uploads)
- ✅ Responsive Design mit Hell-/Dunkelmodus

### Technische Details:
- Reine HTML5/CSS3/JavaScript-Implementierung
- **Hybrid PDF-Engine**: PDF-lib für Komprimierung, PDFKit für Verschlüsselung
- **Browser Buffer Polyfill** für PDFKit-Kompatibilität
- Canvas API für Bildbearbeitung und PDF-zu-Bild-Konvertierung
- File API für lokalen Dateizugriff
- Blob/Object URLs für sichere Bildvorschau
- **128-bit AES-Verschlüsselung** (PDF Version 1.7)
- **JPEG-Qualitätsoptimierung** basierend auf Komprimierungslevel
- Local Storage für Benutzereinstellungen
- **Intelligente Duplikat-Erkennung** und Metadaten-Extraktion

**Entwickelt mit ❤️ von Marvin Kalani**
