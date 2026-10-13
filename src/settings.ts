export interface Settings {
  radius: number;
  length: number;
  gravity: number;
  pressure: number;
  temperature: number;
  lapseRate: number;
  humidity: number;
  aerosol: number;
  aerosolRadius: number;
  cloudRadius: number;
  windowFraction: number;
  windowTransmission: number;
  lightMode: 'mirrors' | 'sun';
  sunAzimuth: number;
  sunElevation: number;
  mirrorTilt: number;
  mirrorReflectivity: number;
  solarPower: number;
  exposure: number;
  terrainHeight: number;
  surfaceHeating: number;
  evaporation: number;
  wind: number;
  timeScale: number;
  clouds: boolean;
  atmosphere: boolean;
  paused: boolean;
  diagnostic: 'natural' | 'transmission' | 'density' | 'cloud';
  quality: 'fast' | 'balanced' | 'high';
  view: 'valley' | 'axis' | 'overlook';
  seed: number;
}

export const defaults: Settings = {
  radius: 4, length: 24, gravity: 1, pressure: 1013.25,
  temperature: 20, lapseRate: 6.5, humidity: 45,
  aerosol: 0.006, aerosolRadius: 0.15, cloudRadius: 10,
  windowFraction: 0.45, windowTransmission: 0.9,
  lightMode: 'mirrors', sunAzimuth: 90, sunElevation: 90,
  mirrorTilt: 0, mirrorReflectivity: 0.9, solarPower: 1, exposure: 2.2,
  terrainHeight: 0.16, surfaceHeating: 0.018, evaporation: 0.000008,
  wind: 3, timeScale: 120, clouds: false, atmosphere: true, paused: false,
  diagnostic: 'natural', quality: 'balanced', view: 'valley', seed: 42
};

export const presets: Record<string, Partial<Settings>> = {
  'Clear daylight': { ...defaults, humidity: 45, clouds: false },
  'Humid afternoon': { ...defaults, humidity: 78, clouds: true },
  'Hazy habitat': { ...defaults, aerosol: 0.035, humidity: 65, clouds: false },
  'Small cylinder': { ...defaults, radius: 1, length: 8, terrainHeight: 0.035, clouds: false },
  'Giant cylinder': { ...defaults, radius: 12, length: 60, terrainHeight: 0.3, clouds: false },
  'Night': { ...defaults, solarPower: 0, surfaceHeating: 0, clouds: false },
  'Vacuum comparison': { ...defaults, pressure: 0, atmosphere: false, clouds: false }
};

export const weatherKeys: (keyof Settings)[] = [
  'radius', 'length', 'gravity', 'pressure', 'temperature', 'lapseRate',
  'humidity', 'surfaceHeating', 'evaporation', 'wind', 'seed', 'solarPower',
  'lightMode', 'sunAzimuth', 'sunElevation', 'mirrorTilt', 'windowFraction',
  'windowTransmission', 'mirrorReflectivity'
];
