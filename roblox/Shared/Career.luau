-- Ported from src/lib/career.ts

local Career = {}

function Career.findTeam(bundle, teamId)
	if not teamId then
		return nil
	end
	for _, t in ipairs(bundle.teams) do
		if t.id == teamId then
			return t
		end
	end
	return nil
end

function Career.findDriver(bundle, driverId)
	if not driverId then
		return nil
	end
	for _, d in ipairs(bundle.drivers) do
		if d.id == driverId then
			return d
		end
	end
	return nil
end

function Career.teamDrivers(bundle, teamId)
	local out = {}
	for _, d in ipairs(bundle.drivers) do
		if d.teamId == teamId then
			out[#out + 1] = d
			if #out == 2 then
				break
			end
		end
	end
	return out
end

function Career.balanceOf(bundle, teamId)
	for _, f in ipairs(bundle.finances) do
		if f.teamId == teamId then
			return f.balance
		end
	end
	return 0
end

function Career.constructorRow(bundle, teamId)
	for _, r in ipairs(bundle.standings.constructors) do
		if r.teamId == teamId then
			return r
		end
	end
	return nil
end

function Career.driverRow(bundle, driverId)
	for _, r in ipairs(bundle.standings.drivers) do
		if r.driverId == driverId then
			return r
		end
	end
	return nil
end

function Career.activeSponsors(bundle, teamId)
	local out = {}
	for _, sc in ipairs(bundle.sponsorContracts) do
		if sc.teamId == teamId and sc.active then
			local sponsor = nil
			for _, s in ipairs(bundle.sponsors) do
				if s.id == sc.sponsorId then
					sponsor = s
					break
				end
			end
			if sponsor then
				out[#out + 1] = { contract = sc, sponsor = sponsor }
			end
		end
	end
	return out
end

function Career.seasonLabel(bundle)
	return tostring(bundle.settings.startingSeason + bundle.season.number - 1)
end

function Career.raceLabel(index, length)
	return string.format("Round %d of %d", math.min(index + 1, length), length)
end

function Career.driverName(bundle, driverId)
	local d = Career.findDriver(bundle, driverId)
	return d and d.name or "—"
end

function Career.teamShort(bundle, teamId)
	local t = Career.findTeam(bundle, teamId)
	return t and t.shortName or "—"
end

return Career
