local UiKit = require(script.Parent.Parent.UiKit)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Rulesets = require(RS.Shared.Data.Rulesets)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local tab = "constructors"

return function(ctx, parent)
	local bundle = ctx.state.bundle
	if not bundle then return end
	local ruleset = Rulesets.get(bundle.season.rulesetId)
	local results = {}
	for _, r in ipairs(bundle.results) do
		if r.processed then table.insert(results, r) end
	end
	local leader = (#bundle.standings.constructors > 0 and bundle.standings.constructors[1].points) or 0
	local driverLeader = (#bundle.standings.drivers > 0 and bundle.standings.drivers[1].points) or 0

	Common.sectionHeading(parent, "Championship", string.format("%s season · %d of %d rounds scored", Career.seasonLabel(bundle), #results, #bundle.season.calendar))

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Rounds completed", value = string.format("%d/%d", #results, #bundle.season.calendar), hint = "Processed results" })
	UiKit.splitH(s1, 4, 10, 1)
	local pts = ruleset.racePoints
	local s2 = UiKit.Stat(stats, { label = "Points system", value = string.format("%d–%d", pts[1], pts[#pts]), hint = string.format("Top %d score", #pts) })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Fastest lap", value = ruleset.fastestLapPoints > 0 and string.format("+%d", ruleset.fastestLapPoints) or "None", hint = ruleset.fastestLapPoints > 0 and string.format("Inside top %d", ruleset.fastestLapTopN) or "Not awarded" })
	UiKit.splitH(s3, 4, 10, 3)
	local champName = "In progress"
	if bundle.season.championDriverId then
		local d = Career.findDriver(bundle, bundle.season.championDriverId)
		champName = d and d.name or "—"
	end
	local champTeam = bundle.season.championTeamId and Career.findTeam(bundle, bundle.season.championTeamId)
	local s4 = UiKit.Stat(stats, { label = "Season champion", value = champName, hint = champTeam and champTeam.shortName or "" })
	UiKit.splitH(s4, 4, 10, 4)

	local seg = Common.segmented(parent, { "Constructors", "Drivers" }, tab == "constructors" and "Constructors" or "Drivers", function(v)
		tab = v == "Constructors" and "constructors" or "drivers"
		ctx.shell.rebuild()
	end, { perRow = 2 })
	seg.Size = UDim2.new(0, 240, 0, 32)

	if tab == "constructors" then
		local body = UiKit.Panel(parent, { title = "Constructors' championship", right = UiKit.Badge(nil, ruleset.name, "info") })
		if #bundle.standings.constructors == 0 then
			UiKit.Empty(body, { title = "No points scored yet", hint = "Standings appear after the first processed race." })
		else
			local wrap, buildRow = UiKit.Table(body, {
				columns = { "Pos", "Team", "Pts", "Gap", "Wins", "Podiums", "Poles", "FL", "DNF" },
				widths = { 0.06, 0.36, 0.09, 0.09, 0.08, 0.1, 0.08, 0.07, 0.07 },
				rowHeight = 34,
			})
			for i, r in ipairs(bundle.standings.constructors) do
				local t = Career.findTeam(bundle, r.teamId)
				local row = buildRow({
					Format.ordinal(r.position),
					t and string.format("%s (%s)", t.name, t.engineSupplier) or r.teamId,
					tostring(r.points),
					r.position == 1 and "—" or "-" .. tostring(leader - r.points),
					tostring(r.wins),
					tostring(r.podiums),
					tostring(r.poles),
					tostring(r.fastestLaps),
					tostring(r.dnfs),
				}, false, i)
				if r.position == 1 then
					for _, ch in ipairs(row:GetChildren()) do
						if ch:IsA("TextLabel") then ch.TextColor3 = C.raceAmber end
					end
				end
			end
		end
	else
		local body = UiKit.Panel(parent, { title = "Drivers' championship", right = UiKit.Badge(nil, ruleset.name, "info") })
		if #bundle.standings.drivers == 0 then
			UiKit.Empty(body, { title = "No points scored yet", hint = "Standings appear after the first processed race." })
		else
			local wrap, buildRow = UiKit.Table(body, {
				columns = { "Pos", "Driver", "Team", "Pts", "Gap", "Wins", "Podiums", "Poles", "DNF" },
				widths = { 0.06, 0.32, 0.15, 0.09, 0.09, 0.08, 0.1, 0.06, 0.05 },
				rowHeight = 32,
			})
			for i, r in ipairs(bundle.standings.drivers) do
				local d = Career.findDriver(bundle, r.driverId)
				local t = Career.findTeam(bundle, r.teamId)
				local row = buildRow({
					Format.ordinal(r.position),
					d and d.name or r.driverId,
					t and t.shortName or "—",
					tostring(r.points),
					r.position == 1 and "—" or "-" .. tostring(driverLeader - r.points),
					tostring(r.wins),
					tostring(r.podiums),
					tostring(r.poles),
					tostring(r.dnfs),
				}, false, i)
				if r.position == 1 then
					for _, ch in ipairs(row:GetChildren()) do
						if ch:IsA("TextLabel") then ch.TextColor3 = C.raceAmber end
					end
				end
			end
		end
	end

	local regs = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 70) }, parent)
	UiKit.corner(regs, 10)
	UiKit.stroke(regs, C.carbon700, 1)
	UiKit.pad(regs, 12)
	UiKit.label(regs, "SPORTING REGULATIONS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	UiKit.label(regs, string.format("Qualifying: Q1 eliminates %d, Q2 eliminates %d.   Mandatory pit stop: %s.   Cost cap: %s.   Safety cars: %s%s%s.", ruleset.q1Eliminated, ruleset.q2Eliminated, ruleset.mandatoryPitStop and "Yes" or "No", ruleset.costCap > 0 and string.format("$%dM", ruleset.costCap) or "Disabled", ruleset.safetyCars and "Yes" or "No", ruleset.virtualSafetyCars and " · VSC" or "", ruleset.redFlags and " · Red flags" or ""), {
		size = 10, color = C.gray400, size2 = UDim2.new(1, 0, 0, 34), wrap = true, y = Enum.TextYAlignment.Top,
	})
end
