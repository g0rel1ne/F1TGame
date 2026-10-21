local UiKit = require(script.Parent.Parent.UiKit)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local tab = "drivers"

local function fmtNum(n)
	local s = tostring(n)
	local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if out:sub(1, 1) == "," then out = out:sub(2) end
	return out
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	if not bundle then return end
	local results = {}
	for _, r in ipairs(bundle.results) do
		if r.processed then table.insert(results, r) end
	end

	local driverMap, driverOrder = {}, {}
	for _, r in ipairs(results) do
		for _, c in ipairs(r.classification) do
			local cur = driverMap[c.driverId]
			if not cur then
				cur = { driverId = c.driverId, teamId = c.teamId, starts = 0, wins = 0, podiums = 0, points = 0, dnfs = 0, best = 99, finishSum = 0, laps = 0, fl = 0 }
				driverMap[c.driverId] = cur
				table.insert(driverOrder, cur)
			end
			cur.starts = cur.starts + 1
			cur.teamId = c.teamId
			cur.laps = cur.laps + c.laps
			cur.points = cur.points + c.points
			if c.status == "finished" then
				if c.position == 1 then cur.wins = cur.wins + 1 end
				if c.position <= 3 then cur.podiums = cur.podiums + 1 end
				if c.position < cur.best then cur.best = c.position end
				cur.finishSum = cur.finishSum + c.position
			else
				cur.dnfs = cur.dnfs + 1
			end
			if r.fastestLapDriverId == c.driverId then cur.fl = cur.fl + 1 end
		end
	end
	table.sort(driverOrder, function(a, b)
		if a.points ~= b.points then return a.points > b.points end
		return a.best < b.best
	end)

	local teamStats = {}
	for _, t in ipairs(bundle.teams) do
		local entry = { team = t, starts = 0, wins = 0, podiums = 0, points = 0, finishSum = 0, finished = 0, dnfs = 0, pits = 0, incidents = 0 }
		for _, r in ipairs(results) do
			for _, c in ipairs(r.classification) do
				if c.teamId == t.id then
					entry.starts = entry.starts + 1
					entry.points = entry.points + c.points
					entry.pits = entry.pits + (c.pits or 0)
					if c.status == "finished" then
						entry.finished = entry.finished + 1
						entry.finishSum = entry.finishSum + c.position
						if c.position == 1 then entry.wins = entry.wins + 1 end
						if c.position <= 3 then entry.podiums = entry.podiums + 1 end
					else
						entry.dnfs = entry.dnfs + 1
					end
				end
			end
			for _, inc in ipairs(r.incidents or {}) do
				for _, id in ipairs(inc.involvedDriverIds or {}) do
					local d = Career.findDriver(bundle, id)
					if d and d.teamId == t.id then
						entry.incidents = entry.incidents + 1
						break
					end
				end
			end
		end
		table.insert(teamStats, entry)
	end
	table.sort(teamStats, function(a, b) return a.points > b.points end)

	local totalLaps, totalIncidents, totalDnfs, totalSc = 0, 0, 0, 0
	for _, r in ipairs(results) do
		local maxLaps = 0
		for _, c in ipairs(r.classification) do
			if c.laps > maxLaps then maxLaps = c.laps end
		end
		totalLaps = totalLaps + maxLaps
		totalIncidents = totalIncidents + #(r.incidents or {})
		for _, c in ipairs(r.classification) do
			if c.status == "dnf" then totalDnfs = totalDnfs + 1 end
		end
		totalSc = totalSc + (r.safetyCarDeployments or 0) + (r.virtualSafetyCarPeriods or 0)
	end

	Common.sectionHeading(parent, "Statistics", string.format("%s season · aggregated from %d processed race%s", Career.seasonLabel(bundle), #results, #results == 1 and "" or "s"))

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Races completed", value = tostring(#results), hint = "Processed results" })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Racing laps", value = fmtNum(totalLaps), hint = "Across all classified cars" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Incidents", value = tostring(totalIncidents), hint = string.format("%d retirements", totalDnfs) })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Neutralisations", value = tostring(totalSc), hint = "Safety cars + VSCs" })
	UiKit.splitH(s4, 4, 10, 4)

	local labels = { "Drivers", "Teams", "Races" }
	local keys = { "drivers", "teams", "races" }
	local currentLabel = "Drivers"
	for i = 1, 3 do
		if keys[i] == tab then currentLabel = labels[i] end
	end
	local seg = Common.segmented(parent, labels, currentLabel, function(v)
		for i = 1, 3 do
			if labels[i] == v then tab = keys[i] end
		end
		ctx.shell.rebuild()
	end, { perRow = 3 })
	seg.Size = UDim2.new(0, 250, 0, 32)

	if #results == 0 then
		UiKit.Empty(parent, { title = "No completed races", hint = "Statistics build up as race weekends are finished." })
		return
	end

	if tab == "drivers" then
		local body = UiKit.Panel(parent, { title = "Driver statistics" })
		local wrap, buildRow = UiKit.Table(body, {
			columns = { "Driver", "Team", "Starts", "Wins", "Podiums", "Pts", "Best", "Avg fin", "DNF", "FL" },
			widths = { 0.3, 0.14, 0.08, 0.07, 0.1, 0.08, 0.07, 0.09, 0.06, 0.05 },
			rowHeight = 28,
		})
		for i, s in ipairs(driverOrder) do
			local d = Career.findDriver(bundle, s.driverId)
			local t = Career.findTeam(bundle, s.teamId)
			local finished = s.starts - s.dnfs
			buildRow({
				d and d.name or s.driverId,
				t and t.shortName or "—",
				tostring(s.starts),
				tostring(s.wins),
				tostring(s.podiums),
				tostring(s.points),
				s.best == 99 and "—" or string.format("P%d", s.best),
				finished > 0 and string.format("%.1f", s.finishSum / finished) or "—",
				tostring(s.dnfs),
				tostring(s.fl),
			}, false, i)
		end
	elseif tab == "teams" then
		local body = UiKit.Panel(parent, { title = "Team statistics" })
		local wrap, buildRow = UiKit.Table(body, {
			columns = { "Team", "Starts", "Wins", "Podiums", "Pts", "Avg fin", "DNF", "Pit stops", "Incidents" },
			widths = { 0.28, 0.09, 0.07, 0.1, 0.08, 0.1, 0.07, 0.11, 0.1 },
			rowHeight = 28,
		})
		for i, s in ipairs(teamStats) do
			buildRow({
				s.team.shortName,
				tostring(s.starts),
				tostring(s.wins),
				tostring(s.podiums),
				tostring(s.points),
				s.finished > 0 and string.format("%.1f", s.finishSum / s.finished) or "—",
				tostring(s.dnfs),
				tostring(s.pits),
				tostring(s.incidents),
			}, false, i)
		end
	else
		local body = UiKit.Panel(parent, { title = "Race reports" })
		for _, r in ipairs(results) do
			local winner = r.classification[1] and Career.findDriver(bundle, r.classification[1].driverId) or nil
			local dnfCount = 0
			for _, c in ipairs(r.classification) do
				if c.status == "dnf" then dnfCount = dnfCount + 1 end
			end
			local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, Size = UDim2.new(1, 0, 0, 44) }, body)
			UiKit.corner(card, 8)
			UiKit.label(card, string.format("Round %d · %s", r.raceIndex + 1, winner and winner.name or "—"), { size = 11, font = Enum.Font.GothamBold, color = C.gray200, size2 = UDim2.new(1, 0, 0, 16) }).Position = UDim2.new(0, 10, 0, 5)
			UiKit.label(card, string.format("%d laps · %s · %d DNF", #(r.laps or {}), tostring(r.weatherStart), dnfCount), { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) }).Position = UDim2.new(0, 10, 0, 22)
			UiKit.label(card, string.format("%d incidents · %d SC · %d VSC · %d red", #(r.incidents or {}), r.safetyCarDeployments or 0, r.virtualSafetyCarPeriods or 0, r.redFlags or 0), { size = 9, color = C.gray400, size2 = UDim2.new(0, 320, 0, 16), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -330, 0, 14)
		end
	end
end
