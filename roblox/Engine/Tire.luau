-- Ported 1:1 from src/engine/tire.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local PUSH_FACTOR = { conserve = 0.78, normal = 1, push = 1.18 }

local Tire = {}

local function defaultTireSpecs(circuit)
	local wearScale = 0.7 + circuit.tyreWear * 0.7
	return {
		soft = { compound = "soft", offset = -0.55, degRate = 0.055 * wearScale, lifeLaps = round(16 / wearScale), drySuitability = 1 },
		medium = { compound = "medium", offset = 0, degRate = 0.036 * wearScale, lifeLaps = round(25 / wearScale), drySuitability = 1 },
		hard = { compound = "hard", offset = 0.5, degRate = 0.024 * wearScale, lifeLaps = round(34 / wearScale), drySuitability = 1 },
		intermediate = { compound = "intermediate", offset = 3.5, degRate = 0.06 * wearScale, lifeLaps = round(20 / wearScale), drySuitability = 0.35 },
		wet = { compound = "wet", offset = 8.0, degRate = 0.07 * wearScale, lifeLaps = round(24 / wearScale), drySuitability = 0.05 },
	}
end

-- Lap-time delta (seconds) and grip factor (0..1) for a tyre at a given age.
-- Positive delta == slower. Grip factor multiplies cornering/overtaking ability.
local function evaluateTire(spec, age, env)
	local wearScale = (0.75 + env.circuit.tyreWear * 0.6)
		* (1.18 - env.driverTyreManagement * 0.3)
		* (1.12 - env.carTyreFriendliness * 0.22)
		* PUSH_FACTOR[env.push]

	local effectiveAge = age * wearScale

	-- Base deg accumulates linearly, then a cliff past the usable life.
	local deg = spec.degRate * effectiveAge
	if effectiveAge > spec.lifeLaps then
		deg = deg + (effectiveAge - spec.lifeLaps) * spec.degRate * 2.2
	end

	-- Temperature window: soft hates excessive heat, all tyres suffer cold graining.
	local tempDelta = clamp(math.abs(env.trackTempC - 38) / 40, 0, 1)

	-- Wetness interaction. Slicks lose huge grip in the wet, wets lose grip when dry.
	local wet = env.trackWetness
	local wetDelta
	if spec.drySuitability > 0.9 then
		wetDelta = (wet ^ 1.4) * 7.5 -- slicks in the wet
	elseif spec.compound == "intermediate" then
		wetDelta = math.abs(wet - 0.5) * 6.0 - 1.5 -- best around 0.5 wetness
	else
		wetDelta = math.abs(wet - 0.95) * 7.0 -- full wets need a wet track
	end

	local delta = spec.offset + deg + tempDelta * 0.4 + math.max(0, wetDelta)
	local gripFactor = clamp(1 - deg * 0.045 - tempDelta * 0.03 - math.max(0, wetDelta) * 0.03, 0.55, 1.02)
	return { delta = delta, gripFactor = gripFactor }
end

-- Whether a compound is legal to start a dry race on (top-10 qualifiers rule).
local function isSlick(compound)
	return compound == "soft" or compound == "medium" or compound == "hard"
end

Tire.defaultTireSpecs = defaultTireSpecs
Tire.evaluateTire = evaluateTire
Tire.isSlick = isSlick

return Tire
