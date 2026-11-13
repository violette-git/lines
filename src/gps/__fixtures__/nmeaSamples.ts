// Real-world style NMEA sentences with correct checksums (classic NMEA reference examples plus
// Emlid-style multi-constellation RTK output near Birmingham, AL).
export const NMEA = {
  /** Classic reference GGA (Munich), standalone GPS. */
  ggaClassic: '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47',
  rmcClassic: '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A',
  /** GN talker, RTK fixed (quality 4), 24 sats, HDOP 0.6. */
  ggaRtkFixed: '$GNGGA,174203.00,3330.81612345,N,08648.38412345,W,4,24,0.6,182.345,M,-29.512,M,1.0,0000*61',
  /** RTK float (quality 5). */
  ggaRtkFloat: '$GNGGA,174204.00,3330.81612400,N,08648.38412300,W,5,22,0.7,182.410,M,-29.512,M,1.0,0000*60',
  /** sigma lat 0.008 m, sigma lon 0.009 m. */
  gst: '$GNGST,174203.00,0.012,0.009,0.007,45.2,0.008,0.009,0.017*73',
  gsa: '$GNGSA,A,3,02,05,12,13,15,18,20,25,29,,,,1.2,0.6,1.0,1*30',
  rmcRtk: '$GNRMC,174203.00,A,3330.81612345,N,08648.38412345,W,0.01,0.0,131126,,,R,V*0E',
  gnsRtk: '$GNGNS,174203.00,3330.81612345,N,08648.38412345,W,RRRN,24,0.6,182.345,-29.512,1.0,0000,V*28',
  ggaNoFix: '$GPGGA,174205.00,,,,,0,00,99.99,,,,,,*63',
  gsv: '$GPGSV,3,1,11,02,45,123,40,05,30,045,38,12,60,300,44,13,20,200,35*72',
};

/** 33 deg 30.81612345 min N, 86 deg 48.38412345 min W. */
export const BHM_RTK = { lat: 33 + 30.81612345 / 60, lng: -(86 + 48.38412345 / 60) };
