-- Ported 1:1 from src/engine/liveRace.ts
-- Interactive live-race engine: the same deterministic model as simulateRace, but
-- exposed as a step-by-step session so a human principal can radio instructions
-- between laps. All randomness flows through one Rng. Sorts are made stable to
-- match JavaScript's Array.prototype.sort.

local RngModule = require(script.Parent.Rng)
local Rng = RngModule.Rng
local clamp = RngModule.clamp
local round = RngModule.round

local Car = require(script.Parent.Car)
local Tire = require(script.Parent.Tire)
local Damage = require(script.Parent.Damage)
local Incidents = require(script.Parent.Incidents)
local Weather = require(script.Parent.Weather)
local DriverIq = require(script.Parent.DriverIq)

local LiveRace = {}
LiveRace.__index = LiveRace

local PACE_DELTA = { conserve = 0.45, normal = 0, push = -0.4 }

-- Radio acknowledgements, picked by pace so the engineer feels alive.
local PACE_ACK = {
	conserve = { "Copy, we'll manage the tyres.", "Understood — lift and coast.", "Save mode, understood." },
	normal = { "Copy, back to normal pace.", "Understood, settling into rhythm.", "Normal settings confirmed." },
	push = { "Copy, push now!", "Understood — full attack.", "Box for more performance, pushing." },
}

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

function LiveRace.new(opts)
	local self = setmetatable({}, LiveRace)
	self.raceId = opts.raceId
	self.totalLaps = opts.totalLaps
	self.circuit = opts.circuit
	self.seed = opts.seed
	self.ruleset = opts.ruleset
	self.severitySetting = opts.severitySetting
	self.qualifying = opts.qualifying or {}
	self.poleDriverId = opts.poleDriverId
	self.weather = opts.weatherStart
	self.prevCondition = opts.weatherStart.condition
	self.rng = Rng.new(opts.seed .. ":live")
	self.specs = Tire.defaultTireSpecs(opts.circuit)

	self.laps = {}
	self.incidents = {}
	self.events = {}
	self.flag = "green"
	self.lap = 0
	self.finished = false
	self.safetyCarDeployments = 0
	self.virtualSafetyCarPeriods = 0
	self.redFlags = 0
	self.neutralisedLaps = 0
	self.eventSeq = 0
	self.overallBest = math.huge

	local controlled = {}
	for _, id in ipairs(opts.controlledDriverIds) do
		controlled[id] = true
	end

	local totalLaps = opts.totalLaps
	local cars = {}
	for _, e in ipairs(opts.entrants) do
		local startCompound = e.strategy.compounds[1] or "medium"
		cars[#cars + 1] = {
			driverId = e.driverId,
			teamId = e.teamId,
			damage = Damage.initDamage(),
			compound = startCompound,
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
			gridPosition = e.gridPosition,
			raw = 0,
			pitThisLap = false,
			nextPitIndex = 0,
			cumulativeTime = e.gridPosition * 0.7,
			lapsCompleted = 0,
			controlled = controlled[e.driverId] or false,
			command = { pace = "normal", pitRequest = false, pitCompound = nil },
		}
	end
	self.cars = stableSort(cars, function(a, b)
		return a.trackPosition < b.trackPosition
	end)

	self:pushEvent(0, "start", "Lights out and away we go!", "#34d399", "info")
	return self
end

-- -- public API ---------------------------------------------------------------

function LiveRace:setCommand(driverId, patch)
	local c = findCar(self.cars, driverId)
	if not c or not c.controlled or c.retired then
		return nil
	end
	local before = c.command
	local merged = {}
	for k, v in pairs(before) do
		merged[k] = v
	end
	for k, v in pairs(patch) do
		merged[k] = v
	end
	c.command = merged

	if patch.pace and patch.pace ~= before.pace then
		local acks = PACE_ACK[patch.pace]
		local ack = acks[(self.eventSeq % #acks) + 1]
		return self:pushEvent(self.lap, "radio", ack, "#93c5fd", "info", driverId)
	end
	if patch.pitRequest and not before.pitRequest then
		return self:pushEvent(self.lap, "radio", "Box this lap, box — confirmed.", "#93c5fd", "info", driverId)
	end
	if patch.pitRequest == false and before.pitRequest then
		return self:pushEvent(self.lap, "radio", "Stay out, stay out — cancel the stop.", "#93c5fd", "info", driverId)
	end
	return nil
end

-- Advance exactly one lap. Returns the events produced by that lap.
function LiveRace:step()
	if self.finished then
		return {}
	end
	local firstNew = #self.events
	local lap = self.lap + 1
	self.lap = lap
	local circuit = self.circuit
	local totalLaps = self.totalLaps
	local specs = self.specs
	local rng = self.rng

	self.weather = Weather.evolveWeather(rng, self.weather, circuit, lap)
	if self.weather.condition ~= self.prevCondition then
		self.prevCondition = self.weather.condition
		self:pushEvent(lap, "weather", "Conditions are now " .. (string.gsub(self.weather.condition, "-", " ", 1)) .. ".", "#38bdf8", "info")
	end

	local neutralised = self.neutralisedLaps > 0
	local liveOrder = self:order()

	for _, c in ipairs(liveOrder) do
		local tire = Tire.evaluateTire(specs[c.compound], c.tireAgeLaps, self:envFor(c))
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
			wetness = self.weather.trackWetness,
		}) + PACE_DELTA[c.command.pace]
	end

	if neutralised then
		local base = self.flag == "red-flag" and 0 or circuit.referenceLapSeconds * 1.5
		for i, c in ipairs(liveOrder) do
			c.raw = base
			if self.flag == "safety-car" then
				c.cumulativeTime = liveOrder[1].cumulativeTime + (i - 1) * 0.8
			end
		end
	else
		self:applyTraffic(rng, liveOrder)
		self:handlePits(rng, liveOrder, lap, false)
	end

	if neutralised and (self.flag == "safety-car" or self.flag == "virtual-safety-car") then
		self:handlePits(rng, liveOrder, lap, true)
	end

	-- ---- Incidents ----------------------------------------------------------
	local currentOrder = self:order()
	for idx, c in ipairs(currentOrder) do
		if not c.retired then
			local nearby = {}
			local from = math.max(1, idx - 2)
			local to = math.min(#currentOrder, idx + 2)
			for j = from, to do
				if j ~= idx then
					local other = currentOrder[j]
					local gap = other.cumulativeTime - c.cumulativeTime
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
				weather = self.weather,
				lap = lap,
				totalLaps = totalLaps,
				isFirstLap = lap == 1,
				isRestart = self.neutralisedLaps == 1,
				isPitEntry = c.pitThisLap,
				strategyRisk = c.command.pace == "push" and "high" or (c.command.pace == "conserve" and "low" or c.strategy.risk),
				compound = c.compound,
				tireAge = c.tireAgeLaps,
				tireGrip = Tire.evaluateTire(specs[c.compound], c.tireAgeLaps, self:envFor(c)).gripFactor,
				fuelLaps = c.fuelLaps,
				nearby = nearby,
				severitySetting = self.severitySetting,
				-- Mistakes are a driver trait first and a strategy-crew trait second.
				decisionSkill = clamp(c.decisionSkill * 0.45 + DriverIq.racerSkill(c.driver).iq * 0.55, 0, 1),
			}

			local inc = Incidents.generateIncident(rng, ctx, self.raceId)
			if inc then
				self.incidents[#self.incidents + 1] = inc
				self:applyIncident(inc)
				self:pushEvent(lap, "incident", inc.narrative, inc.severity >= 3 and "#f87171" or "#fbbf24", inc.severity >= 3 and "bad" or "warn", inc.involvedDriverIds[1])

				if inc.neutralisation == "safety-car" and self.ruleset.safetyCars then
					self.flag = "safety-car"
					self.neutralisedLaps = math.max(self.neutralisedLaps, rng:int(3, 5))
					self.safetyCarDeployments += 1
					self:pushEvent(lap, "flag", "Safety Car deployed.", "#fbbf24", "warn")
				elseif inc.neutralisation == "virtual-safety-car" and self.ruleset.virtualSafetyCars then
					self.flag = "virtual-safety-car"
					self.neutralisedLaps = math.max(self.neutralisedLaps, rng:int(2, 3))
					self.virtualSafetyCarPeriods += 1
					self:pushEvent(lap, "flag", "Virtual Safety Car.", "#fbbf24", "warn")
				elseif inc.neutralisation == "red-flag" and self.ruleset.redFlags then
					self.flag = "red-flag"
					self.neutralisedLaps = math.max(self.neutralisedLaps, rng:int(3, 6))
					self.redFlags += 1
					self:pushEvent(lap, "flag", "Red flag — session suspended.", "#f87171", "bad")
				end
			end
		end
	end

	-- ---- Accumulate ---------------------------------------------------------
	local afterOrder = self:order()
	local pittedThisLap = {}
	for _, c in ipairs(afterOrder) do
		pittedThisLap[c.driverId] = c.pitThisLap
		if self.flag == "red-flag" then
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

			if c.lastLapTime and c.lastLapTime < self.overallBest and self.flag == "green" then
				if self.overallBest < math.huge then
					self:pushEvent(lap, "fastest", c.driver.name .. " sets the fastest lap: " .. self:fmt(c.lastLapTime) .. ".", "#a78bfa", "good", c.driverId)
				end
				self.overallBest = c.lastLapTime
			end

			local reliabilityRisk = (1 - clamp(c.car.reliability / 100, 0, 1)) * 0.0009
			local damageRisk = (c.damage.engine + c.damage.gearbox + c.damage.cooling) * 0.004
			if not c.retired and rng:chance(reliabilityRisk + damageRisk) then
				c.retired = true
				c.retiredReason = Damage.isTerminal(c.damage) or "Mechanical failure"
				self:pushEvent(lap, "retire", c.driver.name .. " stops with a mechanical problem.", "#f87171", "bad", c.driverId)
			end
		end
	end

	self:recordLap(afterOrder, pittedThisLap, lap)

	-- Radio reminder if a controlled car's tyres are past their prime.
	for _, c in ipairs(afterOrder) do
		if c.controlled and not c.retired then
			local spec = specs[c.compound]
			if c.tireAgeLaps > spec.lifeLaps * 0.95 and not c.command.pitRequest then
				self:pushEvent(lap, "radio", c.driver.name .. "'s tyres are going off — consider boxing.", "#fbbf24", "warn", c.driverId)
			end
		end
	end

	if neutralised then
		self.neutralisedLaps -= 1
		if self.neutralisedLaps <= 0 then
			self.flag = "green"
			self:pushEvent(lap, "flag", "Track is green again.", "#34d399", "good")
		end
	end

	if lap >= totalLaps or #self:running() < 2 then
		self.finished = true
		self.flag = "chequered"
		self:pushEvent(lap, "finish", "Chequered flag! Race complete.", "#e5e7eb", "good")
	end

	local out = {}
	for i = firstNew + 1, #self.events do
		out[#out + 1] = self.events[i]
	end
	return out
end

function LiveRace:snapshot()
	local sorted = stableSort(self.cars, function(a, b)
		return a.trackPosition < b.trackPosition
	end)
	local cars = {}
	for i, c in ipairs(sorted) do
		cars[i] = {
			driverId = c.driverId,
			teamId = c.teamId,
			position = i,
			compound = c.compound,
			tireAge = c.tireAgeLaps,
			gapToLeader = c.gapToLeader,
			gapAhead = nil,
			lastLapTime = c.lastLapTime,
			bestLapTime = c.bestLapTime,
			pit = c.pitThisLap,
			pitRequest = c.command.pitRequest,
			pitCompound = c.command.pitCompound,
			retired = c.retired,
			pits = c.pitsMade,
			pace = c.command.pace,
			fuelLaps = c.fuelLaps,
			damagePct = clamp(Damage.totalDamage(c.damage) / 3, 0, 1),
			controlled = c.controlled,
			trackProgress = c.trackProgress,
		}
	end
	for i = 2, #cars do
		cars[i].gapAhead = round(math.max(0, cars[i].gapToLeader - cars[i - 1].gapToLeader), 3)
	end
	return {
		lap = self.lap,
		totalLaps = self.totalLaps,
		flag = self.flag,
		weather = self.weather,
		cars = cars,
		finished = self.finished,
	}
end

function LiveRace:finalize()
	local circuit = self.circuit
	local ruleset = self.ruleset
	local finishers = stableSort(self.cars, function(a, b)
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

	local bestLapOverall = 0
	local timed = 0
	for _, c in ipairs(self.cars) do
		if c.bestLapTime ~= nil and (timed == 0 or c.bestLapTime < bestLapOverall) then
			bestLapOverall = c.bestLapTime
			timed += 1
		end
	end
	local fastestDriver = nil
	for _, c in ipairs(self.cars) do
		if c.bestLapTime == bestLapOverall and not c.retired then
			fastestDriver = c
			break
		end
	end
	if not fastestDriver then
		for _, c in ipairs(self.cars) do
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
			gridPosition = c.gridPosition,
			penalties = 0,
		}
	end

	local damageByDriver = {}
	local runtimeByDriver = {}
	for _, c in ipairs(self.cars) do
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
		id = self.raceId,
		careerId = "",
		season = 0,
		raceIndex = 0,
		circuitId = circuit.id,
		session = "race",
		seed = self.seed,
		weatherStart = self.weather.condition,
		classification = classification,
		qualifying = self.qualifying,
		incidents = self.incidents,
		laps = self.laps,
		safetyCarDeployments = self.safetyCarDeployments,
		virtualSafetyCarPeriods = self.virtualSafetyCarPeriods,
		redFlags = self.redFlags,
		fastestLapDriverId = fastestDriver and fastestDriver.driverId or nil,
		poleDriverId = self.poleDriverId,
		winnerDriverId = classification[1] and classification[1].driverId or nil,
		finalDamage = damageByDriver,
		processed = false,
		createdAt = 0,
	}

	return { result = result, damageByDriver = damageByDriver, runtimeByDriver = runtimeByDriver }
end

-- -- internals ----------------------------------------------------------------

function LiveRace:running()
	local out = {}
	for _, c in ipairs(self.cars) do
		if not c.retired then
			out[#out + 1] = c
		end
	end
	return out
end

function LiveRace:order()
	return stableSort(self:running(), function(a, b)
		return a.cumulativeTime < b.cumulativeTime
	end)
end

function LiveRace:envFor(c)
	return {
		trackWetness = self.weather.trackWetness,
		trackTempC = self.weather.trackTempC,
		driverTyreManagement = c.driver.attributes.tireManagement / 100,
		carTyreFriendliness = c.car.tireFriendliness / 100,
		circuit = self.circuit,
		push = c.command.pace,
	}
end

function LiveRace:autoCompound(c)
	if self.weather.trackWetness > 0.62 then
		return "wet"
	end
	if self.weather.trackWetness > 0.22 then
		return "intermediate"
	end
	local idx = math.min(c.nextPitIndex + 1, #c.strategy.compounds - 1) + 1
	return c.strategy.compounds[idx] or "medium"
end

function LiveRace:applyTraffic(rng, liveOrder)
	local circuit = self.circuit
	local iqWeight = DriverIq.circuitIqWeight(circuit)
	for i = 2, #liveOrder do
		local attacker = liveOrder[i]
		local defender = liveOrder[i - 1]
		local gap = attacker.cumulativeTime - defender.cumulativeTime
		local drsAvailable = #circuit.drsZones > 0 and gap < 1.0 and self.weather.trackWetness < 0.35

		if gap < 1.4 then
			local atk = DriverIq.racerSkill(attacker.driver)
			local def = DriverIq.racerSkill(defender.driver)
			local paceAdvantage = defender.raw - attacker.raw
			-- A smart driver loses less time in dirty air - they manage the aero wash.
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
					defender.raw += rng:range(0.05, 0.3)
				else
					attacker.raw = defender.raw + rng:range(0.03, 0.25)
				end
			end
		end
	end
end

function LiveRace:handlePits(rng, liveOrder, lap, underNeutralisation)
	local circuit = self.circuit
	local totalLaps = self.totalLaps
	local specs = self.specs
	for _, c in ipairs(liveOrder) do
		if not c.retired then
			local lapsLeft = totalLaps - lap
			if lapsLeft >= 1 then
				local shouldStop = false
				local next
				local numCompounds = #c.strategy.compounds

				if c.controlled then
					if c.command.pitRequest then
						shouldStop = true
						next = c.command.pitCompound or self:autoCompound(c)
					end
				else
					local planned = c.strategy.pitLaps[c.nextPitIndex + 1]
					local spec = specs[c.compound]
					local worn = c.tireAgeLaps > spec.lifeLaps * 1.05
					local wrongTires = (self.weather.trackWetness > 0.62 and Tire.isSlick(c.compound))
						or (self.weather.trackWetness < 0.18 and not Tire.isSlick(c.compound))
					local plannedNow = planned ~= nil and lap >= planned and c.nextPitIndex < numCompounds - 1
					local emergency = (worn or wrongTires) and c.nextPitIndex < numCompounds - 1
					local aiWantsStop = emergency and rng:chance(0.5 + c.decisionSkill * 0.4)
					shouldStop = plannedNow
						or aiWantsStop
						or (underNeutralisation and c.nextPitIndex < numCompounds - 1 and rng:chance(0.35 + c.decisionSkill * 0.3))
					next = c.strategy.compounds[math.min(c.nextPitIndex + 1, numCompounds - 1) + 1]
					if self.weather.trackWetness > 0.62 then
						next = "wet"
					elseif self.weather.trackWetness > 0.22 then
						next = "intermediate"
					elseif not Tire.isSlick(next) then
						next = "medium"
					end
				end

				if shouldStop then
					local pitLoss = circuit.pitLossSeconds * (underNeutralisation and 0.55 or 1)
						+ rng:gaussian(0, 1.2)
						+ c.driver.attributes.concentration * -0.01
					local stopTime = clamp(pitLoss, 14, 40)
					c.raw += stopTime

					c.compound = next
					c.tireAgeLaps = 0
					c.nextPitIndex = math.min(c.nextPitIndex + 1, numCompounds)
					c.pitThisLap = true
					if c.controlled then
						c.command.pitRequest = false
						c.command.pitCompound = nil
					end
					self:pushEvent(lap, "pit", c.driver.name .. " pits for " .. next .. " tyres.", "#60a5fa", "info", c.driverId)
				end
			end
		end
	end
end

function LiveRace:applyIncident(inc)
	for driverId, partial in pairs(inc.damage) do
		local c = findCar(self.cars, driverId)
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
		local c = findCar(self.cars, inc.penalty.driverId)
		if c then
			if inc.penalty.type == "time" then
				c.penaltySeconds += inc.penalty.seconds
			elseif inc.penalty.type == "drive-through" then
				c.penaltySeconds += 20
			elseif inc.penalty.type == "stop-go" then
				c.penaltySeconds += 10 + inc.penalty.seconds
			end
		end
	end
end

function LiveRace:recordLap(afterOrder, pittedThisLap, lap)
	local prevPositions = {}
	local prevLeader = nil
	if #self.laps > 0 then
		local lastEntries = self.laps[#self.laps].entries
		for _, e in ipairs(lastEntries) do
			prevPositions[e.driverId] = e.position
		end
		prevLeader = lastEntries[1] and lastEntries[1].driverId or nil
	end

	local leader = afterOrder[1]
	local entries = {}
	for i, c in ipairs(afterOrder) do
		c.trackPosition = i
		c.gapToLeader = leader and round(c.cumulativeTime - leader.cumulativeTime, 3) or 0
		entries[i] = {
			driverId = c.driverId,
			position = i,
			lapTime = self.flag == "red-flag" and 0 or round(c.raw, 3),
			compound = c.compound,
			tireAge = c.tireAgeLaps,
			gapToLeader = c.gapToLeader,
			pit = pittedThisLap[c.driverId] or false,
			flag = self.flag,
			retired = c.retired,
		}
	end
	self.laps[#self.laps + 1] = { lap = lap, entries = entries }

	if lap < 2 then
		return
	end

	local newLeader = entries[1] and entries[1].driverId or nil
	if prevLeader and newLeader and newLeader ~= prevLeader then
		local d = findCar(self.cars, newLeader)
		if d then
			self:pushEvent(lap, "lead", d.driver.name .. " takes the lead!", "#34d399", "good", newLeader)
		end
	end

	for _, e in ipairs(entries) do
		local was = prevPositions[e.driverId]
		if was ~= nil and e.position < was and not e.pit then
			local passed = nil
			for _, o in ipairs(entries) do
				if o.position > e.position and (prevPositions[o.driverId] or 999) < was and not o.pit then
					passed = o
					break
				end
			end
			if passed then
				local a = findCar(self.cars, e.driverId)
				local b = findCar(self.cars, passed.driverId)
				if a and b then
					self:pushEvent(lap, "overtake", a.driver.name .. " passes " .. b.driver.name .. " for P" .. tostring(e.position) .. ".", "#93c5fd", "info", e.driverId)
				end
			end
		end
	end
end

function LiveRace:pushEvent(lap, kind, text, color, tone, driverId)
	self.eventSeq += 1
	local ev = { id = self.raceId .. ":ev:" .. (self.eventSeq - 1), lap = lap, kind = kind, text = text, driverId = driverId, tone = tone, color = color }
	self.events[#self.events + 1] = ev
	if #self.events > 240 then
		local remove = #self.events - 240
		for _ = 1, remove do
			table.remove(self.events, 1)
		end
	end
	return ev
end

function LiveRace:fmt(seconds)
	local m = math.floor(seconds / 60)
	local s = seconds - m * 60
	local str = string.format("%.3f", s)
	while #str < 6 do
		str = "0" .. str
	end
	return m .. ":" .. str
end

return LiveRace
