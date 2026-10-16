# ARACHNE · app

Android-app voor de zespotige robot **[ARACHNE-18](https://github.com/KVR-CIBER/arachne-18)**. Ze zoekt de spin vanzelf op het wifi-netwerk, opent een cockpit met camera en 3D-beeld, en luistert naar **"hey spin"**.

Gebouwd met [Capacitor 8](https://capacitorjs.com/). De interface is gewone HTML/JS in [`www/`](www/), Android-specifieke delen staan in [`android/`](android/).

## Wat ze doet

| | |
|---|---|
| **Robot zoeken** | Probeert eerst bekende adressen (`spin.local`, het laatst gebruikte), en scant daarna het hele /24-subnet van je gsm op poort 5870 (`/app/info`). Je kunt ook zelf een adres ingeven. |
| **Cockpit** | Camerabeeld en 3D-tweeling als beeld-in-beeld (tik om te wisselen), aanraaksticks, alle bewegingen, schuifregelaars. Gemaakt voor een tablet (OnePlus Pad 2). |
| **Live twin + simulatie** | Opent de live 3D-tweeling of de MuJoCo-simulatie van de robot. |
| **Controller** | Werkt met een gamepad (bv. Turtle Beach Recon): linkerstick lopen, rechterstick draaien, A opstaan, B liggen, X dansen… |
| **Spraak** | Altijd luisteren naar "hey spin" (Android SpeechRecognizer, Vlaamse stem terug). Vaste Nederlandse commando's werken offline: dans, kom naar mij, draai om, hoeveel volt… Draaien en lopen gebeuren gesloten-lus met de gemeten hoek en afstand. |
| **Vrije vragen (optioneel)** | Met een eigen Claude API-sleutel in de instellingen kun je de spin ook vrije vragen stellen. De sleutel blijft op je toestel en staat **niet** in deze repo. |
| **Scherm aan** | Het scherm blijft aan tijdens het besturen, en de B-knop van de controller werkt niet als "terug". |

## Bouwen

```bash
npm install
npx cap sync android
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Hoe het samenhangt

```
gsm/tablet (deze app)  ──wifi──▶  Raspberry Pi 4 op de spin
                                   ├─ live_twin.py   :5870  (3D-tweeling, camera, /app/info)
                                   └─ gamepad_robot.py :5871 (veilige bewegingen naar 18× STS3215)
```

De robotkant (twin-server, cockpit, simulatie, firmware) staat in [arachne-18](https://github.com/KVR-CIBER/arachne-18).

## Gemaakt met Claude Code

Gebouwd door Kobe samen met [Claude Code](https://claude.com/claude-code).
