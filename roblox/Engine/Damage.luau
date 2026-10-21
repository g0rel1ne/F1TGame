-- Ported 1:1 from src/engine/damage.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local Damage = {}

-- Canonical key order (matches the object literal order in the TypeScript so
-- floating-point summation is identical).
Damage.ORDER = {
	"frontWing",
	"rearWing",
	"floor",
	"sidepod",
	"suspension",
	"steering",
	"brakes",
	"chassis",
	"cooling",
	"gearbox",
	"engine",
	"tire",
}

local function initDamage()
	local d = {}
	for _, k in ipairs(Damage.ORDER) do
		d[k] = 0
	end
	return d
end

local function applyDamage(current, partial)
	local next_ = {}
	for _, k in ipairs(Damage.ORDER) do
		next_[k] = current[k] or 0
	end
	for _, key in ipairs(Damage.ORDER) do
		if partial[key] ~= nil then
			next_[key] = clamp((next_[key] or 0) + (partial[key] or 0), 0, 1)
		end
	end
	return next_
end

local function totalDamage(damage)
	local sum = 0
	for _, k in ipairs(Damage.ORDER) do
		sum += damage[k] or 0
	end
	return sum
end

-- Damage level 0..1 that is likely to end a race.
local function isTerminal(damage)
	if damage.chassis >= 0.85 then
		return "Chassis damage beyond safe repair"
	end
	if damage.engine >= 0.92 then
		return "Power unit failure"
	end
	if damage.gearbox >= 0.9 then
		return "Gearbox failure"
	end
	if damage.suspension >= 0.85 then
		return "Suspension damage"
	end
	if damage.steering >= 0.8 then
		return "Steering failure"
	end
	if damage.brakes >= 0.9 then
		return "Brake failure"
	end
	if damage.cooling >= 0.9 then
		return "Overheating — cooling system failure"
	end
	return nil
end

-- Estimated cost (USD) to repair a damage state at the factory.
local REPAIR_COSTS = {
	frontWing = 120000,
	rearWing = 150000,
	floor = 220000,
	sidepod = 90000,
	suspension = 180000,
	steering = 140000,
	brakes = 70000,
	chassis = 900000,
	cooling = 110000,
	gearbox = 700000,
	engine = 950000,
	tire = 8000,
}

local function repairCost(damage, facilityLevel)
	local total = 0
	for _, key in ipairs(Damage.ORDER) do
		total += REPAIR_COSTS[key] * (damage[key] or 0)
	end
	-- Better factories reduce labour cost.
	local discount = 1 - clamp(facilityLevel, 0, 5) * 0.06
	return round(total * discount)
end

-- Spare parts likely consumed by a given damage profile.
local function sparePartsNeeded(damage)
	local parts = {}
	if damage.frontWing > 0.2 then
		parts[#parts + 1] = "front-wing"
	end
	if damage.rearWing > 0.2 then
		parts[#parts + 1] = "rear-wing"
	end
	if damage.floor > 0.2 then
		parts[#parts + 1] = "floor"
	end
	if damage.sidepod > 0.2 then
		parts[#parts + 1] = "sidepod"
	end
	if damage.suspension > 0.2 then
		parts[#parts + 1] = "suspension"
	end
	return parts
end

Damage.initDamage = initDamage
Damage.applyDamage = applyDamage
Damage.totalDamage = totalDamage
Damage.isTerminal = isTerminal
Damage.repairCost = repairCost
Damage.sparePartsNeeded = sparePartsNeeded

return Damage
