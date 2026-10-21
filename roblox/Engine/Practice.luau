-- Ported 1:1 from src/engine/practice.ts

local Rng = require(script.Parent.Rng)
local Car = require(script.Parent.Car)
local Tire = require(script.Parent.Tire)
local Damage = require(script.Parent.Damage)

local clamp = Rng.clamp

local Practice = {}

local function describeSetupHint(current, ideal, circuit)
	local dfDiff = ideal.downforce - current.downforce
	local balDiff = ideal.balance - current.balance
	local parts = {}
	if math.abs(dfDiff) < 0.5 and math.abs(balDiff) < 0.5 then
		return "Setup feels well balanced — minimal changes needed."
	end
	if dfDiff > 0 then
		parts[#parts + 1] = "add more downforce for the corners"
	elseif dfDiff < 0 then
		parts[#parts + 1] = "trim out some downforce for the straights"
	end
	if balDiff > 0 then
		parts[#parts + 1] = "the car is too pointy, add front stability"
	elseif balDiff < 0 then
		parts[#parts + 1] = "there is understeer, free up the front"
	end
	return "Engineers suggest: " .. table.concat(parts, "; ") .. ". (" .. circuit.name .. ")"
end

local function feedbackFor(driver, current, ideal, circuit)
	local err = Car.setupPenalty(current, circuit) - Car.setupPenalty(ideal, circuit)
	local mood = err < 0.15 and "happy" or (err < 0.6 and "broadly satisfied" or (err < 1.2 and "unhappy" or "very unhappy"))
	local note = driver.attributes.experience > 70 and "The car is consistent over a stint."
		or "Still learning the balance over a long run."
	return driver.name .. " is " .. mood .. " with the balance. " .. note
end

-- Simulate a practice session. Programs give different information: setup work
-- narrows the ideal setup, long runs reveal tyre degradation, quali sims reveal
-- one-lap pace, reliability checks surface mechanical concerns.
local function simulatePractice(rng, params)
	local circuit = params.circuit
	local weather = params.weather
	local session = params.session
	local specs = Tire.defaultTireSpecs(circuit)
	local ideal = Car.idealSetup(circuit)
	local entries = {}

	for _, e in ipairs(params.entrants) do
		local compound = weather.trackWetness > 0.6 and "wet"
			or (weather.trackWetness > 0.25 and "intermediate" or "medium")
		local tire = Tire.evaluateTire(specs[compound], 3, {
			trackWetness = weather.trackWetness,
			trackTempC = weather.trackTempC,
			driverTyreManagement = e.driver.attributes.tireManagement / 100,
			carTyreFriendliness = e.car.tireFriendliness / 100,
			circuit = circuit,
			push = "normal",
		})

		local base = Car.composeLapTime({
			circuit = circuit,
			car = e.car,
			driver = e.driver,
			blockTimeDelta = 0,
			tireDelta = tire.delta,
			fuelLaps = e.program == "quali-sim" and 3 or 30,
			fuelCapacityLaps = circuit.laps,
			setup = params.currentSetup,
			damage = Damage.initDamage(),
			noiseSeconds = rng:gaussian(0, 0.35),
			wetness = weather.trackWetness,
		})

		local bestLap = base + (e.program == "quali-sim" and -0.6 or 0.4)
		local s1 = bestLap * rng:range(0.3, 0.34)
		local s3 = bestLap * rng:range(0.28, 0.33)
		local s2 = bestLap - s1 - s3

		local longRunPace = e.program == "long-run" and (base + rng:range(0.4, 1.0)) or nil

		local tireWearPerLap = nil
		if e.program == "long-run" or e.program == "tire-test" then
			tireWearPerLap = clamp(
				specs[compound].degRate * (0.7 + circuit.tyreWear * 0.7) * (1.15 - e.driver.attributes.tireManagement / 300),
				0.01,
				0.2
			)
		end

		local setupHint = describeSetupHint(params.currentSetup, ideal, circuit)
		local reliabilityConcern = nil
		if e.program == "reliability" and rng:chance(clamp(0.35 - e.car.reliability / 300, 0.02, 0.4)) then
			reliabilityConcern = rng:pick({
				"Gearbox temperature running high",
				"Hydraulic pressure fluctuation detected",
				"Brake wear above expected",
				"Power unit running hot in traffic",
				"Suspension pick-up showing fatigue",
			})
		end

		entries[#entries + 1] = {
			driverId = e.driverId,
			bestLap = bestLap,
			sectorTimes = { s1, s2, s3 },
			longRunPace = longRunPace,
			tireWearPerLap = tireWearPerLap,
			fuelEffect = rng:range(0.02, 0.04),
			feedback = feedbackFor(e.driver, params.currentSetup, ideal, circuit),
			setupHint = setupHint,
			reliabilityConcern = reliabilityConcern,
		}
	end

	-- Setup work converges the suggestion toward ideal, faster with more sessions.
	local converge = clamp(0.35 + session * 0.15, 0, 1)
	local suggestedSetup = Car.convergeSetup(params.currentSetup, ideal, converge)

	return { session = session, weather = weather, entries = entries, suggestedSetup = suggestedSetup }
end

Practice.simulatePractice = simulatePractice

return Practice
