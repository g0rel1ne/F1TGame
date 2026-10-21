-- Ported 1:1 from src/engine/season.ts
-- Career spine: calendar generation, career creation, team/driver management,
-- practice/qualifying/race weekends, results processing, season rollover and AI
-- development. All randomness flows through named, deterministic Rng streams.

local RngModule = require(script.Parent.Rng)
local Rng = RngModule.Rng
local clamp = RngModule.clamp
local hashSeed = RngModule.hashSeed
local round = RngModule.round

local TeamFactory = require(script.Parent.TeamFactory)
local DriverFactory = require(script.Parent.DriverFactory)
local StaffFactory = require(script.Parent.StaffFactory)
local Qualifying = require(script.Parent.Qualifying)
local Race = require(script.Parent.Race)
local Practice = require(script.Parent.Practice)
local Standings = require(script.Parent.Standings)
local Weather = require(script.Parent.Weather)
local Strategy = require(script.Parent.Strategy)
local Finance = require(script.Parent.Finance)
local Damage = require(script.Parent.Damage)
local Development = require(script.Parent.Development)
local DriverMarket = require(script.Parent.DriverMarket)
local Car = require(script.Parent.Car)

local CircuitsData = require(script.Parent.Parent.Data.Circuits)
local RulesetsData = require(script.Parent.Parent.Data.Rulesets)
local SponsorsData = require(script.Parent.Parent.Data.Sponsors)
local TeamsData = require(script.Parent.Parent.Data.Teams)
local StaffData = require(script.Parent.Parent.Data.Staff)

local Season = {}

-- -- small helpers -------------------------------------------------------------

local function shallow(t)
	local o = {}
	for k, v in pairs(t) do
		o[k] = v
	end
	return o
end

local function merged(t, over)
	local o = shallow(t)
	for k, v in pairs(over) do
		o[k] = v
	end
	return o
end

-- Lua cannot express a nil table value, so `{ teamId = nil }` is empty. Detaching a
-- driver from their team must delete the key explicitly.
local function detach(d, moraleDelta)
	local c = merged(d, { morale = clamp(d.morale + moraleDelta, 0, 100) })
	c.teamId = nil
	return c
end

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

local function indexOf(list, value)
	for i, v in ipairs(list) do
		if v == value then
			return i
		end
	end
	return -1
end

local function includes(list, value)
	return indexOf(list, value) >= 0
end

local function slice(arr, from0, to0)
	local out = {}
	local n = #arr
	for i = from0, math.min(to0, n) - 1 do
		out[#out + 1] = arr[i + 1]
	end
	return out
end

local function findWhere(arr, pred)
	for _, v in ipairs(arr) do
		if pred(v) then
			return v
		end
	end
	return nil
end

local function filter(arr, pred)
	local out = {}
	for _, v in ipairs(arr) do
		if pred(v) then
			out[#out + 1] = v
		end
	end
	return out
end

local function map(arr, fn)
	local out = {}
	for i, v in ipairs(arr) do
		out[i] = fn(v)
	end
	return out
end

local function sum(arr)
	local total = 0
	for _, v in ipairs(arr) do
		total += v
	end
	return total
end

-- -- consts --------------------------------------------------------------------

Season.ROSTER_CONFIG = { useRealDrivers = false }
Season.BUNDLE_VERSION = 1

local BASE_ORDER = {
	"bahrain", "jeddah", "albert-park", "suzuka", "shanghai", "miami", "monaco", "barcelona",
	"montreal", "silverstone", "spa", "hungaroring", "zandvoort", "monza", "singapore",
	"cota", "mexico", "interlagos", "las-vegas", "lusail", "yas-marina",
}
local MUST = { "bahrain", "monaco", "silverstone", "monza", "interlagos", "yas-marina" }

-- -- calendar ------------------------------------------------------------------

function Season.generateCalendar(rng, seasonLength)
	local all = {}
	for _, c in ipairs(CircuitsData.ALL) do
		all[#all + 1] = c.id
	end
	local baseOrder = {}
	for _, id in ipairs(BASE_ORDER) do
		if includes(all, id) then
			baseOrder[#baseOrder + 1] = id
		end
	end

	local calendar = baseOrder
	if seasonLength < #baseOrder then
		local must = {}
		for _, c in ipairs(MUST) do
			if includes(baseOrder, c) then
				must[#must + 1] = c
			end
		end
		local rest = {}
		for _, c in ipairs(baseOrder) do
			if not includes(must, c) then
				rest[#rest + 1] = c
			end
		end
		rest = rng:shuffle(rest)
		local combined = {}
		for _, c in ipairs(must) do
			combined[#combined + 1] = c
		end
		for _, c in ipairs(rest) do
			combined[#combined + 1] = c
		end
		combined = stableSort(combined, function(a, b)
			return indexOf(baseOrder, a) < indexOf(baseOrder, b)
		end)
		combined = slice(combined, 0, seasonLength)
		local keep = {}
		for _, c in ipairs(combined) do
			keep[c] = true
		end
		local filtered = {}
		for _, c in ipairs(baseOrder) do
			if keep[c] then
				filtered[#filtered + 1] = c
			end
		end
		calendar = filtered
	end

	local sprintCount = math.max(0, math.min(6, round(seasonLength / 5)))
	local idxArr = {}
	for i = 0, #calendar - 1 do
		idxArr[#idxArr + 1] = i
	end
	local shuffled = rng:shuffle(idxArr)
	local sprint = {}
	for i = 1, sprintCount do
		sprint[#sprint + 1] = shuffled[i]
	end
	sprint = stableSort(sprint, function(a, b)
		return a < b
	end)
	return { calendar = calendar, sprintRaces = sprint }
end

-- -- career creation -----------------------------------------------------------

function Season.createCareerBundle(params)
	local rng = Rng.new("career:" .. params.careerId)
	local rulesetId = RulesetsData.DEFAULT_ID
	local cal = Season.generateCalendar(rng, params.settings.seasonLength)
	local calendar = cal.calendar
	local sprintRaces = cal.sprintRaces

	local season = {
		id = params.careerId .. ":s1",
		careerId = params.careerId,
		number = 1,
		rulesetId = rulesetId,
		calendar = calendar,
		currentRaceIndex = 0,
		completed = false,
		championDriverId = nil,
		championTeamId = nil,
		sprintRaces = sprintRaces,
	}

	local career = {
		id = params.careerId,
		lobbyId = params.lobbyId,
		name = params.name,
		createdAt = DateTime.now().UnixTimestampMillis,
		currentSeason = 1,
		rulesHistory = { ["1"] = rulesetId },
		phase = "setup",
	}

	local teams = {}
	local cars = {}
	local facilities = {}
	local finances = {}
	local staff = {}
	for i, seed in ipairs(TeamsData.TEAM_SEEDS) do
		local built = TeamFactory.buildAiTeam(seed, i - 1, params.careerId, params.settings.aiDifficulty)
		local team = built.team
		local car = built.car
		teams[#teams + 1] = team
		car.season = 1
		cars[#cars + 1] = car
		for _, f in ipairs(Season.initialFacilities(team.id)) do
			facilities[#facilities + 1] = f
		end
		finances[#finances + 1] = { teamId = team.id, balance = team.budget, season = 1 }
		local quality = team.reputation / 100
		for _, s in ipairs(StaffFactory.buildStaff(params.careerId, team.id, quality, team.id .. ":s1")) do
			staff[#staff + 1] = s
		end
	end

	local drivers
	if Season.ROSTER_CONFIG.useRealDrivers then
		drivers = DriverFactory.buildRealDrivers()
		local extra = DriverFactory.buildFictionalDrivers(params.careerId)
		for i, d in ipairs(extra) do
			local copy = shallow(d)
			copy.id = "f-driver-" .. (i - 1)
			drivers[#drivers + 1] = copy
		end
	else
		drivers = DriverFactory.buildFictionalDrivers(params.careerId)
	end

	local assigned = {}
	local byTier = stableSort(teams, function(a, b)
		return a.reputation > b.reputation
	end)
	local sortedDrivers
	if Season.ROSTER_CONFIG.useRealDrivers then
		sortedDrivers = stableSort(drivers, function(a, b)
			return a.reputation > b.reputation
		end)
	else
		sortedDrivers = stableSort(drivers, function(a, b)
			return (a.attributes.pace + a.potential) > (b.attributes.pace + b.potential)
		end)
	end

	local di = 0
	for _, team in ipairs(byTier) do
		for _ = 0, 1 do
			if di < #sortedDrivers then
				local d = nil
				for i = di + 1, #sortedDrivers do
					if not assigned[sortedDrivers[i].id] then
						d = sortedDrivers[i]
						break
					end
				end
				if not d then
					break
				end
				assigned[d.id] = true
				d.teamId = team.id
				di = indexOf(sortedDrivers, d)
			else
				break
			end
		end
	end

	local driverContracts = {}
	for _, d in ipairs(drivers) do
		if d.teamId then
			driverContracts[#driverContracts + 1] = Season.makeDriverContract(params.careerId, d.id, d.teamId, 1, 2)
		end
	end

	local weekendCircuit = calendar[1]
	local bundle = {
		version = Season.BUNDLE_VERSION,
		career = career,
		settings = params.settings,
		seasons = { season },
		season = season,
		teams = teams,
		cars = cars,
		drivers = drivers,
		driverContracts = driverContracts,
		transferOffers = {},
		staff = staff,
		staffMarket = StaffFactory.buildStaffMarket(params.careerId, 24),
		facilities = facilities,
		finances = finances,
		transactions = {},
		upgrades = {},
		sponsors = SponsorsData.SPONSORS,
		sponsorContracts = {},
		standings = { season = 1, drivers = {}, constructors = {} },
		results = {},
		news = {},
		practice = {},
		setups = {},
		gridPenalties = {},
		weekend = {
			season = 1,
			raceIndex = 0,
			circuitId = weekendCircuit,
			session = "preparation",
			weather = Weather.initialWeather(rng, CircuitsData.get(weekendCircuit)),
			readyUserIds = {},
			resultId = nil,
			startedAt = nil,
		},
	}

	for _, team in ipairs(teams) do
		bundle.setups[team.id] = { setup = { downforce = 3, balance = 0 }, practiceTicks = 0 }
		if not team.isPlayerTeam then
			local sponsor = Season.pickSponsorForTeam(rng, team)
			if sponsor then
				bundle.sponsorContracts[#bundle.sponsorContracts + 1] = {
					id = "sc-" .. team.id .. "-" .. sponsor.id,
					careerId = params.careerId,
					teamId = team.id,
					sponsorId = sponsor.id,
					seasons = 2,
					startSeason = 1,
					active = true,
				}
			end
		end
	end

	return bundle
end

local function findNextDriver(sorted, assigned, from)
	for i = from + 1, #sorted do
		if not assigned[sorted[i].id] then
			return sorted[i]
		end
	end
	return nil
end

function Season.initialFacilities(teamId)
	local kinds = {
		"factory", "design-office", "wind-tunnel", "simulator",
		"driver-academy", "pit-crew", "commercial", "reliability-lab", "hospitality",
	}
	local out = {}
	for i, kind in ipairs(kinds) do
		local level
		if kind == "factory" then
			level = 2
		elseif (i - 1) % 3 == 0 then
			level = 2
		else
			level = 1
		end
		out[#out + 1] = { id = teamId .. ":" .. kind, teamId = teamId, kind = kind, level = level }
	end
	return out
end

function Season.makeDriverContract(careerId, driverId, teamId, season, years)
	return {
		id = "dc-" .. driverId .. "-" .. teamId .. "-" .. season,
		careerId = careerId,
		driverId = driverId,
		teamId = teamId,
		season = season,
		salary = 0,
		signingBonus = 0,
		winBonus = 0,
		podiumBonus = 0,
		championshipBonus = 0,
		years = years,
		performanceClausePosition = nil,
		active = true,
	}
end

function Season.pickSponsorForTeam(rng, team)
	local eligible = filter(SponsorsData.SPONSORS, function(s)
		return team.reputation >= s.minReputation - 6
	end)
	if #eligible == 0 then
		return nil
	end
	return eligible[rng:int(0, #eligible - 1) + 1]
end

-- -- player teams --------------------------------------------------------------

function Season.addPlayerTeam(bundle, params)
	local nameTaken = false
	for _, t in ipairs(bundle.teams) do
		if string.lower(t.name) == string.lower(params.name) or string.lower(t.abbreviation) == string.lower(params.abbreviation) then
			nameTaken = true
			break
		end
	end
	if nameTaken then
		error("Team name or abbreviation already in use in this lobby.")
	end

	local playerCount = 0
	for _, t in ipairs(bundle.teams) do
		if t.isPlayerTeam then
			playerCount += 1
		end
	end
	local teamId = "player-team-" .. (playerCount + 1)
	local colors = params.colors
	local team = {
		id = teamId,
		careerId = bundle.career.id,
		name = params.name,
		shortName = params.shortName,
		abbreviation = string.upper(string.sub(params.abbreviation, 1, 3)),
		nationality = params.nationality,
		isPlayerTeam = true,
		ownerUserId = params.userId,
		colors = colors,
		livery = params.livery or {
			nose = colors.primary,
			frontWing = colors.secondary,
			sidepod = colors.primary,
			engineCover = colors.primary,
			rearWing = colors.secondary,
			accentStripe = colors.accent,
			halo = colors.secondary,
		},
		numberStyle = params.numberStyle,
		logo = params.logo or { symbol = "bolt", background = colors.primary },
		headquarters = params.headquarters,
		engineSupplier = params.engineSupplier,
		philosophy = params.philosophy,
		budget = params.budget,
		reputation = 55,
		objective = 10,
		aiProfile = nil,
	}

	local rng = Rng.new("playercar:" .. teamId .. ":" .. bundle.career.id)
	local car = {
		teamId = teamId,
		season = bundle.season.number,
		aeroEfficiency = round(72 + rng:gaussian(0, 1.5)),
		downforce = round(72 + rng:gaussian(0, 1.5)),
		drag = round(24 + rng:gaussian(0, 2)),
		cornering = round(72 + rng:gaussian(0, 1.5)),
		straightLine = round(74 + rng:gaussian(0, 1.5)),
		braking = round(72 + rng:gaussian(0, 1.5)),
		mechanicalGrip = round(72 + rng:gaussian(0, 1.5)),
		tireFriendliness = round(72 + rng:gaussian(0, 1.5)),
		fuelEfficiency = round(75 + rng:gaussian(0, 1.5)),
		reliability = round(78 + rng:gaussian(0, 1.5)),
		cooling = round(74 + rng:gaussian(0, 1.5)),
		wetPerformance = round(72 + rng:gaussian(0, 1.5)),
		weight = round(810 + rng:gaussian(0, 6)),
		installed = Development.emptyInstalled(),
	}

	local newTeams = {}
	for _, t in ipairs(bundle.teams) do
		newTeams[#newTeams + 1] = t
	end
	newTeams[#newTeams + 1] = team
	local newCars = {}
	for _, c in ipairs(bundle.cars) do
		newCars[#newCars + 1] = c
	end
	newCars[#newCars + 1] = car
	local newFacilities = {}
	for _, f in ipairs(bundle.facilities) do
		newFacilities[#newFacilities + 1] = f
	end
	for _, f in ipairs(Season.initialFacilities(teamId)) do
		newFacilities[#newFacilities + 1] = f
	end
	local newFinances = {}
	for _, f in ipairs(bundle.finances) do
		newFinances[#newFinances + 1] = f
	end
	newFinances[#newFinances + 1] = { teamId = teamId, balance = params.budget, season = bundle.season.number }
	local newSetups = shallow(bundle.setups)
	newSetups[teamId] = { setup = { downforce = 3, balance = 0 }, practiceTicks = 0 }

	local startingTxn = Finance.makeTxn({ careerId = bundle.career.id, teamId = teamId, season = bundle.season.number, raceIndex = 0 }, "starting-capital", params.budget, "Starting capital")

	local newTransactions = {}
	for _, t in ipairs(bundle.transactions) do
		newTransactions[#newTransactions + 1] = t
	end
	newTransactions[#newTransactions + 1] = startingTxn

	return {
		bundle = merged(bundle, {
			teams = newTeams,
			cars = newCars,
			facilities = newFacilities,
			finances = newFinances,
			setups = newSetups,
			transactions = newTransactions,
			career = merged(bundle.career, { phase = "in-season" }),
		}),
		teamId = teamId,
	}
end

function Season.signDriver(bundle, params)
	local driver = findWhere(bundle.drivers, function(d)
		return d.id == params.driverId
	end)
	if not driver then
		error("Driver not found")
	end
	if driver.teamId and driver.teamId ~= params.teamId then
		error(driver.name .. " is already contracted to another team.")
	end
	local teamDrivers = filter(bundle.drivers, function(d)
		return d.teamId == params.teamId
	end)
	if #teamDrivers >= 3 then
		error("A team may contract at most three drivers.")
	end

	local contract = {
		id = "dc-" .. params.driverId .. "-" .. params.teamId .. "-" .. DateTime.now().UnixTimestampMillis,
		careerId = bundle.career.id,
		driverId = params.driverId,
		teamId = params.teamId,
		season = bundle.season.number,
		salary = params.salary,
		signingBonus = params.signingBonus,
		winBonus = params.winBonus,
		podiumBonus = params.podiumBonus,
		championshipBonus = params.salary,
		years = params.years,
		performanceClausePosition = params.performanceClausePosition,
		active = true,
	}

	local finance = findWhere(bundle.finances, function(f)
		return f.teamId == params.teamId
	end)
	local txn = Finance.makeTxn({ careerId = bundle.career.id, teamId = params.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex }, "driver-salary", -params.signingBonus, "Signing bonus: " .. driver.name)

	local newDrivers = map(bundle.drivers, function(d)
		if d.id == params.driverId then
			return merged(d, { teamId = params.teamId, morale = clamp(d.morale + 6, 0, 100) })
		end
		return d
	end)
	local newContracts = {}
	for _, c in ipairs(bundle.driverContracts) do
		newContracts[#newContracts + 1] = c
	end
	newContracts[#newContracts + 1] = contract
	local newFinances = map(bundle.finances, function(f)
		if f.teamId == params.teamId then
			return merged(f, { balance = f.balance - params.signingBonus })
		end
		return f
	end)
	local newTransactions = {}
	for _, t in ipairs(bundle.transactions) do
		newTransactions[#newTransactions + 1] = t
	end
	newTransactions[#newTransactions + 1] = txn
	local newNews = {}
	for _, n in ipairs(bundle.news) do
		newNews[#newNews + 1] = n
	end
	newNews[#newNews + 1] = Season.makeNews(bundle, "contract", "Driver signed", driver.name .. " joins the team.", bundle.weekend.raceIndex, bundle.season.number)

	return merged(bundle, { drivers = newDrivers, driverContracts = newContracts, finances = newFinances, transactions = newTransactions, news = newNews })
end

function Season.releaseDriver(bundle, driverId)
	local driver = findWhere(bundle.drivers, function(d)
		return d.id == driverId
	end)
	if not driver or not driver.teamId then
		return bundle
	end
	local contract = findWhere(bundle.driverContracts, function(c)
		return c.driverId == driverId and c.active
	end)
	local termination = contract and round(contract.salary * 0.4 * contract.years) or 0
	local txn = contract and Finance.makeTxn({ careerId = bundle.career.id, teamId = contract.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex }, "termination", -termination, "Contract termination: " .. driver.name) or nil

	local newDrivers = map(bundle.drivers, function(d)
		if d.id == driverId then
			return detach(d, -8)
		end
		return d
	end)
	local newContracts = map(bundle.driverContracts, function(c)
		if c.driverId == driverId then
			return merged(c, { active = false })
		end
		return c
	end)
	local newFinances = bundle.finances
	if contract then
		newFinances = map(bundle.finances, function(f)
			if f.teamId == contract.teamId then
				return merged(f, { balance = f.balance - termination })
			end
			return f
		end)
	end
	local newTransactions = bundle.transactions
	if txn then
		newTransactions = {}
		for _, t in ipairs(bundle.transactions) do
			newTransactions[#newTransactions + 1] = t
		end
		newTransactions[#newTransactions + 1] = txn
	end
	return merged(bundle, { drivers = newDrivers, driverContracts = newContracts, finances = newFinances, transactions = newTransactions })
end

-- -- mid-season transfer market -------------------------------------------------

local function driverRating(d)
	return d.attributes.pace * 0.5 + d.attributes.qualifying * 0.2 + d.attributes.racecraft * 0.3
end

local function fmtMoney(n)
	if math.abs(n) >= 1000000 then
		local dp = (n % 1000000 == 0) and 0 or 1
		return "$" .. string.format("%." .. dp .. "f", n / 1000000) .. "m"
	end
	if math.abs(n) >= 1000 then
		return "$" .. round(n / 1000) .. "k"
	end
	return "$" .. round(n)
end

function Season.transferFeeFor(driver)
	local rating = driverRating(driver)
	local base = math.max(2000000, driver.salaryDemand * 1.6)
	return round((base * (0.6 + (rating - 60) / 60)) / 100000) * 100000
end

local function contractFor(bundle, driverId, teamId, salary, years)
	return {
		id = "dc-" .. driverId .. "-" .. teamId .. "-" .. bundle.season.number .. "-" .. DateTime.now().UnixTimestampMillis .. "-" .. tostring(math.random(100000, 999999)),
		careerId = bundle.career.id,
		driverId = driverId,
		teamId = teamId,
		season = bundle.season.number,
		salary = salary,
		signingBonus = 0,
		winBonus = 0,
		podiumBonus = 0,
		championshipBonus = 0,
		years = years,
		performanceClausePosition = nil,
		active = true,
	}
end

function Season.runAiTransferWindow(bundle)
	local season = bundle.season
	local rng = Rng.new("transfers:" .. bundle.career.id .. ":" .. season.number .. ":" .. season.currentRaceIndex .. ":" .. #bundle.drivers)
	local news = {}
	local financials = map(bundle.finances, function(f)
		return shallow(f)
	end)
	local transactions = {}
	for _, t in ipairs(bundle.transactions) do
		transactions[#transactions + 1] = t
	end
	local drivers = {}
	for _, d in ipairs(bundle.drivers) do
		drivers[#drivers + 1] = d
	end
	local driverContracts = {}
	for _, c in ipairs(bundle.driverContracts) do
		driverContracts[#driverContracts + 1] = c
	end
	local transferOffers = {}
	for _, o in ipairs(bundle.transferOffers or {}) do
		transferOffers[#transferOffers + 1] = o
	end

	local aiTeams = filter(bundle.teams, function(t)
		return not t.isPlayerTeam
	end)
	local playerTeams = filter(bundle.teams, function(t)
		return t.isPlayerTeam
	end)
	local function seatCount(teamId)
		return #filter(drivers, function(d)
			return d.teamId == teamId
		end)
	end

	for _, team in ipairs(aiTeams) do
		local mine = filter(drivers, function(d)
			return d.teamId == team.id
		end)
		if #mine < 2 or not rng:chance(0.12) then
			-- nothing
		else
			local weakest = stableSort(mine, function(a, b)
				return driverRating(a) < driverRating(b)
			end)[1]
			local frees = filter(drivers, function(d)
				return d.teamId == nil
			end)
			local bestFree = stableSort(frees, function(a, b)
				return driverRating(a) > driverRating(b)
			end)[1]
			if bestFree and driverRating(bestFree) - driverRating(weakest) >= 3 then
				drivers = map(drivers, function(d)
					if d.id == weakest.id then
						return detach(d, -6)
					end
					return d
				end)
				driverContracts = map(driverContracts, function(c)
					if c.driverId == weakest.id and c.active then
						return merged(c, { active = false })
					end
					return c
				end)
				news[#news + 1] = Season.makeNews(bundle, "contract", weakest.name .. " released", team.name .. " have parted ways with " .. weakest.name .. " ahead of the next round.", season.currentRaceIndex, season.number)
			end
		end
	end

	for _, team in ipairs(aiTeams) do
		if rng:chance(0.08) then
			local finRec = findWhere(financials, function(f)
				return f.teamId == team.id
			end)
			local balance = finRec and finRec.balance or 0
			local weakest = stableSort(filter(drivers, function(d)
				return d.teamId == team.id
			end), function(a, b)
				return driverRating(a) < driverRating(b)
			end)[1]
			if weakest then
				local rivals = filter(drivers, function(d)
					if not d.teamId then
						return false
					end
					if findWhere(playerTeams, function(pt)
						return pt.id == d.teamId
					end) then
						return false
					end
					return d.teamId ~= team.id
				end)
				rivals = filter(rivals, function(d)
					return driverRating(d) - driverRating(weakest) >= 6
				end)
				rivals = stableSort(rivals, function(a, b)
					return driverRating(a) > driverRating(b)
				end)
				local rival = rivals[1]
				if rival then
					local fee = Season.transferFeeFor(rival)
					if fee <= math.max(6000000, balance * 0.4) then
						local sellerId = rival.teamId
						drivers = map(drivers, function(d)
							if d.id == weakest.id then
								return detach(d, -6)
							end
							return d
						end)
						driverContracts = map(driverContracts, function(c)
							if c.driverId == weakest.id and c.active then
								return merged(c, { active = false })
							end
							return c
						end)
						local salary = round(DriverMarket.expectedSalary(rival, team.reputation) * rng:range(1.05, 1.3))
						drivers = map(drivers, function(d)
							if d.id == rival.id then
								return merged(d, { teamId = team.id })
							end
							return d
						end)
						driverContracts = map(driverContracts, function(c)
							if c.driverId == rival.id and c.active then
								return merged(c, { active = false })
							end
							return c
						end)
						driverContracts[#driverContracts + 1] = contractFor(bundle, rival.id, team.id, salary, rng:int(2, 3))
						for _, f in ipairs(financials) do
							if f.teamId == team.id then
								f.balance -= fee
							end
							if f.teamId == sellerId then
								f.balance += fee
							end
						end
						transactions[#transactions + 1] = Finance.makeTxn({ careerId = bundle.career.id, season = season.number, raceIndex = season.currentRaceIndex, teamId = team.id }, "transfer", -fee, "Transfer fee: " .. rival.name)
						transactions[#transactions + 1] = Finance.makeTxn({ careerId = bundle.career.id, season = season.number, raceIndex = season.currentRaceIndex, teamId = sellerId }, "transfer", fee, "Transfer received: " .. rival.name)
						news[#news + 1] = Season.makeNews(bundle, "contract", rival.name .. " joins " .. team.shortName, team.name .. " have poached " .. rival.name .. " for " .. fmtMoney(fee) .. ".", season.currentRaceIndex, season.number)
					end
				end
			end
		end
	end

	for _, team in ipairs(aiTeams) do
		local budgetCap = DriverMarket.aiWillingToPay(team, team.aiProfile)
		local guard = 0
		while seatCount(team.id) < 2 and guard < 3 do
			guard += 1
			local pool = stableSort(filter(drivers, function(d)
				return d.teamId == nil
			end), function(a, b)
				return driverRating(a) > driverRating(b)
			end)
			if #pool == 0 then
				break
			end
			local affordable = filter(pool, function(d)
				return DriverMarket.expectedSalary(d, team.reputation) <= budgetCap
			end)
			local choice = affordable[1] or pool[1]
			local salary = round(DriverMarket.expectedSalary(choice, team.reputation) * rng:range(1, 1.25))
			drivers = map(drivers, function(d)
				if d.id == choice.id then
					return merged(d, { teamId = team.id })
				end
				return d
			end)
			driverContracts[#driverContracts + 1] = contractFor(bundle, choice.id, team.id, salary, rng:int(1, 3))
			news[#news + 1] = Season.makeNews(bundle, "contract", team.shortName .. " sign " .. choice.name, team.name .. " have signed " .. choice.name .. " on a " .. fmtMoney(salary) .. "-per-season deal.", season.currentRaceIndex, season.number)
		end
	end

	for _, team in ipairs(aiTeams) do
		if rng:chance(0.1) then
			local finRec = findWhere(financials, function(f)
				return f.teamId == team.id
			end)
			local balance = finRec and finRec.balance or 0
			local targets = filter(drivers, function(d)
				if not d.teamId then
					return false
				end
				return findWhere(playerTeams, function(pt)
					return pt.id == d.teamId
				end) ~= nil
			end)
			targets = filter(targets, function(d)
				return findWhere(transferOffers, function(o)
					return o.driverId == d.id and o.status == "open"
				end) == nil
			end)
			targets = stableSort(targets, function(a, b)
				return driverRating(a) > driverRating(b)
			end)
			if #targets > 0 then
				local target = targets[1]
				local fee = Season.transferFeeFor(target)
				if fee <= math.max(4000000, balance * 0.5) then
					local salary = round(DriverMarket.expectedSalary(target, team.reputation) * rng:range(1.05, 1.35))
					transferOffers[#transferOffers + 1] = {
						id = "to-" .. target.id .. "-" .. team.id .. "-s" .. season.number .. "-r" .. season.currentRaceIndex .. "-" .. #transferOffers,
						careerId = bundle.career.id,
						season = season.number,
						raceIndex = season.currentRaceIndex,
						driverId = target.id,
						fromTeamId = team.id,
						fee = fee,
						salary = salary,
						years = rng:int(2, 3),
						status = "open",
						createdAt = DateTime.now().UnixTimestampMillis,
					}
					news[#news + 1] = Season.makeNews(bundle, "contract", team.shortName .. " bid for " .. target.name, team.name .. " have approached " .. target.name .. " with a " .. fmtMoney(fee) .. " offer. A decision is required.", season.currentRaceIndex, season.number)
				end
			end
		end
	end

	local allNews = {}
	for _, n in ipairs(bundle.news) do
		allNews[#allNews + 1] = n
	end
	for _, n in ipairs(news) do
		allNews[#allNews + 1] = n
	end

	return merged(bundle, {
		drivers = drivers,
		driverContracts = driverContracts,
		transferOffers = transferOffers,
		finances = financials,
		transactions = transactions,
		news = allNews,
	})
end

function Season.respondTransferOffer(bundle, offerId, accept)
	local offers = bundle.transferOffers or {}
	local offer = findWhere(offers, function(o)
		return o.id == offerId and o.status == "open"
	end)
	if not offer then
		return bundle
	end
	local season = bundle.season

	if not accept then
		local drvName = findWhere(bundle.drivers, function(d)
			return d.id == offer.driverId
		end)
		local fromName = findWhere(bundle.teams, function(t)
			return t.id == offer.fromTeamId
		end)
		local newOffers = map(offers, function(o)
			if o.id == offerId then
				return merged(o, { status = "rejected" })
			end
			return o
		end)
		local newNews = {}
		for _, n in ipairs(bundle.news) do
			newNews[#newNews + 1] = n
		end
		newNews[#newNews + 1] = Season.makeNews(bundle, "contract", (drvName and drvName.name or "Driver") .. " stays", "You turned down " .. (fromName and fromName.name or "the approach") .. ". The driver remains under contract.", season.currentRaceIndex, season.number)
		return merged(bundle, { transferOffers = newOffers, news = newNews })
	end

	local driver = findWhere(bundle.drivers, function(d)
		return d.id == offer.driverId
	end)
	local toTeam = findWhere(bundle.teams, function(t)
		return t.id == offer.fromTeamId
	end)
	local fromTeamId = driver and driver.teamId or nil
	if not driver or not toTeam or not fromTeamId then
		return bundle
	end

	local drivers = {}
	for _, d in ipairs(bundle.drivers) do
		drivers[#drivers + 1] = d
	end
	local driverContracts = map(bundle.driverContracts, function(c)
		if c.active then
			return shallow(c)
		end
		return c
	end)

	local releasedName = nil
	local buyer = filter(drivers, function(d)
		return d.teamId == toTeam.id
	end)
	if #buyer >= 2 then
		local weakest = stableSort(buyer, function(a, b)
			return driverRating(a) < driverRating(b)
		end)[1]
		releasedName = weakest.name
		drivers = map(drivers, function(d)
			if d.id == weakest.id then
				return detach(d, -6)
			end
			return d
		end)
		driverContracts = map(driverContracts, function(c)
			if c.driverId == weakest.id and c.active then
				return merged(c, { active = false })
			end
			return c
		end)
	end

	drivers = map(drivers, function(d)
		if d.id == driver.id then
			return merged(d, { teamId = toTeam.id })
		end
		return d
	end)
	driverContracts = map(driverContracts, function(c)
		if c.driverId == driver.id and c.active then
			return merged(c, { active = false })
		end
		return c
	end)
	driverContracts[#driverContracts + 1] = contractFor(bundle, driver.id, toTeam.id, offer.salary, offer.years)

	local finances = map(bundle.finances, function(f)
		if f.teamId == toTeam.id then
			return merged(f, { balance = f.balance - offer.fee })
		end
		if f.teamId == fromTeamId then
			return merged(f, { balance = f.balance + offer.fee })
		end
		return f
	end)
	local ctx = { careerId = bundle.career.id, season = season.number, raceIndex = season.currentRaceIndex }
	local transactions = {}
	for _, t in ipairs(bundle.transactions) do
		transactions[#transactions + 1] = t
	end
	transactions[#transactions + 1] = Finance.makeTxn(merged(ctx, { teamId = toTeam.id }), "transfer", -offer.fee, "Transfer fee: " .. driver.name)
	transactions[#transactions + 1] = Finance.makeTxn(merged(ctx, { teamId = fromTeamId }), "transfer", offer.fee, "Transfer received: " .. driver.name)

	local news = {}
	for _, n in ipairs(bundle.news) do
		news[#news + 1] = n
	end
	news[#news + 1] = Season.makeNews(bundle, "contract", driver.name .. " joins " .. toTeam.shortName, toTeam.name .. " have completed the " .. fmtMoney(offer.fee) .. " signing of " .. driver.name .. "." .. (releasedName and (" " .. releasedName .. " leaves to make room.") or ""), season.currentRaceIndex, season.number)

	local newOffers = map(offers, function(o)
		if o.id == offerId then
			return merged(o, { status = "accepted" })
		end
		return o
	end)
	return merged(bundle, { drivers = drivers, driverContracts = driverContracts, finances = finances, transactions = transactions, transferOffers = newOffers, news = news })
end

-- -- practice / qualifying / race weekend ---------------------------------------

local function buildRaceEntrants(bundle)
	local ruleset = RulesetsData.get(bundle.season.rulesetId)
	local circuit = CircuitsData.get(bundle.weekend.circuitId)
	local totalLaps = math.max(5, round(circuit.laps * (bundle.settings.raceDistancePct / 100)))
	local entrants = {}
	for _, team in ipairs(bundle.teams) do
		local car = findWhere(bundle.cars, function(c)
			return c.teamId == team.id
		end)
		if car then
			local teamDrivers = filter(bundle.drivers, function(d)
				return d.teamId == team.id
			end)
			teamDrivers = slice(teamDrivers, 0, 2)
			for _, driver in ipairs(teamDrivers) do
				local planned = Strategy.defaultStrategy(totalLaps, circuit, ruleset)
				local plan = Strategy.makeStrategyPlan(driver.id, planned)
				local setupState = bundle.setups[team.id]
				local decision
				if team.isPlayerTeam then
					decision = 0.95
				else
					local iq = team.aiProfile and team.aiProfile.strategyIQ or 0.6
					decision = clamp(iq, 0.2, 0.98)
				end
				entrants[#entrants + 1] = {
					driverId = driver.id,
					teamId = team.id,
					car = car,
					driver = driver,
					gridPosition = 0,
					strategy = plan,
					setup = (setupState and setupState.setup) or { downforce = 3, balance = 0 },
					decisionSkill = decision,
				}
			end
		end
	end
	return entrants
end

Season.buildRaceEntrants = buildRaceEntrants

local PRACTICE_PROGRAMS = { "setup", "long-run", "quali-sim", "tire-test", "reliability" }

function Season.runPracticeSession(bundle, session)
	local circuit = CircuitsData.get(bundle.weekend.circuitId)
	local rng = Rng.new("practice:" .. bundle.career.id .. ":" .. bundle.season.number .. ":" .. bundle.weekend.raceIndex .. ":" .. session)
	local entrants = {}
	for _, team in ipairs(bundle.teams) do
		local car = findWhere(bundle.cars, function(c)
			return c.teamId == team.id
		end)
		local teamDrivers = slice(filter(bundle.drivers, function(d)
			return d.teamId == team.id
		end), 0, 2)
		for i, driver in ipairs(teamDrivers) do
			entrants[#entrants + 1] = {
				driverId = driver.id,
				teamId = team.id,
				car = car,
				driver = driver,
				program = PRACTICE_PROGRAMS[((session + (i - 1)) % #PRACTICE_PROGRAMS) + 1],
			}
		end
	end

	local firstTeamSetup
	if bundle.teams[1] then
		local st = bundle.setups[bundle.teams[1].id]
		firstTeamSetup = st and st.setup or nil
	end
	local currentSetup = firstTeamSetup or { downforce = 3, balance = 0 }
	local result = Practice.simulatePractice(rng, { session = session, circuit = circuit, weather = bundle.weekend.weather, entrants = entrants, currentSetup = currentSetup })

	local setups = shallow(bundle.setups)
	for _, team in ipairs(bundle.teams) do
		local drivers = filter(bundle.drivers, function(d)
			return d.teamId == team.id
		end)
		local relevant = filter(result.entries, function(e)
			return findWhere(drivers, function(d)
				return d.id == e.driverId
			end) ~= nil
		end)
		local doSetup = #relevant > 0
		if doSetup then
			local prev = setups[team.id] or { setup = { downforce = 3, balance = 0 }, practiceTicks = 0 }
			local suggested = result.suggestedSetup
			local blend = clamp(0.4 + session * 0.15, 0, 1)
			setups[team.id] = { setup = Car.convergeSetup(prev.setup, suggested, blend), practiceTicks = prev.practiceTicks + 1 }
		end
	end

	local newPractice = {}
	for _, p in ipairs(bundle.practice) do
		newPractice[#newPractice + 1] = p
	end
	newPractice[#newPractice + 1] = result

	return {
		bundle = merged(bundle, { practice = newPractice, setups = setups, weekend = merged(bundle.weekend, { session = "practice-" .. session }) }),
		result = result,
	}
end

function Season.prepareRace(bundle)
	local careerId = bundle.career.id
	local season = bundle.season
	local raceIndex = bundle.weekend.raceIndex
	local circuit = CircuitsData.get(bundle.weekend.circuitId)
	local ruleset = RulesetsData.get(season.rulesetId)
	local raceId = careerId .. ":s" .. season.number .. ":r" .. raceIndex
	local seed = hashSeed(raceId)

	local qualRng = Rng.new(raceId .. ":quali")
	local qualiEntrants = map(buildRaceEntrants(bundle), function(e)
		return { driverId = e.driverId, teamId = e.teamId, car = e.car, driver = e.driver }
	end)
	local qualifying = Qualifying.simulateQualifying(qualRng, {
		circuit = circuit,
		entries = qualiEntrants,
		weather = bundle.weekend.weather,
		ruleset = ruleset,
		setupFor = function(teamId)
			local st = bundle.setups[teamId]
			return st and st.setup or { downforce = 3, balance = 0 }
		end,
	})

	local gridDriverIds = map(qualifying, function(q)
		return q.driverId
	end)
	local penalised = {}
	for _, id in ipairs(gridDriverIds) do
		penalised[#penalised + 1] = id
	end
	for driverId, places in pairs(bundle.gridPenalties) do
		local idx = indexOf(penalised, driverId)
		if idx >= 0 then
			local target = math.min(#penalised, idx + places)
			table.remove(penalised, idx)
			table.insert(penalised, target, driverId)
		end
	end

	local totalLaps = math.max(5, round(circuit.laps * (bundle.settings.raceDistancePct / 100)))
	local entrants = map(buildRaceEntrants(bundle), function(e)
		local idx = indexOf(penalised, e.driverId)
		return merged(e, { gridPosition = idx >= 0 and (idx) or e.gridPosition })
	end)

	return {
		raceId = raceId,
		seed = seed,
		circuit = circuit,
		totalLaps = totalLaps,
		ruleset = ruleset,
		weatherStart = bundle.weekend.weather,
		entrants = entrants,
		qualifying = qualifying,
		poleDriverId = qualifying[1] and qualifying[1].driverId or nil,
	}
end

function Season.commitRaceResult(bundle, result)
	if bundle.weekend.resultId then
		local existing = findWhere(bundle.results, function(r)
			return r.id == bundle.weekend.resultId
		end)
		if existing then
			return { bundle = bundle, result = existing, alreadyProcessed = existing.processed }
		end
	end
	local newResults = {}
	for _, r in ipairs(bundle.results) do
		newResults[#newResults + 1] = r
	end
	newResults[#newResults + 1] = result
	local next_ = merged(bundle, {
		results = newResults,
		gridPenalties = {},
		weekend = merged(bundle.weekend, { resultId = result.id, session = "race" }),
	})
	local processed = Season.processRaceResult(next_, result.id)
	next_ = processed.bundle
	return { bundle = next_, result = result, alreadyProcessed = false }
end

function Season.runRaceWeekend(bundle)
	if bundle.weekend.resultId then
		local existing = findWhere(bundle.results, function(r)
			return r.id == bundle.weekend.resultId
		end)
		if existing then
			return { bundle = bundle, result = existing, alreadyProcessed = existing.processed }
		end
	end

	local prep = Season.prepareRace(bundle)

	local out = Race.simulateRace({
		raceId = prep.raceId,
		seed = prep.seed,
		circuit = prep.circuit,
		totalLaps = prep.totalLaps,
		ruleset = prep.ruleset,
		weatherStart = prep.weatherStart,
		entrants = prep.entrants,
		severitySetting = bundle.settings.incidentSeverity,
	})

	local result = merged(out.result, {
		careerId = bundle.career.id,
		season = bundle.season.number,
		raceIndex = bundle.weekend.raceIndex,
		qualifying = prep.qualifying,
		poleDriverId = prep.poleDriverId,
		finalDamage = out.damageByDriver,
	})

	return Season.commitRaceResult(bundle, result)
end

function Season.processRaceResult(bundle, resultId)
	local idx = -1
	for i, r in ipairs(bundle.results) do
		if r.id == resultId then
			idx = i
			break
		end
	end
	if idx < 0 then
		error("Result not found")
	end
	local result = bundle.results[idx]
	if result.processed then
		return { bundle = bundle, applied = false }
	end

	local careerId = bundle.career.id
	local ruleset = RulesetsData.get(bundle.season.rulesetId)
	local circuit = CircuitsData.get(result.circuitId)
	local racesInSeason = #bundle.season.calendar
	if racesInSeason == 0 then
		racesInSeason = 1
	end
	local rng = Rng.new("process:" .. resultId)

	local transactions = {}
	for _, t in ipairs(bundle.transactions) do
		transactions[#transactions + 1] = t
	end
	local finances = map(bundle.finances, function(f)
		return shallow(f)
	end)
	local news = {}
	for _, n in ipairs(bundle.news) do
		news[#news + 1] = n
	end
	local upgrades = map(bundle.upgrades, function(u)
		return shallow(u)
	end)

	for i = 1, #upgrades do
		local u = upgrades[i]
		if not u.completed and u.season == bundle.season.number then
			upgrades[i] = Development.tickProject(u)
		end
	end

	for _, team in ipairs(bundle.teams) do
		local teamEntries = filter(result.classification, function(c)
			return c.teamId == team.id
		end)
		local teamStaff = filter(bundle.staff, function(s)
			return s.teamId == team.id
		end)
		local facilities = filter(bundle.facilities, function(f)
			return f.teamId == team.id
		end)
		local contracts = filter(bundle.driverContracts, function(c)
			return c.teamId == team.id and c.active
		end)
		local sponsorContracts = filter(bundle.sponsorContracts, function(s)
			return s.teamId == team.id and s.active
		end)

		local racePrizes = map(teamEntries, function(e)
			return { driverId = e.driverId, position = e.position, points = e.points }
		end)

		local repairTotal = 0
		for _, e in ipairs(teamEntries) do
			local dmg = result.finalDamage and result.finalDamage[e.driverId] or nil
			if dmg and next(dmg) ~= nil then
				repairTotal += Damage.repairCost({
					frontWing = dmg.frontWing or 0,
					rearWing = dmg.rearWing or 0,
					floor = dmg.floor or 0,
					sidepod = dmg.sidepod or 0,
					suspension = dmg.suspension or 0,
					steering = dmg.steering or 0,
					brakes = dmg.brakes or 0,
					chassis = dmg.chassis or 0,
					cooling = dmg.cooling or 0,
					gearbox = dmg.gearbox or 0,
					engine = dmg.engine or 0,
					tire = dmg.tire or 0,
				}, Development.facilityLevel(facilities, "factory"))
			end
		end

		local ctx = { careerId = careerId, teamId = team.id, season = bundle.season.number, raceIndex = result.raceIndex }
		local txns = {}
		for _, p in ipairs(racePrizes) do
			txns[#txns + 1] = Finance.makeTxn(ctx, "prize-money", round(200000 + p.points * 60000 + (11 - p.position) * 40000), "Race prize money (P" .. p.position .. ")")
		end
		for _, sc in ipairs(sponsorContracts) do
			local sponsor = findWhere(bundle.sponsors, function(s)
				return s.id == sc.sponsorId
			end)
			txns[#txns + 1] = Finance.makeTxn(ctx, "sponsor-per-race", sponsor.perRace, sponsor.name .. " race payment")
		end
		local salaryTotal = 0
		for _, c in ipairs(contracts) do
			salaryTotal += round(c.salary / racesInSeason)
		end
		local staffTotal = 0
		for _, st in ipairs(teamStaff) do
			staffTotal += round(st.wage / racesInSeason)
		end
		local upkeepTotal = 0
		for _, f in ipairs(facilities) do
			upkeepTotal += round((2000000 * (1 + f.level * 0.5)) / racesInSeason)
		end
		txns[#txns + 1] = Finance.makeTxn(ctx, "driver-salary", -salaryTotal, "Driver salaries")
		txns[#txns + 1] = Finance.makeTxn(ctx, "staff-wage", -staffTotal, "Staff wages")
		txns[#txns + 1] = Finance.makeTxn(ctx, "facility-upkeep", -upkeepTotal, "Facility upkeep")
		txns[#txns + 1] = Finance.makeTxn(ctx, "travel", -900000, "Travel & logistics")
		if repairTotal > 0 then
			txns[#txns + 1] = Finance.makeTxn(ctx, "repairs", -repairTotal, "Crash repairs")
		end

		local delta = 0
		for _, t in ipairs(txns) do
			delta += t.amount
		end
		local fin = findWhere(finances, function(f)
			return f.teamId == team.id
		end)
		fin.balance = round(fin.balance + delta)
		for _, t in ipairs(txns) do
			transactions[#transactions + 1] = t
		end

		if fin.balance < 0 then
			news[#news + 1] = Season.makeNews(bundle, "finance", "Financial warning", team.name .. " is in the red ($" .. round(fin.balance / 1e6) .. "M). Emergency funding may be required.", result.raceIndex, bundle.season.number)
		end

		local avgFinish = 0
		for _, e in ipairs(teamEntries) do
			avgFinish += e.position
		end
		avgFinish = avgFinish / math.max(1, #teamEntries)
		local repDelta = clamp((10 - avgFinish) * 0.4, -2.5, 2.5)
		local teamRef = findWhere(bundle.teams, function(t)
			return t.id == team.id
		end)
		teamRef.reputation = clamp(round(teamRef.reputation + repDelta, 1), 20, 99)

		if not team.isPlayerTeam then
			local carRef = findWhere(bundle.cars, function(c)
				return c.teamId == team.id
			end)
			for _, u in ipairs(upgrades) do
				if u.teamId == team.id and u.completed and not u.installed then
					local updated = Development.installUpgrade(carRef, u)
					for k, v in pairs(updated) do
						carRef[k] = v
					end
					u.installed = true
				end
			end
		end
	end

	local drivers = map(bundle.drivers, function(d)
		local entry = findWhere(result.classification, function(c)
			return c.driverId == d.id
		end)
		if not entry then
			return d
		end
		return merged(d, {
			starts = d.starts + 1,
			careerPoints = d.careerPoints + entry.points,
			careerWins = d.careerWins + ((entry.position == 1 and entry.status == "finished") and 1 or 0),
			careerPodiums = d.careerPodiums + ((entry.position <= 3 and entry.status == "finished") and 1 or 0),
			careerPoles = d.careerPoles + (result.poleDriverId == d.id and 1 or 0),
			morale = clamp(d.morale + (entry.status == "finished" and clamp((11 - entry.position) * 1.5, -6, 8) or -6), 20, 100),
		})
	end)

	local processedResults = map(bundle.results, function(r)
		if r.id == resultId then
			return merged(result, { processed = true })
		end
		return r
	end)
	local standings = Standings.computeStandings(processedResults, bundle.season.number)

	local winner = result.classification[1]
	local winnerDriver = winner and findWhere(bundle.drivers, function(d)
		return d.id == winner.driverId
	end) or nil
	if winnerDriver then
		news[#news + 1] = Season.makeNews(bundle, "race", winnerDriver.name .. " wins in " .. circuit.location, "Round " .. (result.raceIndex + 1) .. ": " .. winnerDriver.name .. " takes the win.", result.raceIndex, bundle.season.number)
	end
	local severe = {}
	for _, inc in ipairs(result.incidents) do
		if inc.severity >= 3 then
			severe[#severe + 1] = inc
		end
	end
	severe = slice(severe, 0, 3)
	for _, inc in ipairs(severe) do
		news[#news + 1] = Season.makeNews(bundle, "incident", "Incident report", inc.narrative, result.raceIndex, bundle.season.number)
	end

	local updatedResults = map(bundle.results, function(r)
		if r.id == resultId then
			return merged(result, { processed = true })
		end
		return r
	end)

	return {
		bundle = merged(bundle, {
			results = updatedResults,
			standings = standings,
			drivers = drivers,
			finances = finances,
			transactions = transactions,
			news = news,
			upgrades = upgrades,
		}),
		applied = true,
	}
end

function Season.advanceCalendar(bundle)
	local season = bundle.season
	local nextIndex = season.currentRaceIndex + 1
	if nextIndex >= #season.calendar then
		return Season.endSeason(bundle)
	end
	local nextCircuit = season.calendar[nextIndex + 1]
	local rng = Rng.new("weekend:" .. bundle.career.id .. ":" .. season.number .. ":" .. nextIndex)
	local updatedSeason = merged(season, { currentRaceIndex = nextIndex })
	local newSeasons = map(bundle.seasons, function(s)
		if s.number == season.number then
			return updatedSeason
		end
		return s
	end)
	return Season.runAiTransferWindow(merged(bundle, {
		season = updatedSeason,
		seasons = newSeasons,
		weekend = {
			season = season.number,
			raceIndex = nextIndex,
			circuitId = nextCircuit,
			session = "preparation",
			weather = Weather.initialWeather(rng, CircuitsData.get(nextCircuit)),
			readyUserIds = {},
			resultId = nil,
			startedAt = nil,
		},
	}))
end

-- -- season end / start ---------------------------------------------------------

function Season.endSeason(bundle)
	local season = bundle.season
	local standings = Standings.computeStandings(bundle.results, season.number)
	local championDriverId = standings.drivers[1] and standings.drivers[1].driverId or nil
	local championTeamId = standings.constructors[1] and standings.constructors[1].teamId or nil

	local finances = map(bundle.finances, function(f)
		return shallow(f)
	end)
	local transactions = {}
	for _, t in ipairs(bundle.transactions) do
		transactions[#transactions + 1] = t
	end
	for _, fin in ipairs(finances) do
		local conRec = findWhere(standings.constructors, function(c)
			return c.teamId == fin.teamId
		end)
		local pos = conRec and conRec.position or 10
		local prize = Finance.constructorsPrize(pos)
		fin.balance += prize
		transactions[#transactions + 1] = Finance.makeTxn({ careerId = bundle.career.id, teamId = fin.teamId, season = season.number, raceIndex = 99 }, "prize-money", prize, "Constructors' championship prize (P" .. pos .. ")")
	end

	for _, sc in ipairs(filter(bundle.sponsorContracts, function(s)
		return s.active
	end)) do
		local sponsor = findWhere(bundle.sponsors, function(s)
			return s.id == sc.sponsorId
		end)
		if sponsor then
			local conRec = findWhere(standings.constructors, function(c)
				return c.teamId == sc.teamId
			end)
			local pos = conRec and conRec.position or 10
			if pos <= sponsor.targetPosition then
				local fin = findWhere(finances, function(f)
					return f.teamId == sc.teamId
				end)
				fin.balance += sponsor.positionBonus
				transactions[#transactions + 1] = Finance.makeTxn({ careerId = bundle.career.id, teamId = sc.teamId, season = season.number, raceIndex = 99 }, "sponsor-bonus", sponsor.positionBonus, sponsor.name .. " position bonus (P" .. pos .. ")")
			end
		end
	end

	local completedSeason = merged(season, { completed = true, championDriverId = championDriverId, championTeamId = championTeamId })
	local newsUpdate = {}
	for _, n in ipairs(bundle.news) do
		newsUpdate[#newsUpdate + 1] = n
	end
	local champName = "The champion"
	if standings.drivers[1] then
		local cd = findWhere(bundle.drivers, function(d)
			return d.id == championDriverId
		end)
		if cd then
			champName = cd.name
		end
	end
	newsUpdate[#newsUpdate + 1] = Season.makeNews(bundle, "championship", "Season complete", champName .. " wins the " .. season.number .. " Drivers' Championship.", 99, season.number)

	local newSeasons = map(bundle.seasons, function(s)
		if s.number == season.number then
			return completedSeason
		end
		return s
	end)
	return merged(bundle, {
		season = completedSeason,
		seasons = newSeasons,
		standings = standings,
		finances = finances,
		transactions = transactions,
		news = newsUpdate,
		career = merged(bundle.career, { phase = "off-season" }),
	})
end

function Season.startNextSeason(bundle, sameRuleset)
	if sameRuleset == nil then
		sameRuleset = true
	end
	local rng = Rng.new("nextseason:" .. bundle.career.id .. ":" .. (bundle.season.number + 1))
	local newNumber = bundle.season.number + 1
	local cal = Season.generateCalendar(rng, bundle.settings.seasonLength)
	local calendar = cal.calendar
	local sprintRaces = cal.sprintRaces
	local rulesetId
	if sameRuleset then
		rulesetId = bundle.season.rulesetId
	else
		rulesetId = rng:pick({ "classic-25-18", "no-points-fastest-lap" })
	end

	local drivers = map(bundle.drivers, function(d)
		local age = d.age + 1
		local growth
		if d.age < 24 then
			growth = rng:range(1, 4)
		elseif d.age > d.peakAge then
			growth = -rng:range(0.5, 2)
		else
			growth = rng:range(-0.2, 0.8)
		end
		local att = shallow(d.attributes)
		att.pace = round(clamp(att.pace + growth, 40, 99))
		att.qualifying = round(clamp(att.qualifying + growth, 40, 99))
		att.racecraft = round(clamp(att.racecraft + math.max(0, growth), 40, 99))
		att.experience = round(clamp(att.experience + 5, 0, 100))
		local maxAtt = -math.huge
		for _, v in pairs(att) do
			if v > maxAtt then
				maxAtt = v
			end
		end
		return merged(d, { age = age, attributes = att, potential = round(clamp(d.potential - (d.potential - maxAtt) * 0.3, 40, 99)) })
	end)

	local driversAfter = drivers
	local retirements = filter(driversAfter, function(d)
		return d.age >= 38 and rng:chance(0.4)
	end)
	driversAfter = filter(driversAfter, function(d)
		return not includes(retirements, d)
	end)
	local rookies = slice(DriverFactory.buildFictionalDrivers(bundle.career.id .. ":s" .. newNumber), 0, 4)
	local rookiePool = {}
	for i, d in ipairs(rookies) do
		local copy = shallow(d)
		copy.id = "rookie-s" .. newNumber .. "-" .. (i - 1)
		copy.age = 19 + (i - 1)
		rookiePool[#rookiePool + 1] = copy
	end
	for _, d in ipairs(rookiePool) do
		driversAfter[#driversAfter + 1] = d
	end

	local freeAgents = filter(driversAfter, function(d)
		return d.teamId == nil
	end)
	local assigned = {}
	local teamObjectives = {}
	local aiTeams = filter(bundle.teams, function(t)
		return not t.isPlayerTeam
	end)
	for _, t in ipairs(bundle.teams) do
		teamObjectives[t.id] = t.objective
	end
	local signings = DriverMarket.aiDriverMarket(rng, aiTeams, freeAgents, assigned, teamObjectives)

	local driverContracts = bundle.driverContracts
	local newContracts = {}
	for _, s in ipairs(signings) do
		local d = findWhere(driversAfter, function(x)
			return x.id == s.driverId
		end)
		d.teamId = s.teamId
		newContracts[#newContracts + 1] = {
			id = "dc-" .. s.driverId .. "-" .. s.teamId .. "-s" .. newNumber,
			careerId = bundle.career.id,
			driverId = s.driverId,
			teamId = s.teamId,
			season = newNumber,
			salary = s.salary,
			signingBonus = 0,
			winBonus = 0,
			podiumBonus = 0,
			championshipBonus = s.salary,
			years = s.years,
			performanceClausePosition = nil,
			active = true,
		}
	end

	for _, d in ipairs(driversAfter) do
		if d.teamId then
			local team = findWhere(bundle.teams, function(t)
				return t.id == d.teamId
			end)
			if team and team.isPlayerTeam then
				local activeContract = findWhere(bundle.driverContracts, function(c)
					return c.driverId == d.id and c.active
				end)
				newContracts[#newContracts + 1] = {
					id = "dc-" .. d.id .. "-" .. d.teamId .. "-s" .. newNumber,
					careerId = bundle.career.id,
					driverId = d.id,
					teamId = d.teamId,
					season = newNumber,
					salary = activeContract and activeContract.salary or 3000000,
					signingBonus = 0,
					winBonus = 0,
					podiumBonus = 0,
					championshipBonus = 0,
					years = 1,
					performanceClausePosition = nil,
					active = true,
				}
			end
		end
	end

	local season = {
		id = bundle.career.id .. ":s" .. newNumber,
		careerId = bundle.career.id,
		number = newNumber,
		rulesetId = rulesetId,
		calendar = calendar,
		currentRaceIndex = 0,
		completed = false,
		championDriverId = nil,
		championTeamId = nil,
		sprintRaces = sprintRaces,
	}

	local newCircuit = calendar[1]
	local allContracts = {}
	for _, c in ipairs(driverContracts) do
		allContracts[#allContracts + 1] = c
	end
	for _, c in ipairs(newContracts) do
		allContracts[#allContracts + 1] = c
	end
	local newSeasons = {}
	for _, s in ipairs(bundle.seasons) do
		newSeasons[#newSeasons + 1] = s
	end
	newSeasons[#newSeasons + 1] = season
	local keptOffers = filter(bundle.transferOffers or {}, function(o)
		return o.status ~= "open"
	end)
	local newCars = map(bundle.cars, function(c)
		return merged(c, { season = newNumber })
	end)
	local newNews = {}
	for _, n in ipairs(bundle.news) do
		newNews[#newNews + 1] = n
	end
	newNews[#newNews + 1] = Season.makeNews(bundle, "championship", "Season " .. newNumber .. " begins", #rookiePool .. " rookies join the grid; " .. #retirements .. " drivers retired.", 0, newNumber)

	return merged(bundle, {
		career = merged(bundle.career, { currentSeason = newNumber, phase = "in-season", rulesHistory = merged(bundle.career.rulesHistory, { [tostring(newNumber)] = rulesetId }) }),
		season = season,
		seasons = newSeasons,
		drivers = driversAfter,
		driverContracts = allContracts,
		transferOffers = keptOffers,
		weekend = {
			season = newNumber,
			raceIndex = 0,
			circuitId = newCircuit,
			session = "preparation",
			weather = Weather.initialWeather(rng, CircuitsData.get(newCircuit)),
			readyUserIds = {},
			resultId = nil,
			startedAt = nil,
		},
		cars = newCars,
		news = newNews,
	})
end

-- -- helpers --------------------------------------------------------------------

function Season.makeNews(bundle, kind, title, body, raceIndex, season)
	return {
		id = "news-" .. bundle.career.id .. "-" .. DateTime.now().UnixTimestampMillis .. "-" .. math.floor(math.random() * 1e6),
		careerId = bundle.career.id,
		season = season,
		raceIndex = raceIndex,
		kind = kind,
		title = title,
		body = body,
		createdAt = DateTime.now().UnixTimestampMillis,
		read = false,
	}
end

function Season.teamSetup(bundle, teamId)
	local st = bundle.setups[teamId]
	return st and st.setup or { downforce = 3, balance = 0 }
end

function Season.teamDevelopmentModifiers(bundle, teamId)
	local facilities = filter(bundle.facilities, function(f)
		return f.teamId == teamId
	end)
	local staff = filter(bundle.staff, function(s)
		return s.teamId == teamId
	end)
	local topSkill = 0
	for _, role in ipairs(StaffData.CORE_ROLES) do
		local member = findWhere(staff, function(s)
			return s.role == role
		end)
		local skill = member and member.skill or 0
		if skill > topSkill then
			topSkill = skill
		end
	end
	return Development.developmentModifiers(facilities, topSkill)
end

function Season.aiDevelopmentRound(bundle)
	local upgrades = {}
	for _, u in ipairs(bundle.upgrades) do
		upgrades[#upgrades + 1] = u
	end
	local rng = Rng.new("aidev:" .. bundle.career.id .. ":" .. bundle.season.number .. ":" .. bundle.weekend.raceIndex)
	for _, team in ipairs(filter(bundle.teams, function(t)
		return not t.isPlayerTeam
	end)) do
		local active = filter(upgrades, function(u)
			return u.teamId == team.id and not u.completed
		end)
		local mods = Season.teamDevelopmentModifiers(bundle, team.id)
		if #active < mods.maxConcurrent then
			local devEff = team.aiProfile and team.aiProfile.developmentEfficiency or 0.5
			if rng:chance(0.35 + devEff * 0.3) then
				local areas = { "front-wing", "rear-wing", "floor", "sidepods", "suspension", "brakes", "cooling", "engine" }
				local area = rng:pick(areas)
				upgrades[#upgrades + 1] = {
					id = "proj-" .. team.id .. "-" .. area .. "-" .. bundle.season.number .. "-" .. bundle.weekend.raceIndex .. "-" .. rng:int(0, 1e6),
					careerId = bundle.career.id,
					teamId = team.id,
					area = area,
					name = area .. " upgrade",
					quality = round(clamp(rng:gaussian(70, 12), 25, 100)),
					cost = round(1500000 * rng:range(0.9, 1.2)),
					durationTicks = math.max(1, round(2 / mods.speed)),
					ticksRemaining = math.max(1, round(2 / mods.speed)),
					nominalGain = 2.2,
					completed = false,
					installed = false,
					season = bundle.season.number,
					createdAt = DateTime.now().UnixTimestampMillis,
				}
			end
		end
	end
	return merged(bundle, { upgrades = upgrades })
end

return Season
