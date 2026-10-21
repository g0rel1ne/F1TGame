-- Ported 1:1 from src/engine/development.ts
-- Development metadata, facilities and upgrade-project mechanics.

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp

local UPGRADE_META = {
	["front-wing"] = { name = "Front Wing", baseCost = 1400000, baseTicks = 2, nominalGain = 2.4, category = "aero" },
	["rear-wing"] = { name = "Rear Wing", baseCost = 1300000, baseTicks = 2, nominalGain = 2.2, category = "aero" },
	floor = { name = "Floor", baseCost = 2200000, baseTicks = 3, nominalGain = 3.6, category = "aero" },
	sidepods = { name = "Sidepods", baseCost = 1600000, baseTicks = 2, nominalGain = 2.0, category = "aero" },
	suspension = { name = "Suspension", baseCost = 1500000, baseTicks = 2, nominalGain = 2.0, category = "mechanical" },
	chassis = { name = "Chassis", baseCost = 2500000, baseTicks = 3, nominalGain = 2.6, category = "mechanical" },
	brakes = { name = "Brake System", baseCost = 900000, baseTicks = 1, nominalGain = 1.6, category = "mechanical" },
	cooling = { name = "Cooling", baseCost = 800000, baseTicks = 1, nominalGain = 1.2, category = "reliability" },
	engine = { name = "Engine Integration", baseCost = 3000000, baseTicks = 4, nominalGain = 3.4, category = "power" },
	gearbox = { name = "Gearbox", baseCost = 2400000, baseTicks = 3, nominalGain = 2.2, category = "power" },
	reliability = { name = "Reliability Package", baseCost = 1200000, baseTicks = 2, nominalGain = 2.0, category = "reliability" },
}

local FACILITY_META = {
	factory = { name = "Factory", baseCost = 12000000, effect = "Manufacturing capacity and repair speed" },
	["design-office"] = { name = "Design Office", baseCost = 10000000, effect = "Upgrade quality and design speed" },
	["wind-tunnel"] = { name = "Wind Tunnel", baseCost = 18000000, effect = "Aerodynamic research throughput" },
	simulator = { name = "Simulator", baseCost = 9000000, effect = "Setup accuracy and driver development" },
	["driver-academy"] = { name = "Driver Academy", baseCost = 7000000, effect = "Young driver growth and scouting" },
	["pit-crew"] = { name = "Pit Crew Training", baseCost = 8000000, effect = "Faster, safer pit stops" },
	commercial = { name = "Commercial Department", baseCost = 6000000, effect = "Sponsorship income and reputation" },
	["reliability-lab"] = { name = "Reliability Lab", baseCost = 8000000, effect = "Fewer mechanical failures" },
	hospitality = { name = "Hospitality", baseCost = 5000000, effect = "Reputation and staff morale" },
}

local Development = {}

Development.UPGRADE_META = UPGRADE_META
Development.FACILITY_META = FACILITY_META

local function facilityLevel(facilities, kind)
	for _, f in ipairs(facilities) do
		if f.kind == kind then
			return f.level
		end
	end
	return 0
end

local function facilityUpgradeCost(kind, currentLevel)
	return math.floor(FACILITY_META[kind].baseCost * (0.6 + currentLevel * 0.5) + 0.5)
end

local function developmentModifiers(facilities, topStaffSkill)
	local design = facilityLevel(facilities, "design-office")
	local tunnel = facilityLevel(facilities, "wind-tunnel")
	local sim = facilityLevel(facilities, "simulator")
	local reliabilityLab = facilityLevel(facilities, "reliability-lab")
	local pitCrew = facilityLevel(facilities, "pit-crew")

	return {
		speed = 1 + design * 0.09 + tunnel * 0.07 + topStaffSkill / 400,
		quality = 1 + design * 0.06 + (topStaffSkill - 60) / 300,
		maxConcurrent = math.max(1, 1 + math.floor(tunnel / 1.5) + math.floor(design / 3) + (sim >= 3 and 1 or 0)),
		reliabilityBonus = reliabilityLab * 0.03,
		pitStopBonus = pitCrew * 0.06,
	}
end

-- Date.now() equivalent (milliseconds since the Unix epoch).
local function nowMillis(): number
	return os.time() * 1000
end

local digits = "0123456789abcdefghijklmnopqrstuvwxyz"
local function base36(n: number): string
	if n <= 0 then
		return "0"
	end
	local s = ""
	while n > 0 do
		local d = n % 36
		s = digits:sub(d + 1, d + 1) .. s
		n = math.floor(n / 36)
	end
	return s
end

local function createUpgradeProject(rng, params)
	local meta = UPGRADE_META[params.area]
	local cost = math.floor(meta.baseCost * rng:range(0.9, 1.15) + 0.5)
	local ticks = math.max(1, math.floor(meta.baseTicks / clamp(params.mods.speed, 0.5, 2.5) + 0.5))
	local quality = clamp(rng:gaussian(70 * params.mods.quality, 12), 25, 100)
	local gain = meta.nominalGain * (0.6 + quality / 200)

	return {
		id = "proj-" .. params.teamId .. "-" .. params.area .. "-" .. base36(nowMillis()) .. "-" .. math.floor(rng:next() * 1e5),
		careerId = params.careerId,
		teamId = params.teamId,
		area = params.area,
		name = meta.name .. " upgrade",
		quality = quality,
		cost = cost,
		durationTicks = ticks,
		ticksRemaining = ticks,
		nominalGain = gain,
		completed = false,
		installed = false,
		season = params.season,
		createdAt = nowMillis(),
	}
end

local function tickProject(project)
	if project.completed then
		return project
	end
	local remaining = math.max(0, project.ticksRemaining - 1)
	local out = table.clone(project)
	out.ticksRemaining = remaining
	out.completed = remaining == 0
	return out
end

-- Install a completed project onto a car. Each area's points stack.
local function installUpgrade(car, project)
	if not project.completed then
		error("Cannot install an unfinished upgrade")
	end
	local installed = table.clone(car.installed)
	installed[project.area] = (installed[project.area] or 0) + project.nominalGain
	local out = table.clone(car)
	out.installed = installed
	return out
end

local function emptyInstalled()
	return {
		["front-wing"] = 0,
		["rear-wing"] = 0,
		floor = 0,
		sidepods = 0,
		suspension = 0,
		chassis = 0,
		brakes = 0,
		cooling = 0,
		engine = 0,
		gearbox = 0,
		reliability = 0,
	}
end

Development.facilityLevel = facilityLevel
Development.facilityUpgradeCost = facilityUpgradeCost
Development.developmentModifiers = developmentModifiers
Development.createUpgradeProject = createUpgradeProject
Development.tickProject = tickProject
Development.installUpgrade = installUpgrade
Development.emptyInstalled = emptyInstalled
Development.nowMillis = nowMillis

return Development
