local UiKit = require(script.Parent.Parent.UiKit)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

return function(ctx, parent)
	local bundle = ctx.state.bundle
	if not bundle then return end
	local current = bundle.season.currentRaceIndex
	local sprints = {}
	for _, idx in ipairs(bundle.season.sprintRaces or {}) do
		sprints[idx] = true
	end

	if not bundle.results then bundle.results = {} end
	local function resultAt(idx)
		for _, r in ipairs(bundle.results) do
			if r.season == bundle.season.number and r.raceIndex == idx then
				return r
			end
		end
		return nil
	end

	Common.sectionHeading(parent, "Calendar", string.format("%s season · %d rounds · %d%% race distance", Career.seasonLabel(bundle), #bundle.season.calendar, bundle.settings.raceDistancePct))

	local badgeRow = UiKit.hrow(parent, 22, 6)
	local b = UiKit.Badge(badgeRow, string.format("Round %d", math.min(current + 1, #bundle.season.calendar)), "info")
	b.LayoutOrder = 1

	for idx, circuitId in ipairs(bundle.season.calendar) do
		local idx0 = idx - 1
		local circuit = Common.circuit(circuitId)
		local result = resultAt(idx0)
		local isCurrent = idx0 == current and not bundle.season.completed
		local winner = result and result.classification and result.classification[1] or nil
		local winnerDriver = winner and Career.findDriver(bundle, winner.driverId) or nil
		local winnerTeam = winner and Career.findTeam(bundle, winner.teamId) or nil
		local pole = result and result.poleDriverId and Career.findDriver(bundle, result.poleDriverId) or nil
		local fastest = result and result.fastestLapDriverId and Career.findDriver(bundle, result.fastestLapDriverId) or nil
		local fastestLap = nil
		if result and result.classification then
			for _, c in ipairs(result.classification) do
				if c.driverId == result.fastestLapDriverId then fastestLap = c.bestLap end
			end
		end

		local row = inst("Frame", {
			BackgroundColor3 = isCurrent and C.carbon900 or C.carbon850,
			BackgroundTransparency = isCurrent and 0.2 or 0,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 0, 58),
		}, parent)
		UiKit.corner(row, 8)
		UiKit.stroke(row, isCurrent and C.raceTeal or C.carbon700, 1)
		UiKit.pad(row, 0, 12, 0, 12)

		UiKit.label(row, "ROUND", { size = 8, color = C.gray500, size2 = UDim2.new(0, 50, 0, 10) }).Position = UDim2.new(0, 12, 0, 9)
		UiKit.label(row, tostring(idx), { font = UiKit.FONT_DISPLAY, size = 17, color = C.gray200, size2 = UDim2.new(0, 50, 0, 22) }).Position = UDim2.new(0, 12, 0, 20)

		local nameText = circuit.name
		UiKit.label(row, nameText, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(0, 220, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 72, 0, 8)
		UiKit.label(row, string.format("%s, %s · %.3f km · %d corners", circuit.location, circuit.country, circuit.lengthKm, circuit.corners), { size = 9, color = C.gray500, size2 = UDim2.new(0, 340, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 72, 0, 24)

		local tags = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 320, 0, 18) }, row)
		tags.Position = UDim2.new(0, 72, 0, 37)
		UiKit.list(tags, { dir = Enum.FillDirection.Horizontal, gap = 4 })
		if sprints[idx0] then
			UiKit.Badge(tags, "Sprint", "warn").LayoutOrder = 1
		end
		if result then
			UiKit.Badge(tags, "Complete", "good").LayoutOrder = 2
		elseif isCurrent then
			UiKit.Badge(tags, "Next up", "info").LayoutOrder = 3
		end

		local info = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 250, 0, 36) }, row)
		info.Position = UDim2.new(0.62, 0, 0, 10)
		if result and winnerDriver then
			UiKit.label(info, string.format("Winner: %s (%s)", winnerDriver.name, winnerTeam and winnerTeam.shortName or "—"), { size = 10, color = C.gray300, size2 = UDim2.new(1, 0, 0, 14), truncate = Enum.TextTruncate.AtEnd })
			local extras = {}
			if pole then table.insert(extras, string.format("Pole %s %s", pole.code, Format.lapTime(result.qualifying and result.qualifying[1] and result.qualifying[1].best or nil))) end
			if fastest then table.insert(extras, string.format("FL %s %s", fastest.code, Format.lapTime(fastestLap))) end
			UiKit.label(info, table.concat(extras, "   "), { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 0, 0, 18)
		else
			local weather = isCurrent and bundle.weekend.weather.condition or string.format("%d%% rain", math.floor(circuit.rainChance * 100 + 0.5))
			local laps = math.max(5, math.floor(circuit.laps * bundle.settings.raceDistancePct / 100 + 0.5))
			UiKit.label(info, string.format("%s · %d laps", weather, laps), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
		end

		if isCurrent or result then
			local btn = UiKit.button(row, isCurrent and "Race weekend" or "View result", function()
				ctx.navigate("race")
			end, { variant = isCurrent and "primary" or "subtle", width = 110, height = 28, textSize = 11 })
			btn.AnchorPoint = Vector2.new(1, 0.5)
			btn.Position = UDim2.new(1, -12, 0.5, 0)
		else
			UiKit.label(row, "Upcoming", { size = 10, color = C.gray600, size2 = UDim2.new(0, 80, 0, 16), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -92, 0, 21)
		end
	end
end
