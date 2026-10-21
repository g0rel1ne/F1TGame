-- Ported 1:1 from src/data/drivers.ts
-- Driver construction. RNG consumption order matches the TypeScript exactly.

local Rng = require(script.Parent.Rng)
local Drivers = require(script.Parent.Parent.Data.Drivers)

local RngClass = Rng.Rng
local clamp = Rng.clamp
local round = Rng.round

local TIER = Drivers.TIER
local FICTIONAL_SEEDS = Drivers.FICTIONAL_SEEDS
local REAL_SEEDS = Drivers.REAL_SEEDS

local DriverFactory = {}

local function has(list, value)
	if not list then
		return false
	end
	for _, v in ipairs(list) do
		if v == value then
			return true
		end
	end
	return false
end

local function copyTraits(traits)
	local out = {}
	if traits then
		for i, v in ipairs(traits) do
			out[i] = v
		end
	end
	return out
end

local function mk(seed, id, salt)
	local rng
	if salt then
		rng = RngClass.new("driver:" .. salt .. ":" .. seed.name)
	else
		rng = RngClass.new("driver:" .. seed.name)
	end
	local t = TIER[seed.tier]
	local base = t.mu

	local function att(offset, spread)
		offset = offset or 0
		spread = spread or t.spread
		return round(clamp(base + offset + rng:gaussian(0, spread), 40, 99))
	end

	local traits = copyTraits(seed.traits)
	local ageFactor = (seed.age < 23 and -1.5) or (seed.age > 34 and -2.5) or 0

	local attributes = {
		pace = att(ageFactor),
		qualifying = att(has(traits, "qualifying-specialist") and 4 or 0),
		racecraft = att(has(traits, "defensive") and 3 or 0),
		overtaking = att(has(traits, "aggressive") and 4 or 0),
		defending = att(has(traits, "defensive") and 5 or 0),
		tireManagement = att(has(traits, "tire-whisperer") and 6 or 0),
		wet = att(has(traits, "wet-master") and 7 or 0),
		consistency = att(has(traits, "consistent") and 5 or (has(traits, "fast-but-error-prone") and -7 or 0)),
		concentration = att(has(traits, "fast-but-error-prone") and -5 or 0),
		aggression = round(clamp((has(traits, "aggressive") and 0.78 or 0.5) + rng:gaussian(0, 0.12), 0.1, 0.98), 2),
		experience = round(clamp(t.exp + (seed.age - 25) * 4, 5, 100)),
	}

	-- Potential is re-rolled every career so no two saves share the same ceiling.
	local potential = rng:int(85, 99)

	return {
		id = id,
		name = seed.name,
		code = seed.code,
		nationality = seed.nationality,
		country = seed.country,
		age = seed.age,
		isRealPerson = seed.isRealPerson or false,
		portraitSeed = seed.name,
		attributes = attributes,
		potential = potential,
		peakAge = seed.tier == "rookie" and 27 or 29,
		salaryDemand = round(t.salary * rng:range(0.85, 1.2)),
		marketability = round(clamp((t.rep + rng:gaussian(0, 6)) / 100, 0.15, 0.99), 2),
		reputation = round(clamp(t.rep + rng:gaussian(0, 5), 20, 99)),
		morale = round(rng:range(62, 82)),
		traits = traits,
		teamId = nil,
		scoutedAbility = round(clamp(t.mu + rng:gaussian(0, 4), 40, 99)),
		-- Evaluated inline so the RNG stream stays aligned with the TypeScript source.
		starts = (function()
			if seed.age > 30 then
				return rng:int(120, 260)
			elseif seed.tier == "rookie" then
				return rng:int(0, 12)
			else
				return rng:int(20, 120)
			end
		end)(),
		careerWins = 0,
		careerPodiums = 0,
		careerPoles = 0,
		careerPoints = 0,
		championships = 0,
	}
end

local function buildFictionalDrivers(salt)
	local out = {}
	for i, s in ipairs(FICTIONAL_SEEDS) do
		out[i] = mk(s, "f-driver-" .. (i - 1), salt)
	end
	return out
end

local function buildRealDrivers(salt)
	local out = {}
	for i, s in ipairs(REAL_SEEDS) do
		out[i] = mk(s, "r-driver-" .. (i - 1), salt)
	end
	return out
end

DriverFactory.mk = mk
DriverFactory.buildFictionalDrivers = buildFictionalDrivers
DriverFactory.buildRealDrivers = buildRealDrivers
DriverFactory.FICTIONAL_DRIVER_COUNT = #FICTIONAL_SEEDS

return DriverFactory
