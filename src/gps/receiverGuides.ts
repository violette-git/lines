// Plain-language "How to connect your receiver" guidance, shown on the GPS receiver screen.
// Keep in step with docs/GPS_RECEIVERS.md.

export interface ReceiverGuide {
  id: string;
  title: string;
  models: string;
  steps: { heading: string; items: string[] }[];
  note?: string;
}

export const ENABLE_DEVELOPER_OPTIONS =
  'Android developer options: Settings > About phone > tap "Build number" 7 times. Then Settings > System > Developer options > "Select mock location app".';

export const RECEIVER_GUIDES: ReceiverGuide[] = [
  {
    id: 'emlid',
    title: 'Emlid Reach',
    models: 'Reach RX, RS2+, RS3, RS4',
    steps: [
      {
        heading: 'Over Wi-Fi (Android and iPhone)',
        items: [
          'In Emlid Flow, open Position streaming, choose TCP, set it as the server, format NMEA, and note the port number.',
          'Turn on the GGA and GST messages (GST gives LineMap Pro the real accuracy).',
          'Join the phone to the Reach hotspot (the Reach is then usually at 192.168.42.1), or put both on the same Wi-Fi or phone hotspot and use the Reach IP address that Emlid Flow shows.',
          'Here: choose "Receiver over Wi-Fi", enter the address and port, tap Save and connect.',
        ],
      },
      {
        heading: 'Through phone location (Android only)',
        items: [
          'In Emlid Flow, set Position streaming to Bluetooth, format NMEA, and pair the Reach with the phone.',
          'Install Lefebure NTRIP Client. Set Receiver Connection to "External via Bluetooth", pick the Reach, turn on "GPS Mock Locations", tap Connect.',
          'In Developer options, set "Select mock location app" to Lefebure NTRIP Client.',
          'Here: choose "Phone location".',
        ],
      },
    ],
    note: 'If Emlid Flow already applies the antenna height or tilt compensation, leave the antenna height here blank so it is not subtracted twice.',
  },
  {
    id: 'trimble',
    title: 'Trimble',
    models: 'R1, R2, DA2 / Catalyst',
    steps: [
      {
        heading: 'Android',
        items: [
          'Connect the receiver in Trimble Mobile Manager and set up corrections there.',
          'In Developer options, set "Select mock location app" to Trimble Mobile Manager.',
          'Turn off battery optimization for Trimble Mobile Manager so Android does not put it to sleep.',
          'Here: choose "Phone location".',
        ],
      },
      {
        heading: 'iPhone and iPad',
        items: [
          'Connect the receiver in Trimble Mobile Manager. It shares positions with iOS location services.',
          'Set the output transformation to Off in Trimble Mobile Manager.',
          'Here: choose "Phone location".',
        ],
      },
    ],
    note: 'On iOS the system never reports accuracy better than about 5 m, even when the receiver is in RTK. LineMap Pro then shows GPS, not RTK FIX, and "Require RTK fixed" will always warn. Trust the RTK status in Trimble Mobile Manager.',
  },
  {
    id: 'eos',
    title: 'Eos Arrow',
    models: 'Arrow 100, Arrow Gold, Arrow Lite',
    steps: [
      {
        heading: 'Android',
        items: [
          'Pair the Arrow over Bluetooth, open Eos Tools Pro and pick the Arrow.',
          'In the Eos Tools Pro menu (three dots), turn on "Replace Device Location".',
          'In Developer options, set "Select mock location app" to Eos Tools Pro. Eos Tools Pro should say "Mock location is on".',
          'Here: choose "Phone location".',
        ],
      },
      {
        heading: 'iPhone and iPad',
        items: [
          'Pair the Arrow in iOS Settings > Bluetooth and set up corrections in Eos Tools Pro.',
          'iOS location services then use the Arrow for every app. Here: choose "Phone location".',
        ],
      },
    ],
    note: 'On iOS the reported accuracy may be capped, so LineMap Pro may show GPS while the receiver is in RTK. Check the RTK status in Eos Tools Pro.',
  },
  {
    id: 'badelf',
    title: 'Bad Elf',
    models: 'Flex, Flex Mini',
    steps: [
      {
        heading: 'iPhone and iPad',
        items: [
          'Pair the Bad Elf and set up corrections in the Bad Elf Flex app.',
          'iOS location services then use the Bad Elf. Here: choose "Phone location".',
        ],
      },
      {
        heading: 'Android',
        items: [
          'Pair the Bad Elf over Bluetooth and connect it in an app that offers mock location (for example "Bluetooth GPS").',
          'In Developer options, set "Select mock location app" to that app.',
          'Here: choose "Phone location".',
        ],
      },
    ],
  },
  {
    id: 'other',
    title: 'Other receivers',
    models: 'Any receiver that serves NMEA 0183 over TCP',
    steps: [
      {
        heading: 'Over Wi-Fi',
        items: [
          'Set the receiver (or its bridge app) to serve NMEA as a TCP server on a port of your choice.',
          'Turn on GGA (required) and GST (recommended). RMC, GSA and GNS are also understood. GP and GN talkers both work.',
          'Here: choose "Receiver over Wi-Fi", enter its IP address and port, tap Save and connect.',
        ],
      },
      {
        heading: 'Through phone location (Android)',
        items: ['Use any app that turns the receiver into a mock location provider, and pick it in Developer options.'],
      },
    ],
  },
];

export interface HostPreset {
  id: string;
  label: string;
  host: string;
  /** Null when the vendor default is not documented: the user enters the port set in the vendor app. */
  port: number | null;
  hint: string;
}

export const HOST_PRESETS: HostPreset[] = [
  {
    id: 'emlid-hotspot',
    label: 'Emlid Reach hotspot',
    host: '192.168.42.1',
    port: null,
    hint: 'Enter the port you chose in Emlid Flow > Position streaming (TCP server).',
  },
];
