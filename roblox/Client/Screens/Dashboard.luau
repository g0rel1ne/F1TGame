-- Dashboard screen. Mirrors src/pages/Dashboard.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UiKit = require(script.Parent.Parent.UiKit)
local Common = require(script.Parent.Common)
local TrackMap = require(script.Parent.Parent.TrackMap)
local DataCircuits = require(ReplicatedStorage.F1Game.Shared.Data.Circuits)
local Career = require(ReplicatedStorage.F1Game.Shared.Career)
local Format = require(ReplicatedStorage.F1Game.Shared.Format)

local C = UiKit.C

local function findDriver(bundle, id)
	for _, d in ipairs(bundle.drivers) do
		if d.id == id then
			return d
		end
	end
	return nil
end

return function(ctx, parent)
	local st = ctx.state
	local bundle, myTeamId, user, lobby = st.bundle, st.myTeamId, st.user, st.lobby
	if not bundle or not user then
		return
	end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then
		UiKit.Empty(parent, { title = "No team yet", hint = "Create your team in the lobby wizard to start managing." })
		return
	end
	local circuit = DataCircuits.get(bundle.weekend.circuitId)
	local row = Career.constructorRow(bundle, myTeamId)
	local drivers = Career.teamDrivers(bundle, myTeamId)
	local lastResult = nil
	for _, r in ipairs(bundle.results) do
		if r.processed then
			lastResult = r
		end
	end
	local nextRaceIndex = bundle.season.currentRaceIndex
	local totalRounds = #bundle.season.calendar
	local offSeason = bundle.career.phase == "off-season"
	local weekendDone = bundle.weekend.resultId ~= nil
	local readyIds = {}
	for _, id in ipairs(bundle.weekend.readyUserIds or {}) do
		readyIds[id] = true
	end
	local ready = readyIds[user.id] == true
	local required = {}
	if lobby then
		for _, m in ipairs(lobby.members) do
			if m.online then
				required[#required + 1] = m
			end
		end
	end
	local readyCount = 0
	for _, m in ipairs(required) do
		if readyIds[m.userId] then
			readyCount = readyCount + 1
		end
	end

	local headRight = UiKit.inst("Frame", { BackgroundTransparency = 1, AutomaticSize = Enum.AutomaticSize.X, Size = UDim2.new(0, 0, 0, 28) })
	UiKit.list(headRight, { dir = Enum.FillDirection.Horizontal, gap = 8 })
	if weekendDone and not offSeason then
		UiKit.Badge(headRight, "WEEKEND COMPLETE", "good").LayoutOrder = 1
	end
	if offSeason then
		UiKit.Badge(headRight, "OFF-SEASON", "warn").LayoutOrder = 1
	end
	local raceCentre = UiKit.button(headRight, "Race centre", function()
		ctx.navigate("race")
	end, { variant = "ghost", width = 120, height = 28, textSize = 12 })
	raceCentre.LayoutOrder = 2

	UiKit.SectionHeading(parent, {
		title = offSeason and "Season complete" or (circuit and circuit.name or "Race weekend"),
		subtitle = string.format("%s · %s season · %s", team.name, Career.seasonLabel(bundle), offSeason and "Off-season" or string.format("Round %d of %d", nextRaceIndex + 1, totalRounds)),
		right = headRight,
	})

	local balance = Career.balanceOf(bundle, myTeamId)
	local stats = UiKit.hrow(parent, 82, 10)
	local s1 = UiKit.Stat(stats, { label = "Budget", value = Format.money(balance, { compact = true }), hint = balance < 0 and "In the red — seek funding" or "Available for development", accent = balance < 0 and Color3.fromHex("#f87171") or nil })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Constructors' position", value = row and Format.ordinal(row.position) or "—", hint = row and string.format("%d points · %d wins", row.points, row.wins) or "No points scored yet" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Objective", value = string.format("P%d or better", team.objective), hint = string.format("Reputation %d/100", math.floor(team.reputation + 0.5)) })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Ready to race", value = string.format("%d/%d", readyCount, #required), hint = ready and "You are ready" or "Tick ready before the host starts", accent = (readyCount == #required and #required > 0) and Color3.fromHex("#34d399") or nil })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 14)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -398, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 14 })
	local right = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 384, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 14 })

	-- Weekend ---------------------------------------------------------------
	local weekendRight = UiKit.Badge(nil, weekendDone and "RESULT RECORDED" or (bundle.weekend.weather.condition or "DRY"), weekendDone and "good" or "info")
	local panel = UiKit.Panel(left, { title = weekendDone and "Current weekend" or string.format("%s Grand Prix", circuit and circuit.location or ""), right = weekendRight })
	local split = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 318) }, panel)
	local mapCol = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.56, -7, 1, 0) }, split)
	local planCol = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.44, -7, 1, 0) }, split)
	planCol.Position = UDim2.new(0.56, 7, 0, 0)

	if circuit then
		TrackMap.render(mapCol, circuit, { height = 294 })
		local cap = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18) }, mapCol)
		cap.Position = UDim2.new(0, 0, 1, -18)
		UiKit.label(cap, "Accurate circuit layout", { size = 10, color = C.gray500, size2 = UDim2.new(0.5, 0, 1, 0) })
		UiKit.label(cap, string.format("%.3f km · %d corners", circuit.lengthKm, circuit.corners), { size = 10, color = C.gray500, size2 = UDim2.new(0.5, 0, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(0.5, 0, 0, 0)
	end

	UiKit.label(planCol, "WEEKEND PLAN", { font = UiKit.FONT_DISPLAY, size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
	local planGrid = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 108) }, planCol)
	planGrid.Position = UDim2.new(0, 0, 0, 24)
	UiKit.grid(planGrid, UDim2.new(0.5, -4, 0, 51), 8)
	local planPairs = {
		{ "Race laps", circuit and math.max(5, math.floor(circuit.laps * bundle.settings.raceDistancePct / 100 + 0.5)) or 0 },
		{ "Distance", string.format("%d%%", bundle.settings.raceDistancePct) },
		{ "Track temp", string.format("%d°C", math.floor((bundle.weekend.weather.trackTempC or 0) + 0.5)) },
		{ "Rain chance", circuit and string.format("%d%%", math.floor(circuit.rainChance * 100 + 0.5)) or "0%" },
	}
	for _, pair in ipairs(planPairs) do
		local box = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.3, BorderSizePixel = 0 }, planGrid)
		UiKit.corner(box, 8)
		UiKit.label(box, string.upper(pair[1]), { size = 10, color = C.gray500, size2 = UDim2.new(1, -16, 0, 14) }).Position = UDim2.new(0, 9, 0, 7)
		UiKit.label(box, tostring(pair[2]), { font = UiKit.FONT_MONO, size = 15, color = C.gray200, size2 = UDim2.new(1, -16, 0, 22) }).Position = UDim2.new(0, 9, 0, 22)
	end

	for i, d in ipairs(drivers) do
		local r = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.3, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 30) }, planCol)
		r.Position = UDim2.new(0, 0, 0, 142 + (i - 1) * 34)
		UiKit.corner(r, 7)
		UiKit.label(r, d.name, { font = Enum.Font.GothamBold, size = 12, color = C.gray200, size2 = UDim2.new(1, -92, 1, 0) }).Position = UDim2.new(0, 10, 0, 0)
		UiKit.label(r, string.format("MOR %d", math.floor(d.morale + 0.5)), { font = UiKit.FONT_MONO, size = 11, color = C.gray500, size2 = UDim2.new(0, 80, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -90, 0, 0)
	end
	if #drivers == 0 then
		UiKit.label(planCol, "No drivers signed. Visit the driver market.", { size = 12, color = C.raceAmber, size2 = UDim2.new(1, 0, 0, 30) }).Position = UDim2.new(0, 0, 0, 142)
	end
	UiKit.label(planCol, string.format("%d/%d principals ready · %s", readyCount, #required, ready and "you are ready" or "waiting on you"), { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) }).Position = UDim2.new(0, 0, 0, 224)
	local raceBtn = UiKit.button(planCol, weekendDone and "View race result" or "Race weekend", function()
		ctx.navigate("race")
	end, { variant = "primary", height = 42, textSize = 14 })
	raceBtn.Size = UDim2.new(1, 0, 0, 42)
	raceBtn.Position = UDim2.new(0, 0, 0, 252)

	-- Weekend complete / off-season ----------------------------------------
	if weekendDone and not offSeason then
		local p2 = UiKit.Panel(left, { title = "Weekend complete" })
		local line = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 38) }, p2)
		UiKit.label(line, st.isHost and "Advance the calendar when everyone is ready to continue." or "Waiting for the host to advance the calendar.", { size = 13, color = C.gray400, size2 = UDim2.new(1, -200, 1, 0) })
		if st.isHost then
			local b = UiKit.button(line, "Continue to next round", function()
				Common.run(ctx, { type = "advance-calendar" }, "Calendar advanced")
			end, { variant = "primary", width = 190, height = 34 })
			b.Position = UDim2.new(1, -190, 0.5, 0)
			b.AnchorPoint = Vector2.new(1, 0.5)
		end
	end

	if offSeason then
		local p3 = UiKit.Panel(left, { title = "Season review", right = UiKit.Badge(nil, "OFF-SEASON", "warn") })
		local champ = "—"
		for _, d in ipairs(bundle.drivers) do
			if d.id == bundle.season.championDriverId then
				champ = d.name
				break
			end
		end
		local cteam = Career.findTeam(bundle, bundle.season.championTeamId)
		local line = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 38) }, p3)
		UiKit.label(line, string.format("Champion: %s · Constructors: %s", champ, cteam and cteam.name or "—"), { size = 13, color = C.gray400, size2 = UDim2.new(1, -210, 1, 0) })
		if st.isHost then
			local b = UiKit.button(line, "Start next season", function()
				Common.run(ctx, { type = "start-next-season" }, "New season started")
			end, { variant = "primary", width = 180, height = 34 })
			b.Position = UDim2.new(1, -180, 0.5, 0)
			b.AnchorPoint = Vector2.new(1, 0.5)
		end
	end

	-- Latest result --------------------------------------------------------
	local lr = UiKit.Panel(left, {
		title = "Latest result",
		right = lastResult and UiKit.label(nil, string.format("ROUND %d", lastResult.raceIndex + 1), { size = 10, color = C.gray500 }) or nil,
	})
	if not lastResult then
		UiKit.Empty(lr, { title = "No races completed", hint = "Results appear here once the first race weekend is run." })
	else
		local c = DataCircuits.get(lastResult.circuitId)
		local meta = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 20) }, lr)
		UiKit.label(meta, string.format("%s · %s", c and c.name or lastResult.circuitId, os.date("%Y-%m-%d", math.floor((lastResult.createdAt or 0) / 1000))), { size = 12, color = C.gray400, size2 = UDim2.new(0.62, 0, 1, 0) })
		UiKit.label(meta, string.format("%d SC · %d VSC · %d incidents", lastResult.safetyCarDeployments or 0, lastResult.virtualSafetyCarPeriods or 0, #(lastResult.incidents or {})), { size = 11, color = C.gray500, size2 = UDim2.new(0.38, 0, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(0.62, 0, 0, 0)
		local wrap, addRow = UiKit.Table(lr, { columns = { "Pos", "Driver", "Team", "Time / Gap", "Pts" }, widths = { 0.08, 0.40, 0.22, 0.20, 0.10 }, rowHeight = 32 })
		for i = 1, math.min(6, #lastResult.classification) do
			local entry = lastResult.classification[i]
			local d = findDriver(bundle, entry.driverId)
			local t = Career.findTeam(bundle, entry.teamId)
			local timeText = entry.status == "finished" and (entry.position == 1 and Format.lapTime(entry.timeSeconds) or entry.gap) or string.upper(entry.status)
			local rowFrame = addRow({ entry.position, d and d.name or entry.driverId, t and t.shortName or "—", timeText, entry.points }, false, i)
			if entry.teamId == team.id then
				rowFrame.BackgroundColor3 = C.carbon800
				rowFrame.BackgroundTransparency = 0.55
			end
		end
	end

	-- Constructors ---------------------------------------------------------
	local cc = UiKit.Panel(right, {
		title = "Constructors' championship",
		right = UiKit.button(nil, "Full table", function()
			ctx.navigate("championship")
		end, { variant = "ghost", width = 84, height = 26, textSize = 11 }),
	})
	if #bundle.standings.constructors == 0 then
		UiKit.Empty(cc, { title = "No standings yet", hint = "Points are awarded after each race." })
	else
		local leader = math.max(1, bundle.standings.constructors[1] and bundle.standings.constructors[1].points or 1)
		for i = 1, math.min(8, #bundle.standings.constructors) do
			local r = bundle.standings.constructors[i]
			local t = Career.findTeam(bundle, r.teamId)
			if t then
				local isMe = r.teamId == team.id
				local line = UiKit.inst("Frame", { BackgroundColor3 = isMe and C.carbon800 or C.carbon900, BackgroundTransparency = isMe and 0.35 or 0.55, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 38) }, cc)
				UiKit.corner(line, 8)
				if isMe then
					UiKit.stroke(line, C.raceTeal, 1)
				end
				UiKit.label(line, tostring(r.position), { font = UiKit.FONT_MONO, size = 11, color = C.gray500, size2 = UDim2.new(0, 20, 1, 0), x = Enum.TextXAlignment.Center })
				Common.teamBadge(line, t, 22).Position = UDim2.new(0, 26, 0.5, -11)
				UiKit.label(line, t.shortName, { font = Enum.Font.GothamBold, size = 12, color = C.gray200, size2 = UDim2.new(1, -120, 1, 0) }).Position = UDim2.new(0, 56, 0, 0)
				UiKit.label(line, tostring(r.points), { font = UiKit.FONT_MONO, size = 12, color = C.gray200, size2 = UDim2.new(0, 44, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -52, 0, 0)
				local track = UiKit.inst("Frame", { BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(1, -68, 0, 3) }, line)
				track.Position = UDim2.new(0, 56, 1, -7)
				UiKit.corner(track, 2)
				local fill = UiKit.inst("Frame", { BackgroundColor3 = Common.hexcolor(t.colors and t.colors.primary, C.raceTeal), BorderSizePixel = 0, Size = UDim2.new(0, 0, 1, 0) }, track)
				UiKit.corner(fill, 2)
				UiKit.tween(fill, { Size = UDim2.new(math.clamp(r.points / leader, 0, 1), 0, 1, 0) }, 0.55, Enum.EasingStyle.Quint)
			end
		end
	end

	-- Drivers --------------------------------------------------------------
	local dc = UiKit.Panel(right, {
		title = "Drivers' championship",
		right = UiKit.button(nil, "Standings", function()
			ctx.navigate("championship")
		end, { variant = "ghost", width = 84, height = 26, textSize = 11 }),
	})
	if #bundle.standings.drivers == 0 then
		UiKit.Empty(dc, { title = "No standings yet" })
	else
		for i = 1, math.min(6, #bundle.standings.drivers) do
			local r = bundle.standings.drivers[i]
			local d = findDriver(bundle, r.driverId)
			local t = Career.findTeam(bundle, r.teamId)
			local line = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.55, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 28) }, dc)
			UiKit.corner(line, 6)
			UiKit.label(line, tostring(r.position), { font = UiKit.FONT_MONO, size = 11, color = C.gray500, size2 = UDim2.new(0, 22, 1, 0), x = Enum.TextXAlignment.Center })
			local sw = UiKit.inst("Frame", { BackgroundColor3 = Common.hexcolor(t and t.colors and t.colors.primary, C.gray500), BorderSizePixel = 0, Size = UDim2.new(0, 10, 0, 10) }, line)
			UiKit.corner(sw, 2)
			sw.Position = UDim2.new(0, 26, 0.5, -5)
			UiKit.label(line, d and d.name or r.driverId, { size = 12, color = C.gray200, size2 = UDim2.new(1, -96, 1, 0) }).Position = UDim2.new(0, 44, 0, 0)
			UiKit.label(line, tostring(r.points), { font = UiKit.FONT_MONO, size = 12, color = C.gray400, size2 = UDim2.new(0, 44, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -52, 0, 0)
		end
	end

	-- News -----------------------------------------------------------------
	local newsPanel = UiKit.Panel(right, { title = "Team news" })
	local news = {}
	for i = #bundle.news, 1, -1 do
		if #news >= 6 then
			break
		end
		news[#news + 1] = bundle.news[i]
	end
	if #news == 0 then
		UiKit.Empty(newsPanel, { title = "No news yet", hint = "Race reports and business updates appear here." })
	else
		for _, n in ipairs(news) do
			local rowFrame = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.45, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, newsPanel)
			UiKit.corner(rowFrame, 8)
			UiKit.list(rowFrame, { gap = 3 })
			UiKit.pad(rowFrame, 9)
			local top = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18) }, rowFrame)
			UiKit.label(top, n.title, { font = Enum.Font.GothamBold, size = 12, color = C.gray200, size2 = UDim2.new(1, -74, 1, 0), truncate = Enum.TextTruncate.AtEnd })
			UiKit.label(top, Format.timeAgo(n.createdAt), { size = 10, color = C.gray500, size2 = UDim2.new(0, 74, 1, 0), x = Enum.TextXAlignment.Right })
			UiKit.label(rowFrame, n.body, { size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, wrap = true })
		end
	end

	-- Quick actions --------------------------------------------------------
	local qa = UiKit.Panel(right, { title = "Quick actions" })
	local grid = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 124) }, qa)
	UiKit.grid(grid, UDim2.new(0.5, -4, 0, 36), 8)
	for _, item in ipairs({
		{ "Car Setup", "garage" }, { "Develop", "development" }, { "Drivers", "drivers" },
		{ "Finance", "finance" }, { "Standings", "championship" }, { "Race Weekend", "race" },
	}) do
		UiKit.button(grid, item[1], function()
			ctx.navigate(item[2])
		end, { variant = "ghost", height = 36, textSize = 12 })
	end
	UiKit.label(qa, string.format("Forecast: %s · %d%% wetness", bundle.weekend.weather.condition, math.floor((bundle.weekend.weather.trackWetness or 0) * 100 + 0.5)), { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
end
