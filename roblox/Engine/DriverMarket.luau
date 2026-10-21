-- Ported 1:1 from src/engine/drivermarket.ts

local Rng = require(script.Parent.Rng)
local clamp = Rng.clamp
local round = Rng.round

local DriverMarket = {}

-- Stable sort to match JavaScript's Array.prototype.sort.
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

function DriverMarket.expectedSalary(driver, teamReputation)
	local base = driver.salaryDemand
	-- Better teams can offer slightly less cash but more prestige.
	local prestigeDiscount = 1 - clamp((teamReputation - 60) / 200, -0.15, 0.2)
	return round(base * prestigeDiscount)
end

function DriverMarket.acceptanceProbability(driver, team, offer, teamObjective)
	local expected = DriverMarket.expectedSalary(driver, team.reputation)
	local ratio = offer.salary / math.max(1, expected)

	local p = 0.1 + (ratio - 1) * 0.85
	p += clamp((team.reputation - 60) / 120, -0.25, 0.3)
	p += offer.role == "lead" and 0.12 or (offer.role == "development" and -0.05 or 0.04)
	p += clamp(offer.years - 1, 0, 3) * 0.06
	p += offer.signingBonus > expected * 0.15 and 0.07 or 0
	p += clamp((driver.morale - 55) / 300, -0.1, 0.12)
	-- Ambitious top drivers dislike a team with a low objective (poor prospects).
	if driver.reputation > 80 then
		p += clamp((6 - teamObjective) / 40, -0.12, 0.12)
	end
	if team.isPlayerTeam then
		p += 0.03
	end

	return clamp(p, 0.01, 0.98)
end

function DriverMarket.negotiate(rng, driver, team, offer, teamObjective)
	local p = DriverMarket.acceptanceProbability(driver, team, offer, teamObjective)
	if rng:chance(p) then
		return { accepted = true, probability = p, counterOffer = nil, message = driver.name .. " accepts the offer." }
	end
	-- Counter: bump salary toward what the driver expects.
	local expected = DriverMarket.expectedSalary(driver, team.reputation)
	local counter = {}
	for k, v in pairs(offer) do
		counter[k] = v
	end
	counter.salary = round(math.max(offer.salary * 1.12, expected * rng:range(1.02, 1.2)))
	counter.signingBonus = round(math.max(offer.signingBonus, expected * rng:range(0.05, 0.2)))
	local message
	if p < 0.25 then
		message = driver.name .. "'s management dismisses the offer out of hand — it is some way short of expectations."
	else
		message = driver.name .. " is interested but wants an improved package."
	end
	return { accepted = false, probability = p, counterOffer = counter, message = message }
end

function DriverMarket.aiWillingToPay(team, profile)
	local base = team.budget * 0.22
	local careful = profile and (1.15 - profile.riskAppetite * 0.3) or 1
	return math.max(2000000, base * careful)
end

function DriverMarket.aiDriverMarket(rng, teams, freeDrivers, assigned, _teamObjectives)
	local signings = {}
	local pool = stableSort(freeDrivers, function(a, b)
		return (a.attributes.pace + a.potential) > (b.attributes.pace + b.potential)
	end)

	for _, team in ipairs(teams) do
		local currentDrivers = {}
		for _, d in ipairs(pool) do
			if d.teamId == team.id then
				currentDrivers[#currentDrivers + 1] = d
			end
		end
		local needed = math.max(0, 2 - #currentDrivers)
		if needed ~= 0 then
			local budgetCap = DriverMarket.aiWillingToPay(team, team.aiProfile)
			for _ = 1, needed do
				local candidates = {}
				for _, d in ipairs(pool) do
					if not assigned[d.id] and (d.teamId == nil or d.teamId == team.id) then
						candidates[#candidates + 1] = d
					end
				end
				if #candidates == 0 then
					break
				end
				-- Pick the best affordable driver with some randomness.
				local affordable = {}
				for _, d in ipairs(candidates) do
					if DriverMarket.expectedSalary(d, team.reputation) <= budgetCap then
						affordable[#affordable + 1] = d
					end
				end
				local choice
				if #affordable > 0 then
					choice = affordable[rng:int(0, math.min(2, #affordable - 1)) + 1]
				else
					choice = candidates[#candidates]
				end
				local salary = DriverMarket.expectedSalary(choice, team.reputation)
				assigned[choice.id] = true
				signings[#signings + 1] = { teamId = team.id, driverId = choice.id, salary = round(salary * rng:range(1, 1.3)), years = rng:int(1, 3) }
			end
		end
	end
	return signings
end

return DriverMarket
