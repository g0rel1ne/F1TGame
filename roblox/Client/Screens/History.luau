local UiKit = require(script.Parent.Parent.UiKit)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Standings = require(RS.Shared.Engine.Standings)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local openSeason = nil

return function(ctx, parent)
	local bundle = ctx.state.bundle
	if not bundle then return end

	local seasons = {}
	for i = #bundle.seasons, 1, -1 do
		local season = bundle.seasons[i]
		local results = {}
		for _, r in ipairs(bundle.results) do
			if r.season == season.number and r.processed then table.insert(results, r) end
		end
		local standings = season.completed and Standings.computeStandings(results, season.number) or bundle.standings
		table.insert(seasons, { season = season, results = results, standings = standings })
	end

	Common.sectionHeading(parent, "Career History", "Season-by-season record, champions and final standings.")

	local badgeRow = UiKit.hrow(parent, 22, 6)
	UiKit.Badge(badgeRow, string.format("%d season%s", #bundle.seasons, #bundle.seasons == 1 and "" or "s"), "info").LayoutOrder = 1

	for _, entry in ipairs(seasons) do
		local season, results, standings = entry.season, entry.results, entry.standings
		local isOpen = openSeason == season.number
		local champion = season.championDriverId and Career.findDriver(bundle, season.championDriverId) or nil
		local championTeam = season.championTeamId and Career.findTeam(bundle, season.championTeamId) or nil
		local year = bundle.settings.startingSeason + season.number - 1

		local card = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
		UiKit.corner(card, 10)
		UiKit.stroke(card, C.carbon700, 1)
		UiKit.list(card, { gap = 6, pad = 14 })

		local head = UiKit.hrow(card, 40, 10)
		local trophy = inst("Frame", { BackgroundColor3 = C.carbon800, BorderSizePixel = 0, Size = UDim2.new(0, 40, 0, 40) }, head)
		UiKit.corner(trophy, 8)
		UiKit.label(trophy, "★", { size = 18, color = season.completed and C.raceAmber or C.gray500, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
		local info = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -150, 1, 0) }, head)
		info.Position = UDim2.new(0, 50, 0, 0)
		UiKit.label(info, string.format("%d season", year), { font = UiKit.FONT_DISPLAY, size = 13, color = C.gray100, size2 = UDim2.new(1, 0, 0, 18) })
		local subtitle = season.completed and (champion and champion.name or "Champion not recorded") or string.format("Season in progress · %d/%d rounds", #results, #season.calendar)
		UiKit.label(info, subtitle, { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14), truncate = Enum.TextTruncate.AtEnd })
		if season.completed and championTeam then
			UiKit.label(info, championTeam.name .. " constructors' champions", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 12) }).Position = UDim2.new(0, 0, 0, 28)
		end
		local badge = UiKit.Badge(head, season.completed and "Complete" or "Active", season.completed and "good" or "info")
		badge.AnchorPoint = Vector2.new(1, 0.5)
		badge.Position = UDim2.new(1, -80, 0.5, 0)
		local toggle = UiKit.button(head, isOpen and "Hide" or "Details", function()
			openSeason = isOpen and nil or season.number
			ctx.shell.rebuild()
		end, { variant = "subtle", width = 64, height = 26, textSize = 10 })
		toggle.AnchorPoint = Vector2.new(1, 0.5)
		toggle.Position = UDim2.new(1, 0, 0.5, 0)

		if isOpen then
			local cols = UiKit.hrow(card, 0, 14)
			cols.AutomaticSize = Enum.AutomaticSize.Y
			local leftCol = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -7, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
			UiKit.list(leftCol, { gap = 3 })
			UiKit.label(leftCol, "FINAL CONSTRUCTORS' STANDINGS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
			if #standings.constructors == 0 then
				UiKit.label(leftCol, "No standings", { size = 10, color = C.gray600, size2 = UDim2.new(1, 0, 0, 16) })
			else
				for i = 1, math.min(10, #standings.constructors) do
					local r = standings.constructors[i]
					local t = Career.findTeam(bundle, r.teamId)
					local row = UiKit.hrow(leftCol, 15, 5)
					UiKit.label(row, tostring(r.position), { font = UiKit.FONT_MONO, size = 9, color = C.gray500, size2 = UDim2.new(0, 16, 1, 0), x = Enum.TextXAlignment.Right })
					local dot = inst("Frame", { BackgroundColor3 = Common.hexcolor(t and t.colors.primary or nil, C.gray600), BorderSizePixel = 0, Size = UDim2.new(0, 8, 0, 8) }, row)
					UiKit.corner(dot, 2)
					UiKit.label(row, t and t.name or r.teamId, { size = 10, color = C.gray300, size2 = UDim2.new(1, -60, 1, 0), truncate = Enum.TextTruncate.AtEnd })
					UiKit.label(row, tostring(r.points), { font = UiKit.FONT_MONO, size = 10, color = C.gray400, size2 = UDim2.new(0, 32, 1, 0), x = Enum.TextXAlignment.Right })
				end
			end

			local rightCol = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -7, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
			UiKit.list(rightCol, { gap = 3 })
			rightCol.Position = UDim2.new(0.5, 7, 0, 0)
			UiKit.label(rightCol, "RACE WINNERS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
			if #results == 0 then
				UiKit.label(rightCol, "No races yet", { size = 10, color = C.gray600, size2 = UDim2.new(1, 0, 0, 16) })
			else
				for _, r in ipairs(results) do
					local winner = r.classification[1] and Career.findDriver(bundle, r.classification[1].driverId) or nil
					local row = UiKit.hrow(rightCol, 15, 5)
					UiKit.label(row, string.format("R%d · %s", r.raceIndex + 1, Common.circuit(r.circuitId).name), { size = 9, color = C.gray500, size2 = UDim2.new(1, -110, 1, 0), truncate = Enum.TextTruncate.AtEnd })
					UiKit.label(row, winner and winner.name or "—", { size = 9, color = C.gray200, size2 = UDim2.new(0, 110, 1, 0), x = Enum.TextXAlignment.Right, truncate = Enum.TextTruncate.AtEnd })
				end
			end
		end

		UiKit.label(card, string.format("%d · %d rounds · %d completed", year, #season.calendar, #results), { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	end
end
