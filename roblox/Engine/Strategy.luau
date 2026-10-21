-- Ported 1:1 from src/engine/strategy.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local Strategy = {}

local function indexOf(list, value)
	for i, v in ipairs(list) do
		if v == value then
			return i
		end
	end
	return -1
end

-- Choose a sensible default strategy (stops, compounds, pit windows).
local function defaultStrategy(totalLaps, circuit, ruleset, startCompound)
	local wet = startCompound == "wet" or startCompound == "intermediate"
	if wet then
		local stop = math.max(1, round(totalLaps / 2))
		return { compounds = { startCompound, startCompound }, pitLaps = { stop } }
	end

	local minStops = ruleset.mandatoryPitStop and 1 or 0
	local stops = clamp(round(circuit.tyreWear * 2 + totalLaps / 45), minStops, 3)
	local effectiveStops = math.max(stops, minStops)

	if effectiveStops <= 0 then
		return { compounds = { startCompound or "medium" }, pitLaps = {} }
	end

	local stint = math.floor(totalLaps / (effectiveStops + 1))
	local pitLaps = {}
	for i = 1, effectiveStops do
		pitLaps[#pitLaps + 1] = clamp(i * stint + (i == 1 and 1 or 0), 3, totalLaps - 3)
	end

	-- Compound ladder: soft -> medium -> hard, reversed when starting on softs.
	local ladder = { "soft", "medium", "hard" }
	local start = startCompound or (circuit.tyreWear > 0.65 and "medium" or (totalLaps < 40 and "soft" or "medium"))
	local startIndex = indexOf(ladder, start)
	local compounds = { start }
	for i = 1, effectiveStops do
		compounds[#compounds + 1] = ladder[math.min(startIndex + i, #ladder)]
	end

	return { compounds = compounds, pitLaps = pitLaps }
end

local function strategyForWeather(base, weather)
	if weather == "heavy-rain" then
		local pits = {}
		for i = 1, math.min(1, #base.pitLaps) do
			pits[i] = base.pitLaps[i]
		end
		return { compounds = { "wet", "wet" }, pitLaps = pits }
	end
	if weather == "light-rain" then
		local pits = {}
		for i = 1, math.min(1, #base.pitLaps) do
			pits[i] = base.pitLaps[i]
		end
		return { compounds = { "intermediate", "intermediate" }, pitLaps = pits }
	end
	return base
end

local function makeStrategyPlan(driverId, planned)
	return {
		driverId = driverId,
		compounds = planned.compounds,
		pitLaps = planned.pitLaps,
		pushLevel = "normal",
		risk = "medium",
	}
end

Strategy.defaultStrategy = defaultStrategy
Strategy.strategyForWeather = strategyForWeather
Strategy.makeStrategyPlan = makeStrategyPlan

return Strategy
