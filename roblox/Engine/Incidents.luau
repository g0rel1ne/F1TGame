-- Ported 1:1 from src/engine/incidents.ts

local Rng = require(script.Parent.Rng)
local Damage = require(script.Parent.Damage)
local clamp = Rng.clamp
local round = Rng.round

local Incidents = {}

local SEVERITY_MULT = { lenient = 0.7, realistic = 1, strict = 1.45 }
local RISK_MULT = { low = 0.78, medium = 1, high = 1.35 }

-- Per-lap probability that this car is involved in an incident, in [0, 0.08].
local function computeLapIncidentRisk(ctx)
	local a = ctx.driver.attributes
	local consistency = a.consistency / 100
	local concentration = a.concentration / 100

	local p = 0.0016 * (1 - consistency) + 0.0012 * (1 - concentration)
	p *= 1 - clamp(a.experience / 100, 0, 1) * 0.3
	p *= 1 - clamp(ctx.decisionSkill, 0, 1) * 0.22

	-- Wet / low-grip conditions.
	p += (ctx.weather.trackWetness ^ 1.4) * 0.006 * (1 - a.wet / 150)

	-- Worn tyres and existing damage.
	p += clamp((1 - ctx.tireGrip) * 0.01, 0, 0.01)
	local dmg = 0
	for _, k in ipairs(Damage.ORDER) do
		dmg += ctx.damage[k] or 0
	end
	p += clamp(dmg * 0.004, 0, 0.02)

	-- Traffic proximity and wheel-to-wheel risk.
	for _, n in ipairs(ctx.nearby) do
		local proximity = clamp(1 - math.abs(n.gap) / 1.4, 0, 1)
		if proximity > 0 then
			p += 0.0018 * proximity * (0.5 + a.aggression) * (1 - n.skill * 0.6)
		end
	end

	if ctx.isFirstLap then
		p *= 2.6 + ctx.circuit.danger
	end
	if ctx.isRestart then
		p *= 1.7
	end
	if ctx.isPitEntry then
		p *= 1.4
	end
	p *= ctx.circuit.danger * 0.6 + 0.7
	p *= RISK_MULT[ctx.strategyRisk]
	p *= SEVERITY_MULT[ctx.severitySetting]

	return clamp(p, 0, 0.08)
end

local function pickKind(rng, ctx)
	local wet = ctx.weather.trackWetness
	local hasTraffic = false
	for _, n in ipairs(ctx.nearby) do
		if math.abs(n.gap) < 1.2 then
			hasTraffic = true
			break
		end
	end
	local weights = {
		{ "spin", 3 },
		{ "lock-up", 2.2 },
		{ "near-miss", 1.6 },
		{ "mechanical", 1.4 + (1 - ctx.carReliability / 100) * 4 },
		{ "tire-failure", 0.6 + clamp((1 - ctx.tireGrip) * 2, 0, 2) },
		{ "barrier", 0.8 },
		{ "aquaplaning", wet > 0.4 and 4 or 0.1 },
		{ "debris", 0.4 },
		{ "pit-lane", ctx.isPitEntry and 2.5 or 0 },
	}
	if hasTraffic then
		weights[#weights + 1] = { "contact", 3.2 }
		weights[#weights + 1] = { "rear-end", 1.8 }
		weights[#weights + 1] = { "side-to-side", 2.0 }
		weights[#weights + 1] = { "divebomb", 1.4 }
		if ctx.isFirstLap then
			weights[#weights + 1] = { "first-lap", 6 }
		end
		local closeCount = 0
		for _, n in ipairs(ctx.nearby) do
			if math.abs(n.gap) < 0.8 then
				closeCount += 1
			end
		end
		if closeCount >= 2 then
			weights[#weights + 1] = { "multi-car", 1.2 }
		end
	end
	local kinds = {}
	local ws = {}
	for _, w in ipairs(weights) do
		if w[2] > 0 then
			kinds[#kinds + 1] = w[1]
			ws[#ws + 1] = w[2]
		end
	end
	return rng:weighted(kinds, ws)
end

local function pickSeverity(rng, ctx, kind)
	local highSpeed = clamp(ctx.circuit.lengthKm / 7, 0.25, 1)
	local wet = ctx.weather.trackWetness
	local speedRoll = rng:next() * (0.8 + highSpeed * 0.8 + wet * 0.5)
	local raw = clamp(
		speedRoll
			+ (ctx.isFirstLap and 0.15 or 0)
			+ (kind == "multi-car" and 0.25 or 0)
			+ (kind == "mechanical" and 0.1 or 0)
			+ rng:gaussian(0, 0.18),
		0,
		1.4
	)
	if kind == "near-miss" then
		return 0
	end
	if kind == "lock-up" or kind == "aquaplaning" then
		return raw < 0.75 and 1 or 2
	end
	if raw < 0.42 then
		return 1
	end
	if raw < 0.78 then
		return 2
	end
	if raw < 1.05 then
		return 3
	end
	return 4
end

local function damageForKind(rng, kind, severity, primaryIsAhead)
	local s = severity
	if s == 0 then
		return { primary = { frontWing = rng:range(0.02, 0.06) }, secondary = {} }
	end

	if kind == "rear-end" then
		return {
			primary = { frontWing = rng:range(0.2, 0.5) * s, floor = rng:range(0, 0.1) * s },
			secondary = { rearWing = rng:range(0.1, 0.35) * s, floor = rng:range(0, 0.15) * s },
		}
	elseif kind == "side-to-side" or kind == "divebomb" or kind == "contact" or kind == "first-lap" or kind == "multi-car" then
		return {
			primary = {
				frontWing = rng:range(0.1, 0.35) * s,
				suspension = rng:range(0, 0.4) * (s - 1),
				sidepod = rng:range(0, 0.25) * (s - 1),
				tire = rng:chance(0.25 * s) and rng:range(0.3, 0.8) or 0,
			},
			secondary = {
				rearWing = rng:range(0, 0.3) * (s - 1),
				floor = rng:range(0, 0.3) * (s - 1),
				suspension = rng:range(0, 0.35) * (s - 1),
				sidepod = rng:range(0.1, 0.4) * (s - 1),
			},
		}
	elseif kind == "barrier" then
		return {
			primary = {
				frontWing = rng:range(0.3, 0.6) * s,
				suspension = rng:range(0.1, 0.5) * s,
				chassis = rng:range(0, 0.4) * (s - 1),
				floor = rng:range(0, 0.3) * (s - 1),
			},
			secondary = {},
		}
	elseif kind == "spin" then
		return {
			primary = { floor = rng:range(0, 0.25) * s, rearWing = rng:range(0, 0.2) * s, tire = rng:range(0, 0.4) * (s - 1) },
			secondary = {},
		}
	elseif kind == "tire-failure" then
		return { primary = { tire = rng:range(0.6, 1.0), floor = rng:range(0, 0.2) * (s - 1) }, secondary = {} }
	elseif kind == "mechanical" then
		local component = rng:pick({ "engine", "gearbox", "brakes", "cooling", "steering" })
		return { primary = { [component] = rng:range(0.4, 1.0) * s }, secondary = {} }
	elseif kind == "debris" then
		return { primary = { floor = rng:range(0, 0.15) * s, sidepod = rng:range(0, 0.15) * s }, secondary = {} }
	elseif kind == "pit-lane" then
		return {
			primary = { frontWing = rng:range(0.1, 0.4) * s, suspension = rng:range(0, 0.3) * (s - 1) },
			secondary = { frontWing = rng:range(0, 0.2) * (s - 1) },
		}
	elseif kind == "lock-up" then
		return { primary = { tire = rng:range(0.2, 0.5) }, secondary = {} }
	elseif kind == "aquaplaning" then
		return { primary = { frontWing = rng:range(0, 0.3) * s, floor = rng:range(0, 0.2) * s }, secondary = {} }
	else
		-- near-miss / default
		return { primary = {}, secondary = {} }
	end
end

local NARRATIVE = {
	["near-miss"] = { "{a} runs wide and takes to the run-off, rejoining without contact.", "{a} has a big moment but keeps it out of the barriers." },
	contact = { "Contact between {a} and {b}. Both cars continue.", "{a} and {b} touch — the stewards will look at that." },
	["rear-end"] = { "{a} brakes too late and runs into the back of {b}.", "A misjudged braking point sends {a} into {b}." },
	["side-to-side"] = { "{a} and {b} fight for the same piece of track and make wheel-to-wheel contact.", "{a} and {b} are side by side and touch, both lucky to continue." },
	divebomb = { "{a} dives down the inside of {b} with insufficient space and they collide.", "An optimistic move from {a} on {b} ends in contact." },
	["lock-up"] = { "{a} locks a front tyre under braking and runs wide.", "{a} has a big lock-up into the corner, flat-spotting a tyre." },
	spin = { "{a} loses the rear on corner exit and spins.", "{a} spins under braking on the slippery surface." },
	aquaplaning = { "{a} aquaplanes on standing water and loses control.", "Heavy spray and standing water catch {a} out." },
	["first-lap"] = { "A first-lap collision at the congested opening corner involves {a} and {b}.", "Turn 1 chaos — {a} and {b} are caught in the pack." },
	barrier = { "{a} leaves the track and strikes the barrier.", "{a} runs wide and makes heavy contact with the wall." },
	mechanical = { "A mechanical failure leaves {a} with an ill-handling car.", "{a} reports a problem — looks mechanical." },
	["tire-failure"] = { "A sudden tyre failure for {a}!", "{a} suffers a puncture and loses control." },
	debris = { "Debris on the racing line is collected by {a}.", "{a} runs over debris from an earlier incident." },
	["multi-car"] = { "A multi-car incident! {a} and {b} are involved as the track becomes blocked.", "Several cars collide — {a} and {b} are caught up." },
	["pit-lane"] = { "An unsafe moment in the pit lane involves {a}.", "{a} is released into the path of traffic in the pit lane." },
}

local function responsibility(rng, kind, ctx, other)
	if kind == "mechanical" or kind == "tire-failure" or kind == "aquaplaning" then
		return { finding = kind == "aquaplaning" and "weather" or "mechanical", responsible = nil, penalty = nil }
	end
	if kind == "spin" or kind == "lock-up" or kind == "barrier" or kind == "debris" or kind == "near-miss" then
		return { finding = "driver-a", responsible = ctx.driverId, penalty = nil }
	end
	if not other then
		return { finding = "racing-incident", responsible = nil, penalty = nil }
	end

	local aggressionA = ctx.driver.attributes.aggression
	local aggressionB = other.aggression
	local aIsBehind = other.gap < 0
	local attackerAgg = aIsBehind and aggressionA or aggressionB
	local score = (kind == "divebomb" or kind == "rear-end") and 0.7 or 0.45
	local roll = rng:next() * (1 + attackerAgg) - score

	if roll > 0.55 then
		local responsible
		if aIsBehind then
			responsible = ((kind == "rear-end" or kind == "divebomb") and ctx.driverId) or other.driverId
		else
			responsible = other.driverId
		end
		local pickType = rng:pick({ "time", "time", "drive-through", "grid" })
		local penalty
		if pickType == "time" then
			penalty = { type = "time", seconds = rng:pick({ 5, 5, 10 }), driverId = responsible }
		elseif pickType == "drive-through" then
			penalty = { type = "drive-through", driverId = responsible }
		else
			penalty = { type = "grid", places = rng:pick({ 3, 5, 10 }), driverId = responsible }
		end
		return { finding = aIsBehind and "driver-a" or "driver-b", responsible = responsible, penalty = penalty }
	end
	if rng:chance(0.25) then
		return { finding = "both", responsible = nil, penalty = nil }
	end
	return { finding = "racing-incident", responsible = nil, penalty = nil }
end

local function neutralisation(severity, kind, circuit, rng)
	if severity <= 1 then
		return "none"
	end
	if severity == 2 then
		if rng:chance(0.5) then
			return "yellow"
		end
		if rng:chance(0.4) then
			return "virtual-safety-car"
		end
		return "none"
	end
	if severity == 3 then
		if circuit.danger > 0.6 or kind == "barrier" then
			return "safety-car"
		end
		return rng:chance(0.6) and "safety-car" or "virtual-safety-car"
	end
	return rng:chance(0.25) and "red-flag" or "safety-car"
end

-- Roll a single incident for a car on a lap. Returns nil most laps.
local function generateIncident(rng, ctx, raceId)
	local p = computeLapIncidentRisk(ctx)
	if not rng:chance(p) then
		return nil
	end

	local kind = pickKind(rng, ctx)
	local severity = pickSeverity(rng, ctx, kind)
	local other = nil
	if not (kind == "mechanical"
		or kind == "tire-failure"
		or kind == "spin"
		or kind == "lock-up"
		or kind == "barrier"
		or kind == "debris"
		or kind == "aquaplaning"
		or kind == "near-miss") then
		for _, n in ipairs(ctx.nearby) do
			if math.abs(n.gap) < 1.2 then
				other = n
				break
			end
		end
	end

	local involvedIds = { ctx.driverId }
	if other then
		involvedIds[#involvedIds + 1] = other.driverId
	end
	local aIsBehind = other and other.gap < 0 or false
	local primaryIsAhead = not aIsBehind
	local dmg = damageForKind(rng, kind, severity, primaryIsAhead)

	local damage = { [ctx.driverId] = dmg.primary }
	if other then
		damage[other.driverId] = dmg.secondary
	end

	local resp = responsibility(rng, kind, ctx, other)

	local template = rng:pick(NARRATIVE[kind])

	local factors = {}
	if ctx.weather.trackWetness > 0.3 then
		factors[#factors + 1] = "wet track (" .. round(ctx.weather.trackWetness * 100) .. "%)"
	end
	if ctx.tireAge > 15 then
		factors[#factors + 1] = "worn tyres (" .. ctx.tireAge .. " laps)"
	end
	if ctx.tireGrip < 0.9 then
		factors[#factors + 1] = "reduced grip (" .. round(ctx.tireGrip * 100) .. "%)"
	end
	if next(dmg.primary) ~= nil then
		factors[#factors + 1] = "light contact"
	end
	if ctx.isFirstLap then
		factors[#factors + 1] = "first-lap congestion"
	end
	if #ctx.nearby > 0 then
		factors[#factors + 1] = "wheel-to-wheel battle"
	end
	local overallDamage = 0
	for _, k in ipairs(Damage.ORDER) do
		overallDamage += ctx.damage[k] or 0
	end
	if overallDamage > 0.3 then
		factors[#factors + 1] = "pre-existing damage"
	end
	if #factors == 0 then
		factors[#factors + 1] = "loss of grip"
	end

	local narrative = template:gsub("{a}", ctx.driver.name):gsub("{b}", other and other.driverId or "")

	return {
		id = raceId .. ":inc:" .. ctx.lap .. ":" .. ctx.driverId .. ":" .. math.floor(rng:next() * 1e6),
		raceId = raceId,
		lap = ctx.lap,
		trackPosition = rng:range(0, 1),
		corner = "Turn " .. rng:int(1, ctx.circuit.corners),
		kind = kind,
		severity = severity,
		involvedDriverIds = involvedIds,
		responsibility = resp.finding,
		responsibleDriverId = resp.responsible,
		damage = damage,
		narrative = narrative,
		factors = factors,
		penalty = resp.penalty,
		neutralisation = neutralisation(severity, kind, ctx.circuit, rng),
	}
end

Incidents.computeLapIncidentRisk = computeLapIncidentRisk
Incidents.generateIncident = generateIncident

return Incidents
