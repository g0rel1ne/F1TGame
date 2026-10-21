-- Ported 1:1 from src/engine/qualifying.ts
-- Q1/Q2/Q3 knockout qualifying. Elimination counts come from the ruleset; a
-- ruleset with zero eliminations produces a single-shot session. Sorts are made
-- stable to match JavaScript's Array.prototype.sort.

local Rng = require(script.Parent.Rng)
local Car = require(script.Parent.Car)
local Tire = require(script.Parent.Tire)
local Damage = require(script.Parent.Damage)

local Qualifying = {}

local function qualiLap(rng, e, opts)
	local specs = Tire.defaultTireSpecs(opts.circuit)
	local compound = opts.weather.trackWetness > 0.6 and "wet"
		or (opts.weather.trackWetness > 0.25 and "intermediate" or "soft")
	local tire = Tire.evaluateTire(specs[compound], 1, {
		trackWetness = opts.weather.trackWetness,
		trackTempC = opts.weather.trackTempC,
		driverTyreManagement = e.driver.attributes.tireManagement / 100,
		carTyreFriendliness = e.car.tireFriendliness / 100,
		circuit = opts.circuit,
		push = "push",
	})

	-- Qualifying skill is a larger share than race pace.
	local qSkill = e.driver.attributes.qualifying * 0.6 + e.driver.attributes.pace * 0.4
	local qDelta = (qSkill - 80) * 0.0005 * opts.circuit.referenceLapSeconds

	local blockTime = rng:chance(0.16) and rng:range(0.15, 0.55) or 0

	local time = Car.composeLapTime({
		circuit = opts.circuit,
		car = e.car,
		driver = e.driver,
		blockTimeDelta = blockTime,
		tireDelta = tire.delta,
		fuelLaps = 3,
		fuelCapacityLaps = opts.circuit.laps,
		setup = opts.setupFor(e.teamId),
		damage = Damage.initDamage(),
		noiseSeconds = rng:gaussian(0, 0.18),
		wetness = opts.weather.trackWetness,
	}) - qDelta

	return time
end

local function slice(list, from, to)
	local out = {}
	for i = from, to do
		if list[i] ~= nil then
			out[#out + 1] = list[i]
		end
	end
	return out
end

local function simulateQualifying(rng, opts)
	local weather = opts.weather
	local ruleset = opts.ruleset
	local rows = {}
	local order = {}
	for _, e in ipairs(opts.entries) do
		rows[e.driverId] = {
			position = 0,
			driverId = e.driverId,
			teamId = e.teamId,
			q1 = nil,
			q2 = nil,
			q3 = nil,
			best = nil,
			eliminated = "none",
		}
		order[#order + 1] = e.driverId
	end

	local function bestOf(id)
		return rows[id].best or math.huge
	end

	local function byBest(ids)
		local indexed = {}
		for i, id in ipairs(ids) do
			indexed[i] = { id = id, i = i }
		end
		table.sort(indexed, function(a, b)
			local ta, tb = bestOf(a.id), bestOf(b.id)
			if ta ~= tb then
				return ta < tb
			end
			return a.i < b.i
		end)
		local out = {}
		for i, e in ipairs(indexed) do
			out[i] = e.id
		end
		return out
	end

	local function findEntry(id)
		for _, x in ipairs(opts.entries) do
			if x.driverId == id then
				return x
			end
		end
		return nil
	end

	local function setSession(ids, key)
		for _, id in ipairs(ids) do
			local e = findEntry(id)
			-- Two attempts, take the best.
			local t1 = qualiLap(rng, e, opts)
			local t2 = qualiLap(rng, e, opts)
			local t = math.min(t1, t2)
			local row = rows[id]
			row[key] = t
			row.best = row.best == nil and t or math.min(row.best, t)
		end
	end

	local remaining = slice(order, 1, #order)

	local singleShot = ruleset.q1Eliminated + ruleset.q2Eliminated == 0

	if singleShot then
		setSession(remaining, "q1")
		remaining = byBest(remaining)
	else
		-- Q1
		setSession(remaining, "q1")
		local ord = byBest(remaining)
		local n = #ord
		local q1Out = slice(ord, n - ruleset.q1Eliminated + 1, n)
		for _, id in ipairs(q1Out) do
			rows[id].eliminated = "q1"
		end
		remaining = slice(ord, 1, n - ruleset.q1Eliminated)

		-- Q2
		setSession(remaining, "q2")
		ord = byBest(remaining)
		n = #ord
		local q2Out = slice(ord, n - ruleset.q2Eliminated + 1, n)
		for _, id in ipairs(q2Out) do
			rows[id].eliminated = "q2"
		end
		remaining = slice(ord, 1, n - ruleset.q2Eliminated)

		-- Q3
		setSession(remaining, "q3")
		remaining = byBest(remaining)
	end

	-- Final ordering: classified drivers by best time; eliminated by their best.
	local all = byBest(order)
	for i, id in ipairs(all) do
		rows[id].position = i
	end

	local out = {}
	for _, id in ipairs(order) do
		out[#out + 1] = rows[id]
	end
	table.sort(out, function(a, b)
		return a.position < b.position
	end)

	return out
end

local function defaultSetup()
	return { downforce = 3, balance = 0 }
end

Qualifying.qualiLap = qualiLap
Qualifying.simulateQualifying = simulateQualifying
Qualifying.defaultSetup = defaultSetup
Qualifying.idealSetup = Car.idealSetup

return Qualifying
