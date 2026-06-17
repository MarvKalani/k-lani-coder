# PDF Converter - NUMMERIERTE TESTS (0001-9999)

## 🎯 Test-Konzept

**STRUKTURIERTE TESTS**: Jeder Test hat eine Nummer (0001-9999) und prüft eine spezifische Task-Anforderung.

### 📋 Test-Kategorien

- **0001-0009**: Essentielle Basis-Tests (reserviert)
- **0010-0099**: PDF Upload & Anzeige
- **0100-0199**: Ziel-PDF Management
- **0200-0299**: Pagination Tests
- **0300-0399**: Performance & Memory Tests
- **0400-9999**: Erweiterte Features (reserviert)

## ⚡ Tests ausführen

### Alle nummerierten Tests (empfohlen)

```bash
npm test
```

**Was passiert:**

1. ✅ Erstellt automatisch Test-PDF-Dateien
2. ✅ Startet Server falls nötig (localhost:8000)
3. ✅ Führt Tests 0001-9999 in Reihenfolge aus
4. ✅ Zeigt ALLE Ergebnisse numerisch sortiert
5. ✅ Beendet Server automatisch

### Nur Test-PDFs erstellen

```bash
npm run create-test-files
```

### Nur Playwright Tests

```bash
npm run test:playwright
```

## � Test-Details

### 🔥 ESSENTIELLE TESTS (0001-0009)

| Test     | Beschreibung                      | Prüft                      |
| -------- | --------------------------------- | -------------------------- |
| **0001** | Seite startet OHNE Console-Fehler | Keine JS-Errors            |
| **0002** | UI-Elemente vorhanden             | Drop-Area, Container, etc. |
| **0003** | Logger-System funktioniert        | window.logger verfügbar    |
| **0004** | Canvas-Pool entfernt              | Keine Pool-Reste im Code   |

### 📄 PDF TESTS (0010-0099)

| Test     | Beschreibung                | Prüft               |
| -------- | --------------------------- | ------------------- |
| **0010** | PDF-Upload funktioniert     | test-small.pdf lädt |
| **0011** | PDF-Seiten werden gerendert | Canvas hat Inhalt   |

### 🎯 ZIEL-PDF TESTS (0100-0199)

| Test     | Beschreibung              | Prüft                   |
| -------- | ------------------------- | ----------------------- |
| **0100** | Seiten zu Ziel hinzufügen | Add-Button funktioniert |
| **0101** | KEIN doppeltes Rendering  | Render-Logs zählen      |

### 📑 PAGINATION TESTS (0200-0299)

| Test     | Beschreibung      | Prüft                      |
| -------- | ----------------- | -------------------------- |
| **0200** | Source-Pagination | test-large.pdf (25 Seiten) |

### 🚀 PERFORMANCE TESTS (0300-0399)

| Test     | Beschreibung           | Prüft                       |
| -------- | ---------------------- | --------------------------- |
| **0300** | Canvas-Anzahl begrenzt | test-memory.pdf (50 Seiten) |

## 🧪 Test-Dateien

Die Tests verwenden automatisch erstellte PDF-Dateien:

- **test-small.pdf**: 3 Seiten für Basis-Tests (0010-0101)
- **test-large.pdf**: 25 Seiten für Pagination (0200)
- **test-memory.pdf**: 50 Seiten für Memory-Tests (0300)

## ✅ Erfolgs-Kriterien

**ALLE Tests müssen bestehen:**

- ✅ 0001: Keine Console-Fehler
- ✅ 0002: UI vollständig geladen
- ✅ 0003: Logger funktioniert
- ✅ 0004: Canvas-Pool entfernt
- ✅ 0010: PDF-Upload funktioniert
- ✅ 0011: PDF-Rendering funktioniert
- ✅ 0100: Target-PDF funktioniert
- ✅ 0101: **KEIN doppeltes Rendering**
- ✅ 0200: Pagination funktioniert
- ✅ 0300: Memory-Management funktioniert

## 🔍 Debug-Modus

```bash
npm run test:debug
```

Startet Tests im Debug-Modus mit Browser-Fenster.

## 📱 UI-Test-Runner

```bash
npm run test:ui
```

Startet Playwright UI für interaktive Tests.

- ✅ Keine Memory-Leaks bei Add/Remove-Zyklen
- ✅ Transformationen ohne doppeltes Rendering

### 5. Debug-Logs

- ✅ Logger-System funktioniert
- ✅ Keine kritischen Error-Logs
- ✅ Render-Log-Anzahl ist normal

## 🔧 Test-Dateien

### Test-PDFs erstellen

```bash
npm run create-test-files
```

Erstellt:

- `test-files/small-test.pdf` (2 Seiten)
- `test-files/medium-test.pdf` (10 Seiten)
- `test-files/large-test.pdf` (50 Seiten)

## 🎯 Verwendung

### Vor jeder Änderung

```bash
npm test
```

### Nach größeren Änderungen

```bash
npm run test:playwright
```

### Debug-Modus

```bash
npm run test:debug
```

## 📊 Test-Ergebnisse interpretieren

### ✅ Erfolg-Indikatoren

- Keine JavaScript-Fehler
- Logger-System verfügbar
- Canvas-Pool-System entfernt
- Render-Logs < 10 pro Test
- Memory-Verbrauch < 100MB Zunahme

### ❌ Problem-Indikatoren

- Console-Errors (außer Source-Map/Favicon)
- Doppelte Canvas-Elemente
- Übermäßige Render-Logs (>10)
- Memory-Leaks
- Canvas-Pool-Referenzen

### ⚠️ Warnungen ignorieren

- Source-Map-Fehler
- Favicon-404-Fehler
- webkit-text-size-adjust CSS-Warnungen

## 🐛 Debug-Hilfen

### Console-Logs anzeigen

Der Test-Runner zeigt automatisch:

- ❌ Error-Logs
- ⚠️ Warning-Logs mit ❌
- 📝 Debug-Logs mit 🎯/✅

### Browser sichtbar lassen

```bash
# Test-Runner läuft mit headless: false
npm test
```

### Playwright UI

```bash
npm run test:ui
```

## 🚀 Integration

Diese Tests können in CI/CD-Pipelines integriert werden und stellen sicher, dass:

1. Keine Regression beim Canvas-Pool-Entfernen
2. Performance bleibt stabil
3. Keine neuen Memory-Leaks entstehen
4. Debug-Logs bleiben sauber

## 🚫 PAGINATION ABHÄNGIGKEITEN

**WICHTIG**: Die folgenden Tests sind als `[ignore]` markiert und werden übersprungen:

- **Test 0403**: Memory Management große PDFs (50+ Seiten)
- **Test 0406**: Performance große PDFs (25+ Seiten)

**Grund**: Diese Tests benötigen ein Pagination-System für große PDFs, das noch nicht implementiert ist.

**TODO**: Nach Implementierung der Pagination diese Tests reaktivieren:

```javascript
// Von test.skip zurück zu test ändern
test('0403 - Memory Management: Große PDFs verarbeiten', ...)
test('0406 - Performance: Viele Seiten gleichzeitig laden', ...)
```
