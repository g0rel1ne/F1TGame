import type { Circuit, Weather, WeatherState } from "./types";
import type { Rng } from "./rng";
import { clamp } from "./rng";

export function initialWeather(rng: Rng, circuit: Circuit): WeatherState {
  const roll = rng.next();
  const rainChance = circuit.rainChance;
  let condition: Weather = "dry";
  if (roll < rainChance * 0.18) condition = "heavy-rain";
  else if (roll < rainChance * 0.55) condition = "light-rain";
  else if (roll < rainChance * 0.55 + 0.3) condition = "cloudy";

  const intensity = condition === "heavy-rain" ? rng.range(0.6, 0.95) : condition === "light-rain" ? rng.range(0.15, 0.5) : 0;
  return {
    condition,
    intensity,
    trackWetness: condition === "heavy-rain" ? rng.range(0.5, 0.8) : condition === "light-rain" ? rng.range(0.15, 0.35) : 0,
    airTempC: rng.range(16, 34),
    trackTempC: rng.range(24, 48),
  };
}

export function conditionFromWetness(wetness: number): Weather {
  if (wetness > 0.62) return "heavy-rain";
  if (wetness > 0.22) return "light-rain";
  if (wetness > 0.08) return "cloudy";
  return "dry";
}

/**
 * Evolve weather one lap. Drying happens on a warm track; rain can arrive and
 * intensify. Damped random walk keeps it believable across a race distance.
 */
export function evolveWeather(rng: Rng, current: WeatherState, circuit: Circuit, _lap: number): WeatherState {
  let wetness = current.trackWetness;
  let intensity = current.intensity;

  const raining = current.condition === "light-rain" || current.condition === "heavy-rain";
  if (raining) {
    intensity = clamp(intensity + rng.gaussian(-0.05, 0.14), 0.1, 1);
    wetness = clamp(wetness + intensity * 0.06 + rng.gaussian(0, 0.02), 0, 1);
  } else {
    // Drying: faster when the track is hot and dry overhead.
    const dryRate = 0.02 + (current.trackTempC / 100) * 0.04;
    wetness = clamp(wetness - dryRate + rng.gaussian(0, 0.015), 0, 1);
    // Chance of rain arriving.
    if (rng.chance(circuit.rainChance * 0.03)) {
      intensity = rng.range(0.2, 0.7);
      wetness = clamp(wetness + 0.12, 0, 1);
    }
  }

  return {
    condition: conditionFromWetness(wetness),
    intensity: raining ? intensity : 0,
    trackWetness: wetness,
    airTempC: clamp(current.airTempC + rng.gaussian(0, 0.4), 8, 45),
    trackTempC: clamp(current.trackTempC + rng.gaussian(-0.2, 0.8) - (wetness > 0.2 ? 0.3 : 0), 10, 60),
  };
}
