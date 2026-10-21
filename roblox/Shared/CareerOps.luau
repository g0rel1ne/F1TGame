-- Ported 1:1 from src/backend/localBackend.ts (applyAction + negotiate)
-- Authoritative career orchestration: validates an action and applies it to a
-- CareerBundle using the pure engine modules. Shared so host/client can preview.

local Engine = script.Parent.Engine
local Season = require(Engine.Season)
local Development = require(Engine.Development)
local Finance = require(Engine.Finance)
local Car = require(Engine.Car)
local DriverMarket = require(Engine.DriverMarket)
local RngModule = require(Engine.Rng)
local Rng = RngModule.Rng

local CareerOps = {}

-- Wall clock (ms), matching JS `Date.now()`. Overridable for deterministic tests.
function CareerOps.now()
	return DateTime.now().UnixTimestampMillis
end

local function shallow(t)
	local n = {}
	for k, v in pairs(t) do
		n[k] = v
	end
	return n
end

local function merge(base, over)
	local n = shallow(base)
	if over then
		for k, v in pairs(over) do
			n[k] = v
		end
	end
	return n
end

local function find(arr, pred)
	for _, v in ipairs(arr) do
		if pred(v) then
			return v
		end
	end
	return nil
end

local function filter(arr, pred)
	local o = {}
	for _, v in ipairs(arr) do
		if pred(v) then
			o[#o + 1] = v
		end
	end
	return o
end

local function map(arr, f)
	local o = {}
	for i, v in ipairs(arr) do
		o[i] = f(v)
	end
	return o
end

local function append(arr, item)
	local o = {}
	for i, v in ipairs(arr) do
		o[i] = v
	end
	o[#o + 1] = item
	return o
end

local function contains(arr, pred)
	for _, v in ipairs(arr) do
		if pred(v) then
			return true
		end
	end
	return false
end

local function randomId(prefix)
	local s = {}
	for i = 1, 8 do
		s[i] = string.format("%02x", math.random(0, 255))
	end
	return prefix .. "-" .. table.concat(s)
end

local function assertOwnsTeam(bundle, userId, teamId)
	local team = find(bundle.teams, function(t)
		return t.id == teamId
	end)
	if not team then
		error("Team not found.")
	end
	if not (team.isPlayerTeam and team.ownerUserId == userId) then
		error("You can only manage your own team.")
	end
end

-- ctx: { userId, lobbyId, hostUserId, memberTeamId, isMember }
-- returns bundle, extra, sideEffect
function CareerOps.apply(bundle, ctx, action)
	if action.type == "advance-calendar" or action.type == "start-next-season" or action.type == "run-race" then
		if ctx.hostUserId ~= ctx.userId then
			error("Only the host can advance the career.")
		end
	end
	if not ctx.isMember then
		error("You are not a member of this lobby.")
	end

	local extra = {}
	local sideEffect = nil
	local t = action.type

	if t == "create-team" then
		if ctx.memberTeamId then
			error("You already own a team in this career.")
		end
		if contains(bundle.teams, function(tm)
			return tm.isPlayerTeam and tm.ownerUserId == ctx.userId
		end) then
			error("You already own a team in this career.")
		end
		local params = { budget = bundle.settings.startBudget, userId = ctx.userId }
		for k, v in pairs(action.request) do
			params[k] = v
		end
		local res = Season.addPlayerTeam(bundle, params)
		bundle = res.bundle
		sideEffect = { memberTeamId = res.teamId }
	elseif t == "set-setup" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local setups = shallow(bundle.setups)
		local cur = setups[action.teamId] or { practiceTicks = 0 }
		local nxt = shallow(cur)
		nxt.setup = Car.sanitizeSetup(action.setup)
		setups[action.teamId] = nxt
		bundle = merge(bundle, { setups = setups })
	elseif t == "sign-driver" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		bundle = Season.signDriver(bundle, action)
	elseif t == "release-driver" then
		local contract = find(bundle.driverContracts, function(c)
			return c.driverId == action.driverId and c.active
		end)
		if contract then
			assertOwnsTeam(bundle, ctx.userId, contract.teamId)
		end
		bundle = Season.releaseDriver(bundle, action.driverId)
	elseif t == "respond-transfer-offer" then
		local offer = find(bundle.transferOffers or {}, function(o)
			return o.id == action.offerId and o.status == "open"
		end)
		if not offer then
			error("This transfer offer is no longer available.")
		end
		local contract = find(bundle.driverContracts, function(c)
			return c.driverId == offer.driverId and c.active
		end)
		if not contract then
			error("That driver is no longer under contract.")
		end
		assertOwnsTeam(bundle, ctx.userId, contract.teamId)
		bundle = Season.respondTransferOffer(bundle, action.offerId, action.accept)
	elseif t == "start-project" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		if not Development.UPGRADE_META[action.area] then
			error("Unknown research area.")
		end
		local mods = Season.teamDevelopmentModifiers(bundle, action.teamId)
		local active = filter(bundle.upgrades, function(u)
			return u.teamId == action.teamId and not u.completed
		end)
		if #active >= mods.maxConcurrent then
			error("Research capacity reached — build a bigger wind tunnel or wait for projects to finish.")
		end
		local rng = Rng.new("proj:" .. ctx.lobbyId .. ":" .. action.teamId .. ":" .. action.area .. ":" .. string.format("%d", CareerOps.now()))
		local project = Development.createUpgradeProject(rng, {
			careerId = bundle.career.id,
			teamId = action.teamId,
			area = action.area,
			season = bundle.season.number,
			mods = mods,
		})
		local fin = find(bundle.finances, function(f)
			return f.teamId == action.teamId
		end)
		if fin.balance - project.cost < -20000000 then
			error("Insufficient funds for this research project.")
		end
		local txn = Finance.makeTxn(
			{ careerId = bundle.career.id, teamId = action.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex },
			"research",
			-project.cost,
			"Research: " .. project.name
		)
		bundle = merge(bundle, {
			upgrades = append(bundle.upgrades, project),
			finances = map(bundle.finances, function(f)
				if f.teamId == action.teamId then
					local n = shallow(f)
					n.balance = f.balance - project.cost
					return n
				end
				return f
			end),
			transactions = append(bundle.transactions, txn),
		})
	elseif t == "install-project" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local project = find(bundle.upgrades, function(u)
			return u.id == action.projectId
		end)
		if not project or project.teamId ~= action.teamId then
			error("Project not found.")
		end
		if not project.completed then
			error("This upgrade is still in development.")
		end
		if project.installed then
			error("This upgrade has already been installed.")
		end
		local carIndex = nil
		for i, c in ipairs(bundle.cars) do
			if c.teamId == action.teamId then
				carIndex = i
				break
			end
		end
		local cars = {}
		for i, c in ipairs(bundle.cars) do
			cars[i] = c
		end
		if carIndex then
			cars[carIndex] = Development.installUpgrade(cars[carIndex], project)
		end
		bundle = merge(bundle, {
			cars = cars,
			upgrades = map(bundle.upgrades, function(u)
				if u.id == project.id then
					local n = shallow(u)
					n.installed = true
					return n
				end
				return u
			end),
		})
	elseif t == "upgrade-facility" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local fac = find(bundle.facilities, function(f)
			return f.teamId == action.teamId and f.kind == action.kind
		end)
		if not fac then
			error("Facility not found.")
		end
		if fac.level >= 5 then
			error("This facility is already at its maximum level.")
		end
		local cost = Development.facilityUpgradeCost(action.kind, fac.level)
		local fin = find(bundle.finances, function(f)
			return f.teamId == action.teamId
		end)
		if fin.balance - cost < -20000000 then
			error("Insufficient funds to upgrade this facility.")
		end
		local txn = Finance.makeTxn(
			{ careerId = bundle.career.id, teamId = action.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex },
			"manufacturing",
			-cost,
			"Facility upgrade: " .. Development.FACILITY_META[action.kind].name
		)
		bundle = merge(bundle, {
			facilities = map(bundle.facilities, function(f)
				if f.kind == action.kind and f.teamId == action.teamId then
					local n = shallow(f)
					n.level = f.level + 1
					return n
				end
				return f
			end),
			finances = map(bundle.finances, function(f)
				if f.teamId == action.teamId then
					local n = shallow(f)
					n.balance = f.balance - cost
					return n
				end
				return f
			end),
			transactions = append(bundle.transactions, txn),
		})
	elseif t == "hire-staff" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local staff = find(bundle.staffMarket, function(s)
			return s.id == action.staffId
		end)
		if not staff then
			error("Staff member no longer available.")
		end
		local existing = find(bundle.staff, function(s)
			return s.teamId == action.teamId and s.role == staff.role
		end)
		if existing then
			error("You already employ a " .. staff.role .. ". Release them first.")
		end
		bundle = merge(bundle, {
			staff = append(bundle.staff, merge(staff, { teamId = action.teamId })),
			staffMarket = filter(bundle.staffMarket, function(s)
				return s.id ~= action.staffId
			end),
		})
	elseif t == "fire-staff" then
		local staff = find(bundle.staff, function(s)
			return s.id == action.staffId
		end)
		if staff and staff.teamId then
			assertOwnsTeam(bundle, ctx.userId, staff.teamId)
		end
		local market = bundle.staffMarket
		if staff then
			local back = shallow(staff)
			back.teamId = nil
			market = append(bundle.staffMarket, back)
		end
		bundle = merge(bundle, {
			staff = filter(bundle.staff, function(s)
				return s.id ~= action.staffId
			end),
			staffMarket = market,
		})
	elseif t == "sign-sponsor" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local sponsor = find(bundle.sponsors, function(s)
			return s.id == action.sponsorId
		end)
		if not sponsor then
			error("Sponsor not found.")
		end
		if contains(bundle.sponsorContracts, function(c)
			return c.teamId == action.teamId and c.sponsorId == sponsor.id and c.active
		end) then
			error(sponsor.name .. " is already an active partner.")
		end
		if not (action.seasons == 1 or action.seasons == 2 or action.seasons == 3) then
			error("Sponsorship must run for 1 to 3 seasons.")
		end
		local team = find(bundle.teams, function(tm)
			return tm.id == action.teamId
		end)
		if team.reputation < sponsor.minReputation then
			error(sponsor.name .. " requires a higher team reputation.")
		end
		local txn = Finance.makeTxn(
			{ careerId = bundle.career.id, teamId = action.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex },
			"sponsor-upfront",
			sponsor.upfront,
			sponsor.name .. " upfront payment"
		)
		bundle = merge(bundle, {
			sponsorContracts = append(bundle.sponsorContracts, {
				id = randomId("sc"),
				careerId = bundle.career.id,
				teamId = action.teamId,
				sponsorId = sponsor.id,
				seasons = action.seasons,
				startSeason = bundle.season.number,
				active = true,
			}),
			finances = map(bundle.finances, function(f)
				if f.teamId == action.teamId then
					local n = shallow(f)
					n.balance = f.balance + sponsor.upfront
					return n
				end
				return f
			end),
			transactions = append(bundle.transactions, txn),
		})
	elseif t == "emergency-funding" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local fin = find(bundle.finances, function(f)
			return f.teamId == action.teamId
		end)
		if fin.balance >= 0 then
			error("Emergency funding is only available when the balance is negative.")
		end
		local alreadyFunded = contains(bundle.transactions, function(tx)
			return tx.teamId == action.teamId and tx.description == "Emergency investor funding"
		end)
		if alreadyFunded then
			error("Emergency funding can only be drawn once per career.")
		end
		local amount = 25000000
		local txn = Finance.makeTxn(
			{ careerId = bundle.career.id, teamId = action.teamId, season = bundle.season.number, raceIndex = bundle.weekend.raceIndex },
			"investment",
			amount,
			"Emergency investor funding"
		)
		bundle = merge(bundle, {
			finances = map(bundle.finances, function(f)
				if f.teamId == action.teamId then
					local n = shallow(f)
					n.balance = f.balance + amount
					return n
				end
				return f
			end),
			transactions = append(bundle.transactions, txn),
		})
	elseif t == "update-team" then
		assertOwnsTeam(bundle, ctx.userId, action.teamId)
		local patch = action.patch or {}
		local safe = {}
		if type(patch.name) == "string" then
			safe.name = string.sub(patch.name, 1, 40)
		end
		if type(patch.shortName) == "string" then
			safe.shortName = string.sub(patch.shortName, 1, 20)
		end
		if type(patch.numberStyle) == "string" then
			safe.numberStyle = patch.numberStyle
		end
		if patch.colors then
			safe.colors = patch.colors
		end
		if patch.livery then
			safe.livery = patch.livery
		end
		if patch.logo then
			safe.logo = patch.logo
		end
		if safe.name then
			local clash = contains(bundle.teams, function(tm)
				return tm.id ~= action.teamId and string.lower(tm.name) == string.lower(safe.name)
			end)
			if clash then
				error("Another team already uses that name.")
			end
		end
		bundle = merge(bundle, {
			teams = map(bundle.teams, function(tm)
				if tm.id == action.teamId then
					local n = merge(tm, safe)
					n.id = tm.id
					n.careerId = tm.careerId
					return n
				end
				return tm
			end),
		})
	elseif t == "run-practice" then
		local res = Season.runPracticeSession(bundle, action.session)
		bundle = res.bundle
		extra.practice = res.result
	elseif t == "run-race" then
		local res = Season.runRaceWeekend(bundle)
		bundle = res.bundle
		extra.result = res.result
	elseif t == "advance-calendar" then
		bundle = Season.aiDevelopmentRound(Season.advanceCalendar(bundle))
	elseif t == "start-next-season" then
		bundle = Season.startNextSeason(bundle)
	else
		error("Unknown action")
	end

	return bundle, extra, sideEffect
end

-- Mirrors localBackend.negotiate
function CareerOps.negotiate(bundle, ctx, driverId, teamId, offer)
	if not ctx.isMember then
		error("You are not a member of this lobby.")
	end
	assertOwnsTeam(bundle, ctx.userId, teamId)
	local driver = find(bundle.drivers, function(d)
		return d.id == driverId
	end)
	if not driver then
		error("Driver not found.")
	end
	local team = find(bundle.teams, function(tm)
		return tm.id == teamId
	end)
	local rng = Rng.new(tostring(ctx.lobbyId) .. ":" .. driverId .. ":" .. string.format("%d", CareerOps.now()))
	return DriverMarket.negotiate(rng, driver, team, offer, team.objective)
end

return CareerOps
