-- Ported 1:1 from src/engine/standings.ts
-- Pure aggregation of race results into championship standings. Stable ordering
-- on ties (points, wins, podiums) matches JavaScript's stable Array.sort.

local Standings = {}

local function computeStandings(results, season)
	local driverMap = {}
	local driverOrder = {}
	local teamMap = {}
	local teamOrder = {}

	for _, r in ipairs(results) do
		if r.season == season then
			for _, entry in ipairs(r.classification) do
				local d = driverMap[entry.driverId]
				if not d then
					d = {
						driverId = entry.driverId,
						teamId = entry.teamId,
						points = 0,
						wins = 0,
						podiums = 0,
						poles = 0,
						fastestLaps = 0,
						dnfs = 0,
						position = 0,
					}
					driverMap[entry.driverId] = d
					driverOrder[#driverOrder + 1] = entry.driverId
				end
				d.teamId = entry.teamId
				d.points += entry.points
				if entry.position == 1 and entry.status == "finished" then
					d.wins += 1
				end
				if entry.position <= 3 and entry.status == "finished" then
					d.podiums += 1
				end
				if entry.fastestLap then
					d.fastestLaps += 1
				end
				if entry.status == "dnf" then
					d.dnfs += 1
				end

				local t = teamMap[entry.teamId]
				if not t then
					t = {
						teamId = entry.teamId,
						points = 0,
						wins = 0,
						podiums = 0,
						poles = 0,
						fastestLaps = 0,
						dnfs = 0,
						position = 0,
					}
					teamMap[entry.teamId] = t
					teamOrder[#teamOrder + 1] = entry.teamId
				end
				t.points += entry.points
				if entry.position == 1 and entry.status == "finished" then
					t.wins += 1
				end
				if entry.position <= 3 and entry.status == "finished" then
					t.podiums += 1
				end
				if entry.fastestLap then
					t.fastestLaps += 1
				end
				if entry.status == "dnf" then
					t.dnfs += 1
				end
			end

			-- Poles awarded to the qualifying leader.
			if r.session == "race" and r.poleDriverId then
				local d = driverMap[r.poleDriverId]
				if d then
					d.poles += 1
				end
				local entry
				for _, c in ipairs(r.classification) do
					if c.driverId == r.poleDriverId then
						entry = c
						break
					end
				end
				if entry then
					local t = teamMap[entry.teamId]
					if t then
						t.poles += 1
					end
				end
			end
		end
	end

	local function sortRows(map, order)
		local indexed = {}
		for i, id in ipairs(order) do
			indexed[i] = { row = map[id], i = i }
		end
		table.sort(indexed, function(a, b)
			local ra, rb = a.row, b.row
			if ra.points ~= rb.points then
				return ra.points > rb.points
			end
			if ra.wins ~= rb.wins then
				return ra.wins > rb.wins
			end
			if ra.podiums ~= rb.podiums then
				return ra.podiums > rb.podiums
			end
			return a.i < b.i
		end)
		local out = {}
		for i, e in ipairs(indexed) do
			e.row.position = i
			out[i] = e.row
		end
		return out
	end

	return {
		season = season,
		drivers = sortRows(driverMap, driverOrder),
		constructors = sortRows(teamMap, teamOrder),
	}
end

Standings.computeStandings = computeStandings

return Standings
