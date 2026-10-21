-- Ported 1:1 from src/engine/finance.ts
-- NOTE: transaction ids embed a wall-clock timestamp (Date.now() in the web
-- engine) and a process counter, so they are non-deterministic by design. All
-- monetary maths is pure and deterministic.

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local Finance = {}

-- Per-race prize money by finishing position (USD). Falls back to a floor.
local RACE_PRIZE = {
	1200000, 950000, 800000, 700000, 620000, 560000, 510000, 470000, 430000, 400000,
	370000, 340000, 315000, 290000, 270000, 250000, 235000, 220000, 205000, 190000,
}

-- Season-end constructors' prize money by championship position (USD).
local CONSTRUCTORS_PRIZE = {
	60000000, 48000000, 40000000, 34000000, 29000000, 25000000, 21000000, 18000000,
	15500000, 13000000,
}

local BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"

local function toBase36(n)
	if n == 0 then
		return "0"
	end
	local s = ""
	while n > 0 do
		local d = n % 36
		s = string.sub(BASE36, d + 1, d + 1) .. s
		n = math.floor(n / 36)
	end
	return s
end

local txnCounter = 0
local function nextId(prefix)
	txnCounter += 1
	return prefix .. "-" .. toBase36(DateTime.now().UnixTimestampMillis) .. "-" .. toBase36(txnCounter)
end

local function makeTxn(ctx, category, amount, description)
	return {
		id = nextId("txn"),
		careerId = ctx.careerId,
		teamId = ctx.teamId,
		season = ctx.season,
		raceIndex = ctx.raceIndex,
		category = category,
		amount = amount,
		description = description,
		createdAt = DateTime.now().UnixTimestampMillis,
	}
end

local function raceFinishPrize(position)
	return RACE_PRIZE[position] or 120000
end

local function constructorsPrize(position)
	return CONSTRUCTORS_PRIZE[position] or 9000000
end

local function sponsorUpfront(sponsor)
	return sponsor.upfront
end

local function sponsorPerRace(sponsor)
	return sponsor.perRace
end

local function canAfford(balance, amount, reserve)
	return balance - amount >= (reserve or 0)
end

-- Season salary cost for a driver is paid pro-rata per race so teams feel the
-- burn each weekend. Rounded to whole dollars.
local function perRaceDriverSalary(contract, racesInSeason)
	local total = contract.salary + (contract.signingBonus or 0)
	return round(total / math.max(1, racesInSeason))
end

local function perRaceStaffCost(staff, racesInSeason)
	local total = 0
	for _, s in ipairs(staff) do
		total += s.wage
	end
	return round(total / math.max(1, racesInSeason))
end

local FACILITY_UPKEEP = {
	factory = 4000000,
	["design-office"] = 3000000,
	["wind-tunnel"] = 6000000,
	simulator = 3500000,
	["driver-academy"] = 2000000,
	["pit-crew"] = 2500000,
	commercial = 2000000,
	["reliability-lab"] = 3000000,
	hospitality = 1500000,
}

local function facilityUpkeep(facility)
	return (FACILITY_UPKEEP[facility.kind] or 2000000) * (1 + facility.level * 0.55)
end

local function facilityUpkeepPerRace(facilities, racesInSeason)
	local annual = 0
	for _, f in ipairs(facilities) do
		annual += facilityUpkeep(f)
	end
	return round(annual / math.max(1, racesInSeason))
end

-- Compute every transaction for one race weekend and the resulting balance.
-- Pure and deterministic: the same inputs always produce the same ledger.
local function computeRaceWeekendFinance(input)
	local txns = {}
	local ctx = input.ctx

	for _, r in ipairs(input.raceFinishPositions) do
		txns[#txns + 1] = makeTxn(ctx, "prize-money", raceFinishPrize(r.position), "Race prize money (P" .. r.position .. ")")
	end

	for _, sc in ipairs(input.sponsorContracts) do
		if sc.active then
			local sponsor
			for _, s in ipairs(input.sponsors) do
				if s.id == sc.sponsorId then
					sponsor = s
					break
				end
			end
			if sponsor then
				txns[#txns + 1] = makeTxn(ctx, "sponsor-per-race", sponsorPerRace(sponsor), sponsor.name .. " race payment")
			end
		end
	end

	local driverTotal = 0
	for _, c in ipairs(input.driverContracts) do
		driverTotal += perRaceDriverSalary(c, input.racesInSeason)
	end
	txns[#txns + 1] = makeTxn(ctx, "driver-salary", -driverTotal, "Driver salaries")
	txns[#txns + 1] = makeTxn(ctx, "staff-wage", -perRaceStaffCost(input.staff, input.racesInSeason), "Staff wages")
	txns[#txns + 1] = makeTxn(ctx, "facility-upkeep", -facilityUpkeepPerRace(input.facilities, input.racesInSeason), "Facility upkeep")
	txns[#txns + 1] = makeTxn(ctx, "travel", -input.travelPerRace, "Travel & logistics")

	if input.repairCosts > 0 then
		txns[#txns + 1] = makeTxn(ctx, "repairs", -input.repairCosts, "Crash repairs")
	end

	local sum = 0
	for _, t in ipairs(txns) do
		sum += t.amount
	end
	local newBalance = input.balance + sum
	return { transactions = txns, newBalance = newBalance }
end

Finance.makeTxn = makeTxn
Finance.raceFinishPrize = raceFinishPrize
Finance.constructorsPrize = constructorsPrize
Finance.sponsorUpfront = sponsorUpfront
Finance.sponsorPerRace = sponsorPerRace
Finance.canAfford = canAfford
Finance.perRaceDriverSalary = perRaceDriverSalary
Finance.perRaceStaffCost = perRaceStaffCost
Finance.facilityUpkeepPerRace = facilityUpkeepPerRace
Finance.facilityUpkeep = facilityUpkeep
Finance.computeRaceWeekendFinance = computeRaceWeekendFinance

return Finance
