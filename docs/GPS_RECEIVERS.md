# GPS receivers (RTK) with LineMap Pro

LineMap Pro works with the phone's own GPS (usually 3 to 10 m) and with high-precision GNSS receivers (1 to 2 cm with RTK). Open **Settings > GPS receiver** to choose how positions arrive.

## Two ways to connect

| | Phone location | Receiver over Wi-Fi (TCP) |
|---|---|---|
| How it works | The receiver's own app feeds the phone's location services (Android "mock location", or an iOS-certified accessory). LineMap Pro reads the phone location as usual. | LineMap Pro connects straight to the receiver on the local Wi-Fi or the receiver's hotspot and reads its NMEA position messages. |
| Fix quality (RTK FIX / FLOAT) | Estimated from the accuracy the phone reports: 5 cm or better shows RTK FIX, 50 cm or better shows RTK FLOAT (marked with *). | Reported by the receiver itself. |
| Satellites, HDOP | Not available | Shown live |
| Works on | Android and iOS, also in the web preview | Installed Android and iOS app only (not the web preview, not Expo Go) |
| Best for | Trimble, Eos, Bad Elf, Emlid on Android | Emlid Reach (any phone), any receiver that can serve NMEA over TCP |

Terms used here:

- **RTK** (real-time kinematic): the receiver uses corrections from a base station or network to reach centimeter accuracy.
- **RTK FIX**: corrections fully resolved, about 1 to 2 cm. This is what you want for mapping.
- **RTK FLOAT**: corrections not fully resolved yet, roughly 10 cm to 1 m. Wait a little longer in the open.
- **DGPS**: differential (SBAS or beacon) corrections, about 0.5 to 1.5 m.
- **GPS**: standalone, no corrections, several meters.
- **HDOP**: horizontal dilution of precision. Lower is better; under 1.0 is very good satellite geometry.
- **NMEA**: the standard text format receivers use to send positions.

## Setup by brand

Android developer options (needed for "Phone location" on Android): Settings > About phone > tap **Build number** 7 times. Then Settings > System > **Developer options** > **Select mock location app**.

### Emlid Reach (RX, RS2+, RS3, RS4)

Over Wi-Fi (Android and iPhone):

1. In Emlid Flow, open **Position streaming**, choose **TCP**, set it as the **server**, format **NMEA**, and note the port number.
2. Turn on the **GGA** and **GST** messages (GST gives LineMap Pro the real accuracy).
3. Join the phone to the Reach hotspot (the Reach is then usually at `192.168.42.1`), or put both on the same Wi-Fi or phone hotspot and use the Reach IP address that Emlid Flow shows.
4. In LineMap Pro choose **Receiver over Wi-Fi**, enter the address and port, tap **Save and connect**.

Emlid does not publish a default port for position streaming, so LineMap Pro leaves the port blank: use the one you set in Emlid Flow.

Through phone location (Android only):

1. In Emlid Flow, set Position streaming to **Bluetooth**, format **NMEA**, and pair the Reach with the phone.
2. Install **Lefebure NTRIP Client**. Set Receiver Connection to **External via Bluetooth**, pick the Reach, turn on **GPS Mock Locations**, tap **Connect**.
3. In Developer options, set **Select mock location app** to Lefebure NTRIP Client.
4. In LineMap Pro choose **Phone location**.

If Emlid Flow already applies the antenna height or tilt compensation, leave LineMap Pro's antenna height blank so it is not subtracted twice.

### Trimble (R1, R2, DA2 / Catalyst)

Android:

1. Connect the receiver in **Trimble Mobile Manager** and set up corrections there.
2. In Developer options, set **Select mock location app** to Trimble Mobile Manager.
3. Turn off battery optimization for Trimble Mobile Manager so Android does not put it to sleep.
4. In LineMap Pro choose **Phone location**.

iPhone and iPad:

1. Connect the receiver in Trimble Mobile Manager. It shares positions with iOS location services.
2. Set the output transformation to **Off** in Trimble Mobile Manager.
3. In LineMap Pro choose **Phone location**.

On iOS the system never reports accuracy better than about 5 m, even when the receiver is in RTK. LineMap Pro then shows GPS, not RTK FIX, and **Require RTK fixed** will always warn. Trust the RTK status in Trimble Mobile Manager.

### Eos Arrow (Arrow 100, Gold, Lite)

Android:

1. Pair the Arrow over Bluetooth, open **Eos Tools Pro** and pick the Arrow.
2. In the Eos Tools Pro menu (three dots), turn on **Replace Device Location**.
3. In Developer options, set **Select mock location app** to Eos Tools Pro. Eos Tools Pro should say "Mock location is on".
4. In LineMap Pro choose **Phone location**.

iPhone and iPad: pair the Arrow in iOS Settings > Bluetooth, set up corrections in Eos Tools Pro, then choose **Phone location**. The reported accuracy may be capped on iOS, so check the RTK status in Eos Tools Pro.

### Bad Elf (Flex, Flex Mini)

- iPhone and iPad: pair and set up corrections in the Bad Elf Flex app. iOS location services then use the Bad Elf. Choose **Phone location**.
- Android: pair over Bluetooth and connect it in an app that offers mock location (for example "Bluetooth GPS"), pick that app in Developer options, then choose **Phone location**.

### Other receivers

Any receiver (or bridge app) that can serve **NMEA 0183 as a TCP server** works over Wi-Fi. Turn on **GGA** (required) and **GST** (recommended). RMC, GSA and GNS are also understood; GP, GN, GL, GA and GB talkers all work.

## Antenna height

For **Receiver over Wi-Fi**, LineMap Pro subtracts the antenna height (entered in feet or meters, following your units) from the receiver altitude, so the saved altitude is the ground elevation above mean sea level. Measure from the ground mark to the antenna reference point the receiver app expects. Leave it blank when the receiver app already applies it or uses tilt compensation. For receivers that feed the phone, set the antenna height in the receiver's own app.

## Require RTK fixed

With **Require RTK fixed** on, the capture screen warns before a shot when the position is not RTK FIX, with a **Shoot anyway** option. The fix quality chip shows RTK FIX (green), RTK FLOAT (amber), DGPS or GPS (gray), or NO FIX (red), with accuracy (cm, or hundredths of a foot) and satellites.

## How positions are averaged

The capture screen keeps a rolling window of positions (Settings > GPS averaging seconds) and averages them when you press the shutter. With a receiver it uses only the best fix quality in the window: if any reading is RTK FIX, float and standalone readings are left out. When you walk to the next asset the old readings are dropped after 25 cm with RTK FIX (1 m with FLOAT, 6 m with phone GPS), so the average never smears between two poles.

## Accuracy shown

- From the receiver's GST message when available (the receiver's own error estimate).
- Otherwise HDOP multiplied by a typical error for the fix type: RTK FIX 1.5 cm, RTK FLOAT 30 cm, PPP 10 cm, DGPS 1 m, GPS 4 m. These are estimates; enable GST on the receiver for real values.

## Troubleshooting

| Symptom | What to check |
|---|---|
| "Not available in this build" | Receiver over Wi-Fi needs the installed app. Use the APK / TestFlight build, not the web preview or Expo Go. |
| Stuck on "Connecting..." or "Reconnecting" | Phone and receiver on the same network? Right IP and port? Position streaming set to TCP **server**, not client? |
| Android: connects only with mobile data off | The receiver hotspot has no internet, so Android prefers mobile data. LineMap Pro asks Android to use Wi-Fi for the receiver; if it still fails, turn mobile data off while connected, or tap "Stay connected" when Android asks about Wi-Fi without internet. |
| iPhone: never connects, no prompt | Settings > Privacy and Security > Local Network > turn on LineMap Pro. |
| "Connected, waiting for NMEA" | The receiver is not sending NMEA on that port. Check the format (NMEA, not LLH/ERB) and that GGA is enabled. |
| "No data (stale)" | The receiver stopped sending for 3 s. LineMap Pro drops and reconnects after 10 s by itself. Check receiver power and Wi-Fi range. |
| Bad checksums counted | Wrong port (binary data such as RTCM or UBX) or a noisy serial bridge. Pick the NMEA output port. |
| Shows GPS while the receiver says RTK FIX (phone location) | iOS caps reported accuracy; Android mock location apps sometimes report a fixed accuracy. Use Receiver over Wi-Fi if the receiver supports it. |
| RTK FLOAT for a long time | Corrections arriving? Check the base or NTRIP connection in the receiver app and the "Corrections age" in LineMap Pro (should be a few seconds). Move away from trees and buildings. |
| Altitude off by about the antenna height, or by 25 to 35 m | Antenna height entered twice (here and in the receiver app), or the receiver outputs ellipsoid height in GGA instead of mean sea level. Compare "Ground elevation" and "Ellipsoid height" on the status panel. |
| Position from the phone instead of the receiver | If the receiver is silent when you shoot, LineMap Pro falls back to phone GPS so the shot is not lost; the point then shows GPS, not RTK. Turn on Require RTK fixed to be warned. Recalibrate GPS never falls back: it shows an error instead. |
