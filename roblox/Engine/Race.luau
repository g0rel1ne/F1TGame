-- Ported 1:1 from src/engine/race.ts
-- The full lap-by-lap race simulator. All randomness flows through a single
-- race-seeded Rng so a saved race replays identically. Sorts are made stable to
-- match JavaScript's Array.prototype.sort.

local RngModule = require(script.Parent.Rng)
local Rng = RngModule.Rng
local clamp = RngModule.clamp
local round = RngModule.round
local hashSeed = RngModule.hashSeed

local Car = require(script.Parent.Car)
local Tire = require(script.Parent.Tire)
local Damage = require(script.Parent.Damage)
local Incidents = require(script.Parent.Incidents)
local Weather = require(script.Parent.Weather)
local DriverIq = require(script.Parent.DriverIq)

local Race = {}

-- Stable sort: preserve original order for equal keys (matches V8's sort).
local function stableSort(arr, less)
	local indexed = {}
	for i, v in ipairs(arr) do
		indexed[i] = { v = v, i = i }
	end
	table.sort(indexed, function(a, b)
		if less(a.v, b.v) then
			return true
		end
		if less(b.v, a.v) then
			return false
		end
		return a.i < b.i
	end)
	local out = {}
	for i, e in ipairs(indexed) do
		out[i] = e.v
	end
	return out
end

local function findCar(cars, driverId)
	for _, c in ipairs(cars) do
		if c.driverId == driverId then
			return c
		end
	end
	return nil
end

local function applyTraffic(rng, liveOrder, circuit, weather)
	local iqWeight = DriverIq.circuitIqWeight(circuit)
	for i = 2, #liveOrder do
		local attacker = liveOrder[i]
		local defender = liveOrder[i - 1]
		local gap = attacker.cumulativeTime - defender.cumulativeTime

		local drsAvailable = #circuit.drsZones > 0 and gap < 1.0 and weather.trackWetness < 0.35

		if gap < 1.4 then
			local atk = DriverIq.racerSkill(attacker.driver)
			local def = DriverIq.racerSkill(defender.driver)
			local paceAdvantage = defender.raw - attacker.raw -- positive => attacker faster
			-- Dirty-air penalty scales with how close and how aero-dependent the
			-- track is; a high-IQ driver manages the wash better.
			local dirty = (1.4 - gap) * 0.12 * (0.6 + circuit.aeroDemand) * (1.15 - atk.iq * 0.3)
			attacker.raw += dirty

			if paceAdvantage > 0.05 then
				local passScore = circuit.overtaking * 0.42
					+ atk.attack * 0.28
					+ (drsAvailable and 0.16 or 0)
					+ clamp(paceAdvantage * 0.15, 0, 0.15)
					+ (atk.iq - def.iq) * 0.12
					+ circuit.brakingDemand * atk.attack * 0.08 * iqWeight
					- def.defend * 0.16
				if rng:chance(clamp(passScore * 0.55, 0, 0.92)) then
					-- Pass succeeds: attacker keeps its pace, defender loses a little.
					defender.raw += rng:range(0.05, 0.3)
				else
					-- Held up behind.
					attacker.raw = defender.raw + rng:range(0.03, 0.25)
				end
			end
		end
	end
end

local function handlePits(rng, liveOrder, lap, totalLaps, weather, circuit, specs, underNeutralisation, addLoss)
	for _, c in ipairs(liveOrder) do
		if not c.retired then
			local planned = c.strategy.pitLaps[c.nextPitIndex + 1]
			local spec = specs[c.compound]
			local worn = c.tireAgeLaps > spec.lifeLaps * 1.05
			local wrongTires = (weather.trackWetness > 0.62 and Tire.isSlick(c.compound))
				or (weather.trackWetness < 0.18 and not Tire.isSlick(c.compound))
			local lapsLeft = totalLaps - lap
			local numCompounds = #c.strategy.compounds

			local plannedNow = planned ~= nil and lap >= planned and lapsLeft > 1 and c.nextPitIndex < numCompounds - 1
			local emergency = (worn or wrongTires) and lapsLeft > 1 and c.nextPitIndex < numCompounds - 1
			local aiWantsStop = emergency and rng:chance(0.5 + c.decisionSkill * 0.4)
			local shouldStop = plannedNow
				or aiWantsStop
				or (underNeutralisation and c.nextPitIndex < numCompounds - 1 and rng:chance(0.35 + c.decisionSkill * 0.3))

			if shouldStop then
				local nextCompound = c.strategy.compounds[math.min(c.nextPitIndex + 2, numCompounds)]
				if weather.trackWetness > 0.62 then
					nextCompound = "wet"
				elseif weather.trackWetness > 0.22 then
					nextCompound = "intermediate"
				elseif not Tire.isSlick(nextCompound) then
					nextCompound = "medium"
				end

				local pitLoss = circuit.pitLossSeconds * (underNeutralisation and 0.55 or 1)
					+ rng:gaussian(0, 1.2)
					+ c.driver.attributes.concentration * -0.01
				local stopTime = clamp(pitLoss, 14, 40)
				c.raw += stopTime
				addLoss(stopTime)

				c.compound = nextCompound
				c.tireAgeLaps = 0
				c.nextPitIndex += 1
				c.pitThisLap = true
			end
		end
	end
end

local function applyIncident(inc, cars, gridPenalties)
	for driverId, partial in pairs(inc.damage) do
		local c = findCar(cars, driverId)
		if c and not c.retired then
			c.damage = Damage.applyDamage(c.damage, partial)

			local terminal = Damage.isTerminal(c.damage)
			if inc.severity >= 4 or terminal then
				c.retired = true
				c.retiredReason = inc.severity >= 4 and (inc.kind .. " (" .. inc.corner .. ")") or terminal
			end
		end
	end

	if inc.penalty then
		local c = findCar(cars, inc.penalty.driverId)
		if c then
			local p = inc.penalty
			if p.type == "time" then
				c.penaltySeconds += p.seconds
			elseif p.type == "drive-through" then
				c.penaltySeconds += 20
			elseif p.type == "stop-go" then
				c.penaltySeconds += 10 + p.seconds
			elseif p.type == "grid" then
				gridPenalties[c.driverId] = (gridPenalties[c.driverId] or 0) + p.places
			end
		end
	end
end

local function simulateRace(opts)
	local rng = Rng.new(hashSeed(opts.seed .. ":" .. opts.raceId))
	local circuit = opts.circuit
	local totalLaps = opts.totalLaps
	local ruleset = opts.ruleset
	local specs = Tire.defaultTireSpecs(circuit)

	local cars = {}
	for _, e in ipairs(opts.entrants) do
		cars[#cars + 1] = {
			driverId = e.driverId,
			teamId = e.teamId,
			damage = Damage.initDamage(),
			compound = e.strategy.compounds[1] or "medium",
			tireAgeLaps = 0,
			fuelLaps = totalLaps,
			pitsMade = 0,
			penaltySeconds = 0,
			retired = false,
			retiredReason = nil,
			gapToLeader = 0,
			trackPosition = e.gridPosition,
			lastLapTime = nil,
			bestLapTime = nil,
			lapTimes = {},
			trackProgress = 0,
			outOfRace = false,
			car = e.car,
			driver = e.driver,
			strategy = e.strategy,
			setup = e.setup,
			decisionSkill = e.decisionSkill,
			raw = 0,
			pitThisLap = false,
			nextPitIndex = 0,
			cumulativeTime = 0,
			lapsCompleted = 0,
		}
	end
	cars = stableSort(cars, function(a, b)
		return a.trackPosition < b.trackPosition
	end)

	local incidents = {}
	local laps = {}
	local gridPenalties = {}

	local weather = opts.weatherStart
	local flag = "green"
	local neutralisedLaps = 0
	local safetyCarDeployments = 0
	local virtualSafetyCarPeriods = 0
	local redFlags = 0

	-- Formation lap: compress the field slightly.
	for _, c in ipairs(cars) do
		c.cumulativeTime = c.trackPosition * 0.7
	end

	local function envFor(c, push)
		return {
			trackWetness = weather.trackWetness,
			trackTempC = weather.trackTempC,
			driverTyreManagement = c.driver.attributes.tireManagement / 100,
			carTyreFriendliness = c.car.tireFriendliness / 100,
			circuit = circuit,
			push = push,
		}
	end

	local function running()
		local out = {}
		for _, c in ipairs(cars) do
			if not c.retired then
				out[#out + 1] = c
			end
		end
		return out
	end

	local function order()
		return stableSort(running(), function(a, b)
			return a.cumulativeTime < b.cumulativeTime
		end)
	end

	for lap = 1, totalLaps do
		weather = Weather.evolveWeather(rng, weather, circuit, lap)

		local neutralised = neutralisedLaps > 0
		local liveOrder = order()

		-- ---- Pace calculation --------------------------------------------
		for _, c in ipairs(liveOrder) do
			local tire = Tire.evaluateTire(specs[c.compound], c.tireAgeLaps, envFor(c, c.strategy.pushLevel))
			c.raw = Car.composeLapTime({
				circuit = circuit,
				car = c.car,
				driver = c.driver,
				blockTimeDelta = 0,
				tireDelta = tire.delta,
				fuelLaps = c.fuelLaps,
				fuelCapacityLaps = totalLaps,
				setup = c.setup,
				damage = c.damage,
				noiseSeconds = rng:gaussian(0, 0.22),
				wetness = weather.trackWetness,
			})
		end

		local lapPitLoss = 0

		if neutralised then
			-- No overtaking; bunched field. Red flag fully suspends lap times.
			local base = flag == "red-flag" and 0 or circuit.referenceLapSeconds * 1.5
			for i, c in ipairs(liveOrder) do
				c.raw = base
				if flag == "safety-car" then
					c.cumulativeTime = liveOrder[1].cumulativeTime + (i - 1) * 0.8
				elseif flag == "virtual-safety-car" then
					c.cumulativeTime += 0
				end
			end
		else
			applyTraffic(rng, liveOrder, circuit, weather)
			handlePits(rng, liveOrder, lap, totalLaps, weather, circuit, specs, false, function(loss)
				lapPitLoss += loss
			end)
		end

		if neutralised and (flag == "safety-car" or flag == "virtual-safety-car") then
			-- Opportunity stops still happen under neutralisation.
			handlePits(rng, liveOrder, lap, totalLaps, weather, circuit, specs, true, function(loss)
				lapPitLoss += loss
			end)
		end

		-- ---- Incidents ---------------------------------------------------
		local currentOrder = order()
		for idx, c in ipairs(currentOrder) do
			if not c.retired then
				local nearby = {}
				local from = math.max(1, idx - 2)
				local to = math.min(#currentOrder, idx + 2)
				for j = from, to do
					if j ~= idx then
						local other = currentOrder[j]
						local gap = other.cumulativeTime - c.cumulativeTime -- + means other is behind
						nearby[#nearby + 1] = {
							driverId = other.driverId,
							gap = -gap,
							aggression = other.driver.attributes.aggression,
							skill = clamp(other.decisionSkill * 0.5 + DriverIq.racerSkill(other.driver).iq * 0.5, 0, 1),
							defending = false,
						}
					end
				end

				local ctx = {
					driverId = c.driverId,
					driver = c.driver,
					carReliability = c.car.reliability,
					damage = c.damage,
					circuit = circuit,
					weather = weather,
					lap = lap,
					totalLaps = totalLaps,
					isFirstLap = lap == 1,
					isRestart = neutralisedLaps == 1,
					isPitEntry = c.pitThisLap,
					strategyRisk = c.strategy.risk,
					compound = c.compound,
					tireAge = c.tireAgeLaps,
					tireGrip = Tire.evaluateTire(specs[c.compound], c.tireAgeLaps, envFor(c, c.strategy.pushLevel)).gripFactor,
					fuelLaps = c.fuelLaps,
					nearby = nearby,
					severitySetting = opts.severitySetting,
					decisionSkill = clamp(c.decisionSkill * 0.45 + DriverIq.racerSkill(c.driver).iq * 0.55, 0, 1),
				}

				local inc = Incidents.generateIncident(rng, ctx, opts.raceId)
				if inc then
					incidents[#incidents + 1] = inc
					applyIncident(inc, cars, gridPenalties)
					if inc.neutralisation == "safety-car" and ruleset.safetyCars then
						flag = "safety-car"
						neutralisedLaps = math.max(neutralisedLaps, rng:int(3, 5))
						safetyCarDeployments += 1
					elseif inc.neutralisation == "virtual-safety-car" and ruleset.virtualSafetyCars then
						flag = "virtual-safety-car"
						neutralisedLaps = math.max(neutralisedLaps, rng:int(2, 3))
						virtualSafetyCarPeriods += 1
					elseif inc.neutralisation == "red-flag" and ruleset.redFlags then
						flag = "red-flag"
						neutralisedLaps = math.max(neutralisedLaps, rng:int(3, 6))
						redFlags += 1
					end
				end
			end
		end

		-- ---- Accumulate a lap --------------------------------------------
		local afterOrder = order()
		local pittedThisLap = {}
		for _, c in ipairs(afterOrder) do
			pittedThisLap[c.driverId] = c.pitThisLap
			if flag == "red-flag" then
				-- Suspended: no distance completed this lap.
				c.pitThisLap = false
			else
				c.cumulativeTime += c.raw + c.penaltySeconds
				c.penaltySeconds = 0
				c.lapsCompleted += 1
				c.lastLapTime = round(c.raw, 3)
				if c.bestLapTime == nil or c.raw < c.bestLapTime then
					c.bestLapTime = round(c.raw, 3)
				end
				table.insert(c.lapTimes, round(c.raw, 3))
				c.trackProgress = (lap / totalLaps) % 1
				if c.pitThisLap then
					c.pitsMade += 1
				end
				c.pitThisLap = false
				c.fuelLaps = math.max(0, c.fuelLaps - 1)
				c.tireAgeLaps += 1

				-- Spontaneous mechanical retirements (reliability-driven).
				local reliabilityRisk = (1 - clamp(c.car.reliability / 100, 0, 1)) * 0.0009
				local damageRisk = (c.damage.engine + c.damage.gearbox + c.damage.cooling) * 0.004
				if not c.retired and rng:chance(reliabilityRisk + damageRisk) then
					c.retired = true
					c.retiredReason = Damage.isTerminal(c.damage) or "Mechanical failure"
					incidents[#incidents + 1] = {
						id = opts.raceId .. ":ret:" .. lap .. ":" .. c.driverId,
						raceId = opts.raceId,
						lap = lap,
						trackPosition = c.trackProgress,
						corner = "Turn " .. rng:int(1, circuit.corners),
						kind = "mechanical",
						severity = 3,
						involvedDriverIds = { c.driverId },
						responsibility = "mechanical",
						responsibleDriverId = nil,
						damage = { [c.driverId] = {} },
						narrative = c.driver.name .. " pulls off the circuit with a mechanical failure.",
						factors = { "mechanical reliability" },
						penalty = nil,
						neutralisation = "none",
					}
				end
			end
		end

		-- ---- Record the lap ----------------------------------------------
		local leader = afterOrder[1]
		local entries = {}
		for i, c in ipairs(afterOrder) do
			c.trackPosition = i
			c.gapToLeader = leader and round(c.cumulativeTime - leader.cumulativeTime, 3) or 0
			entries[i] = {
				driverId = c.driverId,
				position = i,
				lapTime = flag == "red-flag" and 0 or round(c.raw, 3),
				compound = c.compound,
				tireAge = c.tireAgeLaps,
				gapToLeader = c.gapToLeader,
				pit = pittedThisLap[c.driverId] or false,
				flag = flag,
				retired = c.retired,
			}
		end
		laps[#laps + 1] = { lap = lap, entries = entries }

		if neutralised then
			neutralisedLaps -= 1
			if neutralisedLaps <= 0 then
				flag = "green"
			end
		end

		-- End early if too few cars remain.
		if #running() < 2 then
			break
		end
	end

	-- ---- Classify -------------------------------------------------------
	local finishers = stableSort(cars, function(a, b)
		if a.retired ~= b.retired then
			return not a.retired
		end
		if a.lapsCompleted ~= b.lapsCompleted then
			return a.lapsCompleted > b.lapsCompleted
		end
		return a.cumulativeTime < b.cumulativeTime
	end)

	local leaderTime = 0
	for _, c in ipairs(finishers) do
		if not c.retired then
			leaderTime = c.cumulativeTime
			break
		end
	end

	local bestLapOverall = math.huge
	for _, c in ipairs(cars) do
		if c.bestLapTime ~= nil and c.bestLapTime < bestLapOverall then
			bestLapOverall = c.bestLapTime
		end
	end
	local fastestDriver = nil
	for _, c in ipairs(cars) do
		if c.bestLapTime == bestLapOverall and not c.retired then
			fastestDriver = c
			break
		end
	end
	if not fastestDriver then
		for _, c in ipairs(cars) do
			if c.bestLapTime == bestLapOverall then
				fastestDriver = c
				break
			end
		end
	end

	local classification = {}
	for i, c in ipairs(finishers) do
		local position = i
		local points = 0
		if not c.retired and position - 1 < #ruleset.racePoints then
			points = ruleset.racePoints[position]
		end
		local isFastest = fastestDriver ~= nil and c.driverId == fastestDriver.driverId and not c.retired
		if isFastest and ruleset.fastestLapPoints > 0 and position <= ruleset.fastestLapTopN then
			points += ruleset.fastestLapPoints
		end
		local gapSeconds = nil
		if not c.retired then
			gapSeconds = round(c.cumulativeTime - leaderTime, 3)
		end
		local gap
		if c.retired then
			gap = "DNF"
		elseif position == 1 then
			gap = "WINNER"
		elseif gapSeconds ~= nil and gapSeconds < circuit.referenceLapSeconds then
			gap = "+" .. string.format("%.3f", gapSeconds)
		else
			local denom = circuit.referenceLapSeconds ~= 0 and circuit.referenceLapSeconds or 90
			gap = "+" .. string.format("%.3f", (gapSeconds or 0) / denom) .. " lap"
		end

		local gridPosition = position
		for _, e in ipairs(opts.entrants) do
			if e.driverId == c.driverId then
				gridPosition = e.gridPosition
				break
			end
		end

		local timeSeconds = nil
		if not c.retired then
			timeSeconds = round(c.cumulativeTime, 3)
		end

		classification[i] = {
			position = position,
			driverId = c.driverId,
			teamId = c.teamId,
			laps = c.lapsCompleted,
			timeSeconds = timeSeconds,
			gap = gap,
			bestLap = c.bestLapTime,
			points = points,
			status = c.retired and "dnf" or "finished",
			pits = c.pitsMade,
			fastestLap = isFastest,
			gridPosition = gridPosition,
			penalties = 0,
		}
	end

	local damageByDriver = {}
	local runtimeByDriver = {}
	for _, c in ipairs(cars) do
		damageByDriver[c.driverId] = c.damage
		runtimeByDriver[c.driverId] = {
			driverId = c.driverId,
			teamId = c.teamId,
			damage = c.damage,
			compound = c.compound,
			tireAgeLaps = c.tireAgeLaps,
			fuelLaps = c.fuelLaps,
			pitsMade = c.pitsMade,
			penaltySeconds = 0,
			retired = c.retired,
			retiredReason = c.retiredReason,
			gapToLeader = c.gapToLeader,
			trackPosition = c.trackPosition,
			lastLapTime = c.lastLapTime,
			bestLapTime = c.bestLapTime,
			lapTimes = c.lapTimes,
			trackProgress = c.trackProgress,
			outOfRace = c.retired,
		}
	end

	local result = {
		id = opts.raceId,
		careerId = "",
		season = 0,
		raceIndex = 0,
		circuitId = circuit.id,
		session = "race",
		seed = opts.seed,
		weatherStart = opts.weatherStart.condition,
		classification = classification,
		qualifying = {},
		incidents = incidents,
		laps = laps,
		safetyCarDeployments = safetyCarDeployments,
		virtualSafetyCarPeriods = virtualSafetyCarPeriods,
		redFlags = redFlags,
		fastestLapDriverId = fastestDriver and fastestDriver.driverId or nil,
		poleDriverId = nil,
		winnerDriverId = classification[1] and classification[1].driverId or nil,
		processed = false,
		createdAt = DateTime.now().UnixTimestampMillis,
	}

	return { result = result, damageByDriver = damageByDriver, runtimeByDriver = runtimeByDriver, gridPenalties = gridPenalties }
end

Race.simulateRace = simulateRace

return Race
