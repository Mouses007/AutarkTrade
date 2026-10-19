# Lizenzen der Anzeige-Firmware

Der Quelltext in diesem Verzeichnis steht unter der **MIT-Lizenz** (`LICENSE`), nicht
unter den Lizenzbedingungen von AutarkTrade. Grund: Die Firmware wird statisch mit dem
Arduino-ESP32-Core gelinkt, der Teile unter LGPL-2.1-or-later enthält. Wer die Firmware
bekommt, muss sie mit einer geänderten Fassung dieser Teile neu bauen können — mit dem
offenen Quelltext und `pio run` geht das.

| Bestandteil | Lizenz | Woher |
|---|---|---|
| Arduino-ESP32-Core (über PlatformIO `espressif32`) | LGPL-2.1-or-later (Print, WString, WiFi, WebServer, SPI u. a.), daneben Apache-2.0 (ESP-IDF) | <https://github.com/espressif/arduino-esp32> |
| TFT_eSPI (Bodmer) | FreeBSD, mit BSD- (Adafruit_GFX) und MIT-Teilen (Adafruit_ILI9341) | `lib_deps` |
| ArduinoJson (Benoît Blanchon) | MIT | `lib_deps` |


Die Lizenztexte der Bibliotheken liegen nach `pio run` unter `.pio/libdeps/*/<Bibliothek>/`
bzw. im Paketverzeichnis von PlatformIO. Werden fertige Firmware-Dateien weitergegeben,
gehören diese Texte und ein Hinweis auf diesen Quelltext dazu.
