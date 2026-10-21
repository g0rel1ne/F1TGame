-- Ported 1:1 from the builders in src/data/teams.ts
-- AI team + car construction. RNG consumption order matches the TypeScript.

local Rng = require(script.Parent.Rng)
local Development = require(script.Parent.Development)
local Teams = require(script.Parent.Parent.Data.Teams)

local RngClass = Rng.Rng
local clamp = Rng.clamp
local round = Rng.round

local TIER_CAR = Teams.TIER_CAR
local TIER_OBJECTIVE = Teams.TIER_OBJECTIVE
local UPGRADE_POOL = Teams.UPGRADE_POOL

local TeamFactory = {}

local function carFromTier(rng, tier, focus)
	local tierData = TIER_CAR[tier]
	local mu = tierData.mu
	local spread = tierData.spread

	local function a(o)
		o = o or 0
		return round(clamp(mu + o + rng:gaussian(0, spread), 55, 99))
	end

	-- Consumed before the object literal, exactly as in the TypeScript source.
	local reliability = clamp(mu - 2 + rng:gaussian(0, spread), 55, 99)

	return {
		teamId = "",
		season = 1,
		aeroEfficiency = a(focus == "aero" and 4 or 0),
		downforce = a(focus == "aero" and 4 or 0),
		drag = round(clamp(100 - mu + (focus == "power" and -6 or 0) + rng:gaussian(0, spread), 5, 60)),
		cornering = a(focus == "aero" and 3 or 0),
		straightLine = a(focus == "power" and 5 or 0),
		braking = a(),
		mechanicalGrip = a(focus == "mechanical" and 5 or 0),
		tireFriendliness = a(),
		fuelEfficiency = a(),
		reliability = round(reliability),
		cooling = a(),
		wetPerformance = a(),
		weight = round(clamp(800 - (mu - 75) * 4 + rng:gaussian(0, 6), 700, 830)),
		installed = Development.emptyInstalled(),
	}
end

local DIFFICULTY_BASE = { beginner = 0.3, normal = 0.5, expert = 0.7, elite = 0.9 }

local function difficultyProfile(difficulty, seed)
	local q = DIFFICULTY_BASE[difficulty]
	return {
		difficulty = difficulty,
		focusAero = clamp(seed:range(0.4, 0.9), 0, 1),
		focusMechanical = clamp(seed:range(0.3, 0.8), 0, 1),
		focusReliability = clamp(seed:range(0.3, 0.8), 0, 1),
		riskAppetite = clamp(q + seed:gaussian(0, 0.1), 0.05, 0.95),
		strategyIQ = clamp(q + seed:gaussian(0, 0.08), 0.1, 0.98),
		developmentEfficiency = clamp(0.5 + q * 0.5 + seed:gaussian(0, 0.06), 0.2, 0.99),
	}
end

local BUDGET_BY_TIER = { top = 145000000, upper = 135000000, mid = 120000000, lower = 105000000 }
local REP_BY_TIER = { top = 88, upper = 76, mid = 66, lower = 58 }

local function buildAiTeam(seed, index, careerId, difficulty)
	local rng = RngClass.new("team:" .. seed.abbreviation .. ":" .. difficulty)
	local id = "ai-team-" .. index
	local profile = difficultyProfile(difficulty, rng)

	local colors = seed.colors
	local team = {
		id = id,
		careerId = careerId,
		name = seed.name,
		shortName = seed.shortName,
		abbreviation = seed.abbreviation,
		nationality = seed.nationality,
		isPlayerTeam = false,
		ownerUserId = nil,
		colors = { primary = colors.primary, secondary = colors.secondary, accent = colors.accent },
		livery = {
			nose = colors.primary,
			frontWing = colors.secondary,
			sidepod = colors.primary,
			engineCover = colors.primary,
			rearWing = colors.secondary,
			accentStripe = colors.accent,
			halo = colors.secondary,
		},
		numberStyle = "classic",
		logo = { symbol = "wing", background = colors.primary },
		headquarters = seed.headquarters,
		engineSupplier = seed.engine,
		philosophy = seed.philosophy,
		budget = BUDGET_BY_TIER[seed.tier],
		reputation = REP_BY_TIER[seed.tier],
		objective = TIER_OBJECTIVE[seed.tier],
		aiProfile = profile,
	}

	local car = carFromTier(rng, seed.tier, seed.focus)
	car.teamId = id
	-- Give AI teams a couple of pre-installed development points so the grid is not uniform.
	local picks = rng:shuffle(UPGRADE_POOL)
	local count = 2 + (seed.tier == "top" and 1 or 0)
	for i = 1, count do
		local area = picks[i]
		car.installed[area] = round(rng:range(0.5, 2.0), 2)
	end

	return { team = team, car = car }
end

TeamFactory.carFromTier = carFromTier
TeamFactory.difficultyProfile = difficultyProfile
TeamFactory.buildAiTeam = buildAiTeam

return TeamFactory
