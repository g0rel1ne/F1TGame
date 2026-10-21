-- Ported 1:1 from src/engine/weather.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp

local Weather = {}

local function initialWeather(rng, circuit)
	local roll = rng:next()
	local rainChance = circuit.rainChance
	local condition = "dry"
	if roll < rainChance * 0.18 then
		condition = "heavy-rain"
	elseif roll < rainChance * 0.55 then
		condition = "light-rain"
	elseif roll < rainChance * 0.55 + 0.3 then
		condition = "cloudy"
	end

	local intensity = condition == "heavy-rain" and rng:range(0.6, 0.95)
		or (condition == "light-rain" and rng:range(0.15, 0.5) or 0)
	return {
		condition = condition,
		intensity = intensity,
		trackWetness = condition == "heavy-rain" and rng:range(0.5, 0.8)
			or (condition == "light-rain" and rng:range(0.15, 0.35) or 0),
		airTempC = rng:range(16, 34),
		trackTempC = rng:range(24, 48),
	}
end

local function conditionFromWetness(wetness)
	if wetness > 0.62 then
		return "heavy-rain"
	end
	if wetness > 0.22 then
		return "light-rain"
	end
	if wetness > 0.08 then
		return "cloudy"
	end
	return "dry"
end

-- Evolve weather one lap. Drying happens on a warm track; rain can arrive and
-- intensify. Damped random walk keeps it believable across a race distance.
local function evolveWeather(rng, current, circuit, _lap)
	local wetness = current.trackWetness
	local intensity = current.intensity

	local raining = current.condition == "light-rain" or current.condition == "heavy-rain"
	if raining then
		intensity = clamp(intensity + rng:gaussian(-0.05, 0.14), 0.1, 1)
		wetness = clamp(wetness + intensity * 0.06 + rng:gaussian(0, 0.02), 0, 1)
	else
		-- Drying: faster when the track is hot and dry overhead.
		local dryRate = 0.02 + (current.trackTempC / 100) * 0.04
		wetness = clamp(wetness - dryRate + rng:gaussian(0, 0.015), 0, 1)
		-- Chance of rain arriving.
		if rng:chance(circuit.rainChance * 0.03) then
			intensity = rng:range(0.2, 0.7)
			wetness = clamp(wetness + 0.12, 0, 1)
		end
	end

	return {
		condition = conditionFromWetness(wetness),
		intensity = raining and intensity or 0,
		trackWetness = wetness,
		airTempC = clamp(current.airTempC + rng:gaussian(0, 0.4), 8, 45),
		trackTempC = clamp(current.trackTempC + rng:gaussian(-0.2, 0.8) - (wetness > 0.2 and 0.3 or 0), 10, 60),
	}
end

Weather.initialWeather = initialWeather
Weather.conditionFromWetness = conditionFromWetness
Weather.evolveWeather = evolveWeather

return Weather
