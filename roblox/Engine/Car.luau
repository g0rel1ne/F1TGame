-- Ported 1:1 from src/engine/car.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local Car = {}

Car.CAR_REFERENCE = 78
Car.CAR_TIME_SCALE = 0.00075

-- Apply installed upgrade points to the baseline car. Upgrades are additive
-- points; the mapping mirrors which subsystems each part actually influences.
local function effectiveCar(car)
	local installed = car.installed or {}
	local function p(a)
		return installed[a] or 0
	end
	local aeroPts = p("front-wing") + p("rear-wing") + p("floor") + p("sidepods")
	local mechPts = p("suspension") + p("chassis")

	return {
		aeroEfficiency = car.aeroEfficiency + aeroPts * 0.45,
		downforce = car.downforce + aeroPts * 0.62,
		-- Upgrades add downforce with a small drag penalty; efficient teams add less drag.
		drag = car.drag - aeroPts * 0.1,
		cornering = car.cornering + mechPts * 0.5 + aeroPts * 0.12,
		straightLine = car.straightLine + p("engine") * 0.7 + p("gearbox") * 0.2,
		braking = car.braking + p("brakes") * 0.85 + mechPts * 0.1,
		mechanicalGrip = car.mechanicalGrip + mechPts * 0.55,
		tireFriendliness = car.tireFriendliness + mechPts * 0.25,
		fuelEfficiency = car.fuelEfficiency + p("engine") * 0.45,
		reliability = car.reliability + p("reliability") * 0.8 + p("engine") * 0.1,
		cooling = car.cooling + p("cooling") * 0.9,
		wetPerformance = car.wetPerformance + aeroPts * 0.08,
		weight = math.max(680, car.weight - mechPts * 1.5 - aeroPts * 0.3),
	}
end

-- Circuit-weighted car performance index, roughly 0..100.
local function carPerformanceAtCircuit(car, circuit)
	local e = effectiveCar(car)
	local aero = e.aeroEfficiency * 0.5 + e.downforce * 0.5 - e.drag * 0.3
	local mech = e.mechanicalGrip * 0.6 + e.cornering * 0.25 + e.braking * 0.15
	local power = e.straightLine * 0.85 + e.fuelEfficiency * 0.15

	local wA = clamp(circuit.aeroDemand, 0.05, 0.9)
	local wT = clamp(circuit.tractionDemand, 0.05, 0.9)
	local wB = clamp(circuit.brakingDemand, 0.05, 0.9)
	local wP = clamp(1.4 - wA - wT - wB, 0.15, 0.7)

	local total = wA + wT + wB + wP
	return (aero * wA + mech * wT + e.braking * wB + power * wP) / total
end

Car.SETUP_RANGES = {
	frontWing = { min = 0, max = 10, step = 1 },
	rearWing = { min = 0, max = 10, step = 1 },
	rideHeight = { min = 0, max = 10, step = 1 },
	brakeBias = { min = 50, max = 70, step = 1 },
	differential = { min = 0, max = 10, step = 1 },
}

-- Neutral baseline used when no detailed setup has been chosen yet.
Car.NEUTRAL_SETUP = {
	downforce = 3,
	balance = 0,
	frontWing = 5,
	rearWing = 5,
	rideHeight = 5,
	brakeBias = 58,
	differential = 5,
}

-- True when every mechanical part has an explicit value (the Garage model).
local function hasDetailedSetup(setup)
	return type(setup.frontWing) == "number"
		and type(setup.rearWing) == "number"
		and type(setup.rideHeight) == "number"
		and type(setup.brakeBias) == "number"
		and type(setup.differential) == "number"
end

-- Convert wing angles into the coarse downforce/balance axes the simulation
-- reasons about, so the detailed Garage model stays consistent with the
-- two-axis model used by qualifying, practice and the race engine.
local function deriveAxes(frontWing, rearWing)
	return {
		downforce = clamp(round(1 + (frontWing + rearWing) / 5), 1, 5),
		balance = clamp(round((frontWing - rearWing) / 2.5), -2, 2),
	}
end

-- Reverse of `deriveAxes`: pick wing angles for a coarse downforce/balance.
local function wingFromAxes(downforce, balance)
	local total = (clamp(downforce, 1, 5) - 1) * 5
	local diff = clamp(balance, -2, 2) * 2.5
	return {
		frontWing = clamp(round((total + diff) / 2), 0, 10),
		rearWing = clamp(round((total - diff) / 2), 0, 10),
	}
end

-- Clamp an arbitrary setup payload into legal ranges, discarding junk.
local function sanitizeSetup(raw)
	local function num(v, lo, hi, fallback)
		local n = tonumber(v)
		if n ~= nil and n == n and n ~= math.huge and n ~= -math.huge then
			return clamp(round(n), lo, hi)
		end
		return fallback
	end
	raw = raw or {}
	local detailed = raw.frontWing ~= nil
		or raw.rearWing ~= nil
		or raw.rideHeight ~= nil
		or raw.brakeBias ~= nil
		or raw.differential ~= nil
	local base = {
		downforce = num(raw.downforce, 1, 5, 3),
		balance = num(raw.balance, -2, 2, 0),
	}
	if not detailed then
		return base
	end
	local frontWing = num(raw.frontWing, 0, 10, 5)
	local rearWing = num(raw.rearWing, 0, 10, 5)
	local axes = deriveAxes(frontWing, rearWing)
	base.downforce = axes.downforce
	base.balance = axes.balance
	base.frontWing = frontWing
	base.rearWing = rearWing
	base.rideHeight = num(raw.rideHeight, 0, 10, 5)
	base.brakeBias = num(raw.brakeBias, 50, 70, 58)
	base.differential = num(raw.differential, 0, 10, 5)
	return base
end

-- The ideal setup a circuit rewards; practice feedback converges players onto it.
local function idealSetup(circuit)
	local aeroDemand = clamp(circuit.aeroDemand, 0, 1)
	local df = clamp(round(1 + 4 * aeroDemand), 1, 5)
	local bal = clamp(round((circuit.tractionDemand - 0.5) * 3), -2, 2)
	local totalWing = (df - 1) * 5
	local diff = bal * 2.5
	return {
		downforce = df,
		balance = bal,
		frontWing = clamp(round((totalWing + diff) / 2), 0, 10),
		rearWing = clamp(round((totalWing - diff) / 2), 0, 10),
		rideHeight = clamp(round(10 - aeroDemand * 8), 2, 9),
		brakeBias = clamp(round(54 + circuit.brakingDemand * 12), 50, 70),
		differential = clamp(round(3 + circuit.tractionDemand * 8), 0, 10),
	}
end

local RIDE_SECONDS = 0.8
local BRAKE_SECONDS = 0.5
local DIFF_SECONDS = 0.5

-- Penalty in seconds for a given setup at a circuit (0 == perfect).
local function setupPenalty(setup, circuit)
	local ideal = idealSetup(circuit)
	local axes = hasDetailedSetup(setup) and deriveAxes(setup.frontWing, setup.rearWing)
		or { downforce = setup.downforce, balance = setup.balance }

	local dfErr = math.abs(axes.downforce - ideal.downforce) / 4
	local balErr = math.abs(axes.balance - ideal.balance) / 4
	local penalty = dfErr * 1.6 + balErr * 1.1

	if hasDetailedSetup(setup) then
		penalty += (math.abs(setup.rideHeight - ideal.rideHeight) / 10) * RIDE_SECONDS
		penalty += (math.abs(setup.brakeBias - ideal.brakeBias) / 20) * BRAKE_SECONDS
		penalty += (math.abs(setup.differential - ideal.differential) / 10) * DIFF_SECONDS
	end
	return penalty
end

-- Per-part contribution to the setup penalty, for the Garage read-out.
local function setupBreakdown(setup, circuit)
	local ideal = idealSetup(circuit)
	local wings = hasDetailedSetup(setup) and { frontWing = setup.frontWing, rearWing = setup.rearWing }
		or wingFromAxes(setup.downforce, setup.balance)
	local axes = deriveAxes(wings.frontWing, wings.rearWing)
	local rideHeight = setup.rideHeight or ideal.rideHeight
	local brakeBias = setup.brakeBias or ideal.brakeBias
	local differential = setup.differential or ideal.differential

	local rows = {
		{ part = "aero", label = "Aero load", value = axes.downforce, ideal = ideal.downforce, seconds = (math.abs(axes.downforce - ideal.downforce) / 4) * 1.6 },
		{ part = "aero", label = "Aero balance", value = axes.balance, ideal = ideal.balance, seconds = (math.abs(axes.balance - ideal.balance) / 4) * 1.1 },
		{ part = "rideHeight", label = "Ride height", value = rideHeight, ideal = ideal.rideHeight, seconds = (math.abs(rideHeight - ideal.rideHeight) / 10) * RIDE_SECONDS },
		{ part = "brakeBias", label = "Brake bias", value = brakeBias, ideal = ideal.brakeBias, seconds = (math.abs(brakeBias - ideal.brakeBias) / 20) * BRAKE_SECONDS },
		{ part = "differential", label = "Differential", value = differential, ideal = ideal.differential, seconds = (math.abs(differential - ideal.differential) / 10) * DIFF_SECONDS },
	}
	local total = 0
	for _, r in ipairs(rows) do
		total += r.seconds
	end
	return { rows = rows, total = total, ideal = ideal }
end

-- Move a setup partway toward the ideal, preserving the detailed parts when present.
local function convergeSetup(prev, ideal, blend)
	local r = clamp(blend, 0, 1)
	local function mix(a, b)
		return a + (b - a) * r
	end
	local out = {
		downforce = round(mix(prev.downforce, ideal.downforce)),
		balance = round(mix(prev.balance, ideal.balance)),
	}
	if hasDetailedSetup(prev) and hasDetailedSetup(ideal) then
		local frontWing = round(mix(prev.frontWing, ideal.frontWing))
		local rearWing = round(mix(prev.rearWing, ideal.rearWing))
		local axes = deriveAxes(frontWing, rearWing)
		out.downforce = axes.downforce
		out.balance = axes.balance
		out.frontWing = frontWing
		out.rearWing = rearWing
		out.rideHeight = round(mix(prev.rideHeight, ideal.rideHeight))
		out.brakeBias = round(mix(prev.brakeBias, ideal.brakeBias))
		out.differential = round(mix(prev.differential, ideal.differential))
	end
	return out
end

-- Additional lap-time penalty from accumulated damage.
local function damagePenalty(damage, circuit)
	local aero = (damage.frontWing * 1.4 + damage.rearWing * 1.1 + damage.floor * 1.0 + damage.sidepod * 0.4) * (0.6 + circuit.aeroDemand)
	local mech = (damage.suspension * 1.5 + damage.steering * 1.3 + damage.brakes * 0.8) * (0.6 + circuit.tractionDemand)
	local power = damage.engine * 1.6 + damage.gearbox * 0.8
	local tire = damage.tire * 3.0
	return aero + mech + power + tire
end

-- Full dry-weather lap-time composition for one car+driver at one circuit.
local function composeLapTime(params)
	local perf = carPerformanceAtCircuit(params.car, params.circuit)
	local e = effectiveCar(params.car)

	local carDelta = (perf - Car.CAR_REFERENCE) * Car.CAR_TIME_SCALE * params.circuit.referenceLapSeconds

	-- Driver pace: 0..100 mapped so ~80 is reference.
	local paceSkill = params.driver.attributes.pace * 0.62
		+ params.driver.attributes.racecraft * 0.18
		+ params.driver.attributes.consistency * 0.2
	local driverDelta = (paceSkill - 80) * 0.00042 * params.circuit.referenceLapSeconds

	-- Wet performance blends driver wet skill and car wet performance.
	local wetPenaltyBase = 0
	if params.wetness > 0.15 then
		wetPenaltyBase = (1 - (params.driver.attributes.wet / 100) * e.wetPerformance / 100) * params.wetness * 4.0
	end

	local fuelKg = params.fuelLaps * 1.7
	local fuelPenalty = fuelKg * 0.03 * (1.05 - e.fuelEfficiency / 400)

	local lapTime = params.circuit.referenceLapSeconds
		- carDelta
		- driverDelta
		+ params.tireDelta
		+ params.blockTimeDelta
		+ fuelPenalty
		+ setupPenalty(params.setup, params.circuit)
		+ damagePenalty(params.damage, params.circuit)
		+ wetPenaltyBase
		+ params.noiseSeconds

	return lapTime
end

Car.effectiveCar = effectiveCar
Car.carPerformanceAtCircuit = carPerformanceAtCircuit
Car.hasDetailedSetup = hasDetailedSetup
Car.deriveAxes = deriveAxes
Car.wingFromAxes = wingFromAxes
Car.sanitizeSetup = sanitizeSetup
Car.idealSetup = idealSetup
Car.setupPenalty = setupPenalty
Car.setupBreakdown = setupBreakdown
Car.convergeSetup = convergeSetup
Car.damagePenalty = damagePenalty
Car.composeLapTime = composeLapTime

return Car
