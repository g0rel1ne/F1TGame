local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local TrackMap = require(script.Parent.Parent.TrackMap)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Car = require(RS.Shared.Engine.Car)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local COMPOUND_COLOR = { soft = Color3.fromRGB(248, 113, 113), medium = Color3.fromRGB(251, 191, 36), hard = Color3.fromRGB(229, 231, 235), intermediate = Color3.fromRGB(52, 211, 153), wet = Color3.fromRGB(56, 189, 248) }
local FLAG_COLOR = { green = "#34d399", yellow = "#fbbf24", ["safety-car"] = "#fbbf24", ["virtual-safety-car"] = "#fbbf24", ["red-flag"] = "#f87171", chequered = "#e5e7eb" }
local SEVERITY_TONE = { "default", "info", "warn", "bad", "bad" }

local replayPos, replayPlaying, replaySpeed = 0, false, 4
local generation = 0

local function setupSummary(setup)
	local detailed = Car.hasDetailedSetup(setup)
	local axes = detailed and Car.deriveAxes(setup.frontWing, setup.rearWing) or { downforce = setup.downforce, balance = setup.balance }
	local balWord = axes.balance < 0 and "oversteer" or (axes.balance > 0 and "understeer" or "neutral")
	if not detailed then
		return {
			{ "Downforce", string.format("%d / 5", setup.downforce) },
			{ "Balance", string.format("%+d (%s)", setup.balance, balWord) },
		}
	end
	return {
		{ "Front wing", string.format("%d / 10", setup.frontWing) },
		{ "Rear wing", string.format("%d / 10", setup.rearWing) },
		{ "Aero load", string.format("%d / 5", axes.downforce) },
		{ "Aero balance", balWord },
		{ "Ride height", string.format("%d / 10", setup.rideHeight) },
		{ "Brake bias", string.format("%d%% front", setup.brakeBias) },
	}
end

local function baseReplaySeconds(referenceLapSeconds)
	return math.min(9, math.max(4, referenceLapSeconds / 13))
end

local function kvBox(parent, label, value, width)
	local cell = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, BorderSizePixel = 0, Size = UDim2.new(width, 0, 0, 38) }, parent)
	UiKit.corner(cell, 6)
	UiKit.label(cell, string.upper(label), { size = 8, color = C.gray500, size2 = UDim2.new(1, -12, 0, 12) }).Position = UDim2.new(0, 6, 0, 4)
	UiKit.label(cell, tostring(value), { font = UiKit.FONT_MONO, size = 11, color = C.gray200, size2 = UDim2.new(1, -12, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 6, 0, 16)
	return cell
end

local function checklistItem(parent, done, label)
	local row = UiKit.hrow(parent, 18, 6)
	local dot = inst("Frame", { BackgroundColor3 = done and C.raceGreen or C.carbon700, BackgroundTransparency = done and 0.75 or 0, BorderSizePixel = 0, Size = UDim2.new(0, 14, 0, 14) }, row)
	UiKit.corner(dot, 7)
	UiKit.label(dot, done and "✓" or "", { size = 9, color = C.raceGreen, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
	UiKit.label(row, label, { size = 10, color = done and C.gray300 or C.gray500, size2 = UDim2.new(1, -20, 1, 0) })
end

local function liveStat(card, label, value, color)
	local r = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 14) }, card)
	UiKit.label(r, label, { size = 9, color = C.gray500, size2 = UDim2.new(0.55, 0, 1, 0) })
	UiKit.label(r, value, { size = 9, color = color or C.gray200, size2 = UDim2.new(0.45, 0, 1, 0), x = Enum.TextXAlignment.Right, truncate = Enum.TextTruncate.AtEnd })
end

local function renderLive(left, right, ctx, bundle, live, circuit, myTeamId, isHost)
	local snap = live.snapshot or { lap = 0, totalLaps = 0, flag = "green", cars = {} }
	local cars = snap.cars or {}
	local view = {}
	for _, c in ipairs(cars) do
		view[c.driverId] = c
	end
	local myIds = {}
	if myTeamId then
		for _, d in ipairs(Career.teamDrivers(bundle, myTeamId)) do
			myIds[d.id] = true
		end
	end

	local flag = snap.flag or "green"
	local flagTone = "good"
	if flag == "red-flag" then
		flagTone = "bad"
	elseif flag == "yellow" or flag == "safety-car" or flag == "virtual-safety-car" then
		flagTone = "warn"
	elseif flag == "chequered" then
		flagTone = "default"
	end
	local body = UiKit.Panel(left, {
		title = "Live race",
		right = UiKit.Badge(nil, string.upper((flag):gsub("%-", " ")), flagTone),
	})
	local head = UiKit.hrow(body, 20, 10)
	UiKit.label(head, string.format("Lap %d / %d", snap.lap or 0, snap.totalLaps or 0), {
		font = UiKit.FONT_DISPLAY,
		size = 13,
		color = C.white,
		size2 = UDim2.new(0.5, 0, 1, 0),
	})
	UiKit.label(head, live.paused and "PAUSED" or "LIVE", {
		font = UiKit.FONT_DISPLAY,
		size = 11,
		color = live.paused and C.raceAmber or C.raceGreen,
		size2 = UDim2.new(0.5, 0, 1, 0),
		x = Enum.TextXAlignment.Right,
	})

	local mapFrame = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(1, 0, 0, 250) }, body)
	UiKit.corner(mapFrame, 8)
	UiKit.pad(mapFrame, 6)
	local markers = {}
	for _, c in ipairs(cars) do
		local team = Career.findTeam(bundle, c.teamId)
		markers[#markers + 1] = {
			progress = c.trackProgress or 0,
			color = team and team.colors and Common.hexcolor(team.colors.primary, C.gray400) or C.gray400,
			highlight = myIds[c.driverId] and true or false,
			label = ((c.position or 99) <= 3 or myIds[c.driverId]) and tostring(c.position) or nil,
		}
	end
	TrackMap.render(mapFrame, circuit, { size2 = UDim2.new(1, 0, 1, 0), markers = markers })

	local board = UiKit.Panel(left, { title = "Running order", right = UiKit.Badge(nil, string.format("%d cars", #cars), "default") })
	local _, row = UiKit.Table(board, {
		columns = { "Pos", "Driver", "Team", "Gap", "Tyre", "Age", "Pace", "Pits" },
		widths = { 0.06, 0.34, 0.16, 0.14, 0.08, 0.07, 0.09, 0.06 },
		rowHeight = 24,
	})
	for i, c in ipairs(cars) do
		local d = Career.findDriver(bundle, c.driverId)
		local t = Career.findTeam(bundle, c.teamId)
		local gap = c.position == 1 and "LEADER" or Format.gap(c.gapToLeader or 0)
		local tyre = c.retired and "OUT" or string.upper(string.sub(c.compound or "?", 1, 1))
		local pace = string.upper(string.sub(c.pace or "normal", 1, 1))
		local name = (myIds[c.driverId] and "» " or "") .. (d and d.name or c.driverId)
		row({
			tostring(c.position),
			name,
			t and t.shortName or "",
			gap,
			tyre,
			tostring(c.tireAge or 0),
			pace,
			tostring(c.pits or 0),
		}, false, i)
	end

	-- Radio ---------------------------------------------------------------
	local radio = UiKit.Panel(right, { title = "Team radio", right = UiKit.Badge(nil, myTeamId and "CONTROL" or "SPECTATOR", myTeamId and "good" or "default") })
	if myTeamId then
		local paceOptions = { { "conserve", "Conserve" }, { "normal", "Normal" }, { "push", "Push" } }
		for _, d in ipairs(Career.teamDrivers(bundle, myTeamId)) do
			local c = view[d.id]
			local card = inst("Frame", {
				BackgroundColor3 = C.carbon900,
				BackgroundTransparency = 0.55,
				BorderSizePixel = 0,
				Size = UDim2.new(1, 0, 0, 0),
				AutomaticSize = Enum.AutomaticSize.Y,
			}, radio)
			UiKit.corner(card, 8)
			UiKit.stroke(card, C.carbon700, 1)
			UiKit.list(card, { gap = 4, pad = 8 })

			local titleRow = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18) }, card)
			UiKit.label(titleRow, d.name, { font = Enum.Font.GothamBold, size = 11, color = C.gray100, size2 = UDim2.new(1, -110, 1, 0), truncate = Enum.TextTruncate.AtEnd })
			if c then
				local compound = c.retired and "OUT" or string.format("%s · %d laps", string.upper(c.compound or "?"), c.tireAge or 0)
				local badge = UiKit.Badge(titleRow, compound, c.retired and "bad" or "default")
				badge.AnchorPoint = Vector2.new(1, 0.5)
				badge.Position = UDim2.new(1, -4, 0.5, 0)
			end

			local paceRow = UiKit.hrow(card, 26, 6)
			for _, opt in ipairs(paceOptions) do
				local active = c and c.pace == opt[1]
				UiKit.button(paceRow, opt[2], function()
					if not c or c.retired then
						return
					end
					local _, err = ctx.state.liveCommand(d.id, { pace = opt[1] })
					if err then
						ctx.toast("error", err)
					end
				end, { variant = active and "primary" or "subtle", width = 100, height = 24, textSize = 9 })
			end

			local pitRow = UiKit.hrow(card, 26, 6)
			UiKit.button(pitRow, c and c.pitRequest and "Cancel box" or "Box this lap", function()
				if not c or c.retired then
					return
				end
				local _, err = ctx.state.liveCommand(d.id, { pitRequest = not c.pitRequest })
				if err then
					ctx.toast("error", err)
				end
			end, { variant = c and c.pitRequest and "primary" or "subtle", width = 130, height = 24, textSize = 9 })
			for _, compound in ipairs({ "soft", "medium", "hard" }) do
				UiKit.button(pitRow, string.upper(string.sub(compound, 1, 1)), function()
					local _, err = ctx.state.liveCommand(d.id, { pitCompound = compound, pitRequest = true })
					if err then
						ctx.toast("error", err)
					end
				end, { variant = c and c.pitCompound == compound and "primary" or "subtle", width = 42, height = 24, textSize = 9 })
			end
		end
	else
		UiKit.label(radio, "Sign a driver to take control of a car in this race.", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 22), wrap = true })
	end

	-- Feed ----------------------------------------------------------------
	local events = live.events or {}
	local feed = UiKit.Panel(right, { title = "Race feed", right = UiKit.Badge(nil, string.format("%d events", #events), "info") })
	if #events == 0 then
		UiKit.label(feed, "Waiting for the first lap…", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 18) })
	else
		local first = math.max(1, #events - 7)
		for i = #events, first, -1 do
			local ev = events[i]
			local r = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 26) }, feed)
			UiKit.corner(r, 6)
			local badge = UiKit.Badge(r, "L" .. tostring(ev.lap), "default")
			badge.Position = UDim2.new(0, 4, 0, 4)
			UiKit.label(r, ev.text or "", {
				size = 9,
				color = Common.hexcolor(ev.color, C.gray200),
				size2 = UDim2.new(1, -56, 1, 0),
				truncate = Enum.TextTruncate.AtEnd,
			}).Position = UDim2.new(0, 50, 0, 0)
		end
	end

	-- Controls --------------------------------------------------------------
	if isHost then
		local control = UiKit.Panel(right, { title = "Race control" })
		local row1 = UiKit.hrow(control, 30, 6)
		UiKit.button(row1, live.paused and "Resume" or "Pause", function()
			local _, err = ctx.state.livePause(not live.paused)
			if err then
				ctx.toast("error", err)
			end
		end, { variant = "primary", width = 96, height = 28, textSize = 10 })
		UiKit.button(row1, "Skip to end", function()
			local _, err = ctx.state.liveSkip()
			if err then
				ctx.toast("error", err)
			else
				ctx.toast("success", "Race complete — results recorded")
			end
		end, { variant = "subtle", width = 106, height = 28, textSize = 10 })
		UiKit.button(row1, "Abort", function()
			local _, err = ctx.state.liveAbort()
			if err then
				ctx.toast("error", err)
			else
				ctx.toast("info", "Live race aborted")
			end
		end, { variant = "danger", width = 80, height = 28, textSize = 10 })
		local row2 = UiKit.hrow(control, 28, 6)
		for _, speed in ipairs({ 1, 2, 4 }) do
			UiKit.button(row2, tostring(speed) .. "×", function()
				local _, err = ctx.state.liveSpeed(speed)
				if err then
					ctx.toast("error", err)
				end
			end, { variant = live.speed == speed and "primary" or "subtle", width = 60, height = 26, textSize = 10 })
		end
		UiKit.label(control, "The server runs the race so every principal sees the same laps. Radio commands only affect your own cars.", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 24), wrap = true })
	else
		local note = UiKit.Panel(right, { title = "Live race" })
		UiKit.label(note, "The host is running the race. Use team radio to manage your drivers.", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 24), wrap = true })
	end
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local user = ctx.state.user
	local lobby = ctx.state.lobby
	local myTeamId = ctx.state.myTeamId
	local isHost = ctx.state.isHost
	if not bundle or not user or not lobby then return end
	generation = generation + 1
	local myGen = generation
	if not ctx.state.live then
		task.spawn(function()
			State.liveState()
		end)
	end

	local circuit = Common.circuit(bundle.weekend.circuitId)
	local result = nil
	if bundle.weekend.resultId then
		for _, r in ipairs(bundle.results) do
			if r.id == bundle.weekend.resultId then result = r end
		end
	end
	local savedSetup = myTeamId and bundle.setups[myTeamId] and bundle.setups[myTeamId].setup or nil
	local currentSetup = myTeamId and (savedSetup or { downforce = 3, balance = 0 }) or nil
	local setupError = currentSetup and Car.setupPenalty(currentSetup, circuit) or 0
	local readyIds = {}
	for _, id in ipairs(bundle.weekend.readyUserIds or {}) do readyIds[id] = true end
	local online = {}
	for _, m in ipairs(lobby.members) do
		if m.online then table.insert(online, m) end
	end
	local readyCount = 0
	for _, m in ipairs(online) do
		if readyIds[m.userId] then readyCount = readyCount + 1 end
	end
	local iAmReady = readyIds[user.id]
	local myDrivers = Career.teamDrivers(bundle, myTeamId or "")
	local balance = myTeamId and Career.balanceOf(bundle, myTeamId) or 0
	local practiceResults = {}
	for i = math.max(1, #bundle.practice - 5), #bundle.practice do
		table.insert(practiceResults, 1, bundle.practice[i])
	end
	local practiceDone = #bundle.practice > 0
	local weather = bundle.weekend.weather
	local wet = weather.trackWetness or 0

	Common.sectionHeading(parent, "Race Weekend", string.format("%s · Round %d of %d · %d%% distance", circuit.name, bundle.weekend.raceIndex + 1, #bundle.season.calendar, bundle.settings.raceDistancePct))

	local stats = UiKit.hrow(parent, 78, 10)
	local raceLaps = math.max(5, math.floor(circuit.laps * bundle.settings.raceDistancePct / 100 + 0.5))
	local s1 = UiKit.Stat(stats, { label = "Circuit length", value = string.format("%.3f km", circuit.lengthKm), hint = string.format("%d corners · %d race laps", circuit.corners, raceLaps) })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Track conditions", value = string.format("%d°C", math.floor(weather.trackTempC + 0.5)), hint = string.format("%s · %d%% wet", weather.condition, math.floor(wet * 100 + 0.5)) })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Ready", value = string.format("%d/%d", readyCount, #online), hint = "Online principals", accent = (readyCount == #online and #online > 0) and C.raceGreen or nil })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Budget", value = Format.money(balance, true), hint = "Repairs are deducted after the race" })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	cols.ClipsDescendants = false
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -392, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 380, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(1, -380, 0, 0)

	local live = ctx.state.live
	if live then
		renderLive(left, right, ctx, bundle, live, circuit, myTeamId, isHost)
	elseif result then
		-- Replay -------------------------------------------------------------
		local replayBody = UiKit.Panel(left, { title = "Race replay" })
		local laps = result.laps or {}

		local mapHolder = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(1, 0, 0, 236) }, replayBody)
		UiKit.corner(mapHolder, 8)
		UiKit.pad(mapHolder, 6)
		local trackMap = TrackMap.render(mapHolder, circuit, { size2 = UDim2.new(1, 0, 1, 0) })

		local infoRow = UiKit.hrow(replayBody, 18, 10)
		local flagDot = inst("Frame", { BackgroundColor3 = C.raceGreen, BorderSizePixel = 0, Size = UDim2.new(0, 8, 0, 8) }, infoRow)
		UiKit.corner(flagDot, 4)
		local flagLabel = UiKit.label(infoRow, "green", { size = 9, color = C.gray500, size2 = UDim2.new(0, 80, 1, 0) })
		local lapLabel = UiKit.label(infoRow, "", { size = 9, color = C.gray400, size2 = UDim2.new(0, 90, 1, 0) })
		local runningLabel = UiKit.label(infoRow, "", { size = 9, color = C.gray500, size2 = UDim2.new(0, 100, 1, 0) })
		local pctLabel = UiKit.label(infoRow, "", { size = 9, color = C.gray600, size2 = UDim2.new(1, -308, 1, 0), x = Enum.TextXAlignment.Right })

		local controls = UiKit.hrow(replayBody, 30, 6)
		local playBtn = UiKit.button(controls, "Play", function() end, { variant = "primary", width = 82, height = 28, textSize = 11 })
		playBtn.LayoutOrder = 1
		local endBtn = UiKit.button(controls, "End", function()
			replayPlaying = false
			replayPos = #laps
			ctx.shell.rebuild()
		end, { variant = "subtle", width = 54, height = 28, textSize = 11 })
		endBtn.LayoutOrder = 2
		local startBtn = UiKit.button(controls, "Start", function()
			replayPlaying = false
			replayPos = 0
			ctx.shell.rebuild()
		end, { variant = "subtle", width = 54, height = 28, textSize = 11 })
		startBtn.LayoutOrder = 3
		local speedNames = { "1×", "2×", "4×", "8×", "16×" }
		local speedVals = { 1, 2, 4, 8, 16 }
		local currentSpeedName = "4×"
		for i = 1, 5 do
			if speedVals[i] == replaySpeed then currentSpeedName = speedNames[i] end
		end
		local speedRow = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 32) }, replayBody)
		Common.segmented(speedRow, speedNames, currentSpeedName, function(v)
			for i = 1, 5 do
				if speedNames[i] == v then replaySpeed = speedVals[i] end
			end
			replayPlaying = false
			ctx.shell.rebuild()
		end, { perRow = 5 })

		local scrub = inst("Frame", { BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 8) }, replayBody)
		UiKit.corner(scrub, 4)
		local scrubFill = inst("Frame", { BackgroundColor3 = C.raceTeal, BorderSizePixel = 0, Size = UDim2.new(0, 0, 1, 0), Name = "Fill" }, scrub)
		UiKit.corner(scrubFill, 4)
		local scrubBtn = inst("TextButton", { BackgroundTransparency = 1, Text = "", Size = UDim2.new(1, 0, 0, 20), Position = UDim2.new(0, 0, 0.5, -10) }, scrub)
		scrubBtn.MouseButton1Click:Connect(function()
			local mouse = game:GetService("UserInputService"):GetMouseLocation()
			local rel = math.clamp((mouse.X - scrub.AbsolutePosition.X) / math.max(1, scrub.AbsoluteSize.X), 0, 1)
			replayPlaying = false
			replayPos = rel * #laps
			ctx.shell.rebuild()
		end)

		local boardHolder = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 176) }, replayBody)
		local lapSeconds = baseReplaySeconds(circuit.referenceLapSeconds or 90)

		local function frameAt(p)
			local idx = math.clamp(math.floor(p) + 1, 1, math.max(1, #laps))
			return laps[idx], math.clamp(p - math.floor(p), 0, 1), idx
		end

		local function drawAt(p)
			if not mapHolder.Parent or myGen ~= generation then return end
			local lap, frac, idx = frameAt(p)
			if not lap then return end
			lapLabel.Text = string.format("Lap %d / %d", math.min(#laps, idx), #laps)
			local flag = lap.entries[1] and lap.entries[1].flag or "green"
			flagDot.BackgroundColor3 = Common.hexcolor(FLAG_COLOR[flag], C.gray500)
			flagLabel.Text = (flag:gsub("%-", " "))
			local running = 0
			for _, e in ipairs(lap.entries) do
				if not e.retired then running = running + 1 end
			end
			runningLabel.Text = string.format("%d cars running", running)
			pctLabel.Text = string.format("%d%% lap", math.floor(frac * 100 + 0.5))
			scrubFill.Size = UDim2.new(math.clamp(p / math.max(1, #laps), 0, 1), 0, 1, 0)

			local markers = {}
			local leaderLap = lap.entries[1] and lap.entries[1].lapTime or 90
			for _, e in ipairs(lap.entries) do
				if not e.retired then
					local d = Career.findDriver(bundle, e.driverId)
					local t = d and Career.findTeam(bundle, d.teamId) or nil
					local gapFraction = leaderLap > 0 and (e.gapToLeader / leaderLap) % 1 or 0
					local progress = (((frac - gapFraction) % 1) + 1) % 1
					table.insert(markers, {
						id = e.driverId,
						progress = progress,
						color = t and t.colors.primary or "#888888",
						highlight = e.position == 1,
					})
				end
			end
			TrackMap.update(trackMap, { markers = markers })

			for _, ch in ipairs(boardHolder:GetChildren()) do
				if ch:IsA("Frame") then ch:Destroy() end
			end
			local entries = {}
			for _, e in ipairs(lap.entries) do table.insert(entries, e) end
			table.sort(entries, function(a, b) return a.position < b.position end)
			for i = 1, math.min(8, #entries) do
				local e = entries[i]
				local d = Career.findDriver(bundle, e.driverId)
				local t = d and Career.findTeam(bundle, d.teamId) or nil
				local row = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 20) }, boardHolder)
				row.Position = UDim2.new(0, 0, 0, (i - 1) * 21)
				UiKit.label(row, tostring(e.position), { font = UiKit.FONT_MONO, size = 9, color = C.gray500, size2 = UDim2.new(0, 16, 1, 0), x = Enum.TextXAlignment.Right })
				local dot = inst("Frame", { BackgroundColor3 = Common.hexcolor(t and t.colors.primary or nil, C.gray600), BorderSizePixel = 0, Size = UDim2.new(0, 3, 0, 10) }, row)
				dot.Position = UDim2.new(0, 20, 0.5, -5)
				UiKit.label(row, d and d.name or e.driverId, { size = 10, color = e.retired and C.gray600 or C.gray200, size2 = UDim2.new(1, -130, 1, 0), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 28, 0, 0)
				local cdot = inst("Frame", { BackgroundColor3 = COMPOUND_COLOR[e.compound] or C.gray500, BorderSizePixel = 0, Size = UDim2.new(0, 7, 0, 7) }, row)
				UiKit.corner(cdot, 4)
				cdot.AnchorPoint = Vector2.new(1, 0.5)
				cdot.Position = UDim2.new(1, -62, 0.5, 0)
				local status = e.pit and "PIT" or (e.retired and "OUT" or (e.gapToLeader < 0.001 and "LEADER" or string.format("+%.1f", e.gapToLeader)))
				UiKit.label(row, status, { font = UiKit.FONT_MONO, size = 9, color = C.gray500, size2 = UDim2.new(0, 54, 1, 0), x = Enum.TextXAlignment.Right })
			end
		end

		replayPos = math.clamp(replayPos, 0, #laps)
		drawAt(replayPos)

		local function startLoop()
			local last = os.clock()
			task.spawn(function()
				while replayPlaying and myGen == generation and mapHolder.Parent do
					local now = os.clock()
					local dt = math.min(0.25, now - last)
					last = now
					replayPos = replayPos + (dt * replaySpeed) / lapSeconds
					if replayPos >= #laps then
						replayPos = #laps
						replayPlaying = false
						playBtn.Text = "Replay"
						drawAt(replayPos)
						break
					end
					drawAt(replayPos)
					task.wait(0.15)
				end
				if replayPlaying and (myGen ~= generation or not mapHolder.Parent) then
					replayPlaying = false
				end
			end)
		end

		playBtn.Text = replayPlaying and "Pause" or (replayPos >= #laps and "Replay" or "Play")
		playBtn.MouseButton1Click:Connect(function()
			if replayPos >= #laps then replayPos = 0 end
			replayPlaying = not replayPlaying
			playBtn.Text = replayPlaying and "Pause" or "Play"
			if replayPlaying then
				startLoop()
			end
		end)
		if replayPlaying then
			startLoop()
		end

		-- Classification ------------------------------------------------------
		local classBody = UiKit.Panel(left, { title = "Race classification", right = UiKit.Badge(nil, result.weatherStart or "", "info") })
		local wrap, buildRow = UiKit.Table(classBody, {
			columns = { "Pos", "Driver", "Team", "Grid", "Laps", "Time / Gap", "Best lap", "Pits", "Pts" },
			widths = { 0.05, 0.3, 0.13, 0.06, 0.06, 0.16, 0.1, 0.06, 0.05 },
			rowHeight = 26,
		})
		for i, c in ipairs(result.classification) do
			local d = Career.findDriver(bundle, c.driverId)
			local t = Career.findTeam(bundle, c.teamId)
			local timeText
			if c.status == "finished" then
				timeText = c.position == 1 and Format.lapTime(c.timeSeconds) or tostring(c.gap or "")
			else
				timeText = string.upper(c.status)
			end
			buildRow({
				c.status == "finished" and tostring(c.position) or "—",
				(d and d.name or c.driverId) .. (c.fastestLap and " FL" or ""),
				t and t.shortName or "",
				tostring(c.gridPosition),
				tostring(c.laps),
				timeText,
				Format.lapTime(c.bestLap),
				tostring(c.pits),
				tostring(c.points),
			}, false, i)
		end

		-- Qualifying ----------------------------------------------------------
		if result.qualifying and #result.qualifying > 0 then
			local qBody = UiKit.Panel(left, { title = "Qualifying", right = UiKit.Badge(nil, "Q1 · Q2 · Q3", "info") })
			local qwrap, qrow = UiKit.Table(qBody, {
				columns = { "Pos", "Driver", "Team", "Q1", "Q2", "Q3" },
				widths = { 0.07, 0.38, 0.19, 0.12, 0.12, 0.12 },
				rowHeight = 24,
			})
			for i, q in ipairs(result.qualifying) do
				local d = Career.findDriver(bundle, q.driverId)
				local t = Career.findTeam(bundle, q.teamId)
				qrow({ tostring(q.position), d and d.name or q.driverId, t and t.shortName or "", Format.lapTime(q.q1), Format.lapTime(q.q2), Format.lapTime(q.q3) }, false, i)
			end
		end

		-- Incidents -----------------------------------------------------------
		local incidents = result.incidents or {}
		local incBody = UiKit.Panel(left, { title = "Race control & incidents", right = UiKit.Badge(nil, string.format("%d logged", #incidents), #incidents > 0 and "warn" or "good") })
		if #incidents == 0 then
			UiKit.Empty(incBody, { title = "A clean race", hint = "No incidents were reported by race control." })
		else
			for _, inc in ipairs(incidents) do
				local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, incBody)
				UiKit.corner(card, 8)
				UiKit.stroke(card, C.carbon700, 1)
				UiKit.list(card, { gap = 3, pad = 8 })
				local head = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18) }, card)
				UiKit.Badge(head, "Lap " .. tostring(inc.lap), SEVERITY_TONE[inc.severity] or "default").LayoutOrder = 1
				UiKit.label(head, (inc.kind:gsub("%-", " ")), { size = 10, font = Enum.Font.GothamBold, color = C.gray200, size2 = UDim2.new(0, 120, 1, 0) }).Position = UDim2.new(0, 60, 0, 0)
				UiKit.label(head, inc.corner or "", { size = 9, color = C.gray500, size2 = UDim2.new(0, 120, 1, 0) }).Position = UDim2.new(0, 180, 0, 0)
				UiKit.label(card, inc.narrative or "", { size = 10, color = C.gray400, size2 = UDim2.new(1, 0, 0, 30), wrap = true, y = Enum.TextYAlignment.Top })
				local names = {}
				for _, id in ipairs(inc.involvedDriverIds or {}) do
					local d = Career.findDriver(bundle, id)
					table.insert(names, d and d.name or id)
				end
				UiKit.label(card, string.format("Involved: %s · Responsibility: %s", table.concat(names, ", "), (inc.responsibility or ""):gsub("%-", " ")), { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14), truncate = Enum.TextTruncate.AtEnd })
			end
		end
	else
		-- Circuit -------------------------------------------------------------
		local circBody = UiKit.Panel(left, { title = "Circuit", right = UiKit.label(nil, "Accurate circuit layout", { size = 11, color = C.gray500 }) })
		local circRow = UiKit.hrow(circBody, 250, 12)
		local mapFrame = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(0.55, -6, 1, 0) }, circRow)
		UiKit.corner(mapFrame, 8)
		UiKit.pad(mapFrame, 6)
		TrackMap.render(mapFrame, circuit, { height = 238 })
		local infoCol = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.45, -6, 1, 0) }, circRow)
		UiKit.list(infoCol, { gap = 5 })
		kvBox(infoCol, "Location", string.format("%s, %s", circuit.location, circuit.country), 1)
		kvBox(infoCol, "Overtaking", string.format("%d/100 · DRS %d zones", math.floor(circuit.overtaking * 100 + 0.5), #circuit.drsZones), 1)
		kvBox(infoCol, "Tyre wear", string.format("%d/100 · pit loss %.1fs", math.floor(circuit.tyreWear * 100 + 0.5), circuit.pitLossSeconds), 1)
		kvBox(infoCol, "Rain chance", string.format("%d%%", math.floor(circuit.rainChance * 100 + 0.5)), 1)
		UiKit.label(infoCol, circuit.blurb or "", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 44), wrap = true, y = Enum.TextYAlignment.Top })

		-- Setup ---------------------------------------------------------------
		local setupBody = UiKit.Panel(left, { title = "Car setup" })
		if not currentSetup then
			UiKit.Empty(setupBody, { title = "No team", hint = "Create your team to run practice and race." })
		else
			local split = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, setupBody)
			local leftCol = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.55, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, split)
			UiKit.list(leftCol, { gap = 4 })
			local summary = setupSummary(currentSetup)
			for i = 1, #summary, 2 do
				local row = UiKit.hrow(leftCol, 38, 6)
				kvBox(row, summary[i][1], summary[i][2], 0.5)
				if summary[i + 1] then kvBox(row, summary[i + 1][1], summary[i + 1][2], 0.5) end
			end
			local btn = UiKit.button(leftCol, "Open Car Setup Studio", function()
				ctx.navigate("garage")
			end, { variant = "primary", width = 0, height = 30, textSize = 11 })
			btn.Size = UDim2.new(1, 0, 0, 30)
			UiKit.label(leftCol, "Tune wings, ride height, brake bias and differential. Practice feedback converges the ideal setup onto your car.", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })

			local noteCol = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(0.45, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, split)
			UiKit.corner(noteCol, 8)
			UiKit.list(noteCol, { gap = 4, pad = 10 })
			noteCol.Position = UDim2.new(0.55, 6, 0, 0)
			UiKit.label(noteCol, "Engineer notes", { size = 10, font = Enum.Font.GothamBold, color = C.gray300, size2 = UDim2.new(1, 0, 0, 14) })
			UiKit.label(noteCol, "Setup error costs lap time in every session, so refine it after each practice run.", { size = 9, color = C.gray400, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })
			for _, d in ipairs(myDrivers) do
				local r = UiKit.hrow(noteCol, 14, 5)
				local dot = inst("Frame", { BackgroundColor3 = C.raceTeal, BorderSizePixel = 0, Size = UDim2.new(0, 5, 0, 5) }, r)
				UiKit.corner(dot, 3)
				UiKit.label(r, string.format("%s — morale %d", d.name, math.floor(d.morale + 0.5)), { size = 9, color = C.gray400, size2 = UDim2.new(1, -12, 1, 0), truncate = Enum.TextTruncate.AtEnd })
			end
		end

		-- Practice ------------------------------------------------------------
		local practiceBody = UiKit.Panel(left, { title = "Practice", right = UiKit.Badge(nil, practiceDone and "Running" or "Not started", practiceDone and "good" or "default") })
		local fpRow = UiKit.hrow(practiceBody, 30, 6)
		for s = 1, 3 do
			local b = UiKit.button(fpRow, string.format("Run FP%d", s), function()
				UiKit.enable(b, false)
				local _, err = State.applyAction({ type = "run-practice", session = s })
				ctx.toast(err and "error" or "success", err or string.format("Practice %d complete", s))
				ctx.shell.rebuild()
			end, { variant = "subtle", width = 92, height = 28, textSize = 11 })
			b.LayoutOrder = s
			UiKit.enable(b, myTeamId ~= nil)
		end
		UiKit.label(practiceBody, "Any principal can run practice; results are shared.", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })

		if #practiceResults == 0 then
			UiKit.Empty(practiceBody, { title = "No practice data", hint = "Run a session to gather setup, tyre and reliability information." })
		else
			for pi = 1, math.min(2, #practiceResults) do
				local p = practiceResults[pi]
				local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, practiceBody)
				UiKit.corner(card, 8)
				UiKit.stroke(card, C.carbon700, 1)
				UiKit.list(card, { gap = 3, pad = 8 })
				local head = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 16) }, card)
				UiKit.label(head, string.format("Session %d", p.session), { size = 10, font = Enum.Font.GothamBold, color = C.gray200, size2 = UDim2.new(0, 80, 1, 0) })
				UiKit.label(head, string.format("Suggested setup: %d DF / %+d balance", p.suggestedSetup.downforce, p.suggestedSetup.balance), { size = 9, color = C.gray500, size2 = UDim2.new(1, -80, 1, 0), x = Enum.TextXAlignment.Right })

				local entries = {}
				for _, e in ipairs(p.entries) do table.insert(entries, e) end
				table.sort(entries, function(a, b) return a.bestLap < b.bestLap end)
				local ewrap, erow = UiKit.Table(card, {
					columns = { "Driver", "Best", "Long run", "Wear/lap", "Feedback" },
					widths = { 0.32, 0.16, 0.16, 0.13, 0.23 },
					rowHeight = 22,
				})
				for i = 1, math.min(8, #entries) do
					local e = entries[i]
					local d = Career.findDriver(bundle, e.driverId)
					erow({ d and d.name or e.driverId, Format.lapTime(e.bestLap), Format.lapTime(e.longRunPace), e.tireWearPerLap and string.format("%.3f", e.tireWearPerLap) or "—", e.setupHint or "" }, false, i)
				end
				local useBtn = UiKit.button(card, "Use suggested setup", function()
					UiKit.enable(useBtn, false)
					local _, err = State.applyAction({ type = "set-setup", teamId = myTeamId, setup = p.suggestedSetup })
					ctx.toast(err and "error" or "success", err or "Suggested setup applied")
					ctx.shell.rebuild()
				end, { variant = "subtle", width = 0, height = 26, textSize = 10 })
				useBtn.Size = UDim2.new(0, 150, 0, 26)
				useBtn.AnchorPoint = Vector2.new(1, 0)
				useBtn.Position = UDim2.new(1, 0, 0, 0)
			end
		end

		-- Readiness -----------------------------------------------------------
		local readyBody = UiKit.Panel(left, { title = "Readiness", right = UiKit.Badge(nil, string.format("%d/%d ready", readyCount, #online), (readyCount == #online and #online > 0) and "good" or "warn") })
		for _, m in ipairs(lobby.members) do
			local t = m.teamId and Career.findTeam(bundle, m.teamId) or nil
			local row = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, Size = UDim2.new(1, 0, 0, 34) }, readyBody)
			UiKit.corner(row, 6)
			if t then
				Common.teamBadge(row, t, 26).Position = UDim2.new(0, 4, 0, 4)
			end
			local suffix = m.userId == user.id and " (you)" or ""
			UiKit.label(row, m.username .. suffix, { size = 11, color = C.gray200, size2 = UDim2.new(1, -160, 1, 0) }).Position = UDim2.new(0, 36, 0, 0)
			if not m.online then
				UiKit.label(row, "offline", { size = 9, color = C.gray500, size2 = UDim2.new(0, 50, 1, 0) }).Position = UDim2.new(1, -150, 0, 0)
			end
			local badge = UiKit.Badge(row, readyIds[m.userId] and "Ready" or "Not ready", readyIds[m.userId] and "good" or "default")
			badge.AnchorPoint = Vector2.new(1, 0.5)
			badge.Position = UDim2.new(1, -8, 0.5, 0)
		end
		local actionRow = UiKit.hrow(readyBody, 32, 8)
		UiKit.button(actionRow, iAmReady and "Cancel ready" or "I'm ready", function()
			local _, err = State.setReady(not iAmReady)
			if err then ctx.toast("error", err) end
			ctx.shell.rebuild()
		end, { variant = iAmReady and "subtle" or "primary", width = 110, height = 30, textSize = 11 })
		if isHost then
			local goLive = UiKit.button(actionRow, "Go live", function()
				UiKit.enable(goLive, false)
				local res, err = State.startLive()
				if err then
					UiKit.enable(goLive, true)
					ctx.toast("error", err)
					return
				end
				if res and res.id then
					replayPos = 0
					replayPlaying = true
					ctx.toast("success", "Race complete — results recorded")
				else
					ctx.toast("success", "Live race started")
				end
				ctx.shell.rebuild()
			end, { variant = "primary", width = 90, height = 30, textSize = 11 })
			UiKit.enable(goLive, myTeamId ~= nil and readyCount >= #online)
			local sim = UiKit.button(actionRow, "Quick sim", function()
				UiKit.enable(sim, false)
				local _, err = State.startRace()
				ctx.toast(err and "error" or "success", err or "Race complete — results recorded")
				ctx.shell.rebuild()
			end, { variant = "subtle", width = 92, height = 30, textSize = 11 })
			UiKit.enable(sim, myTeamId ~= nil and readyCount >= #online)
		else
			UiKit.label(actionRow, "Only the host can start the race once everyone is ready.", { size = 9, color = C.gray500, size2 = UDim2.new(1, -120, 1, 0), truncate = Enum.TextTruncate.AtEnd })
		end
		UiKit.label(readyBody, string.format("Short on cash? Races cost repairs and travel — running at least two healthy drivers is strongly advised. Current balance: %s.", Format.money(balance, true)), { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })
	end

	-- Right column ------------------------------------------------------------
	local weatherBody = UiKit.Panel(right, { title = "Weather" })
	local wHead = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 44) }, weatherBody)
	local wIcon = inst("Frame", { BackgroundColor3 = C.carbon900, BorderSizePixel = 0, Size = UDim2.new(0, 44, 0, 44) }, wHead)
	UiKit.corner(wIcon, 8)
	UiKit.label(wIcon, "☁", { size = 20, color = C.raceTeal, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
	UiKit.label(wHead, (weather.condition:gsub("%-", " ")), { font = UiKit.FONT_DISPLAY, size = 15, color = C.white, size2 = UDim2.new(1, -54, 0, 20) }).Position = UDim2.new(0, 54, 0, 2)
	UiKit.label(wHead, string.format("Air %d°C · Track %d°C", math.floor(weather.airTempC + 0.5), math.floor(weather.trackTempC + 0.5)), { size = 9, color = C.gray400, size2 = UDim2.new(1, -54, 0, 14) }).Position = UDim2.new(0, 54, 0, 24)
	local wetHead = UiKit.hrow(weatherBody, 14, 0)
	UiKit.label(wetHead, "Track wetness", { size = 9, color = C.gray500, size2 = UDim2.new(0.7, 0, 1, 0) })
	UiKit.label(wetHead, string.format("%d%%", math.floor(wet * 100 + 0.5)), { font = UiKit.FONT_MONO, size = 9, color = C.gray400, size2 = UDim2.new(0.3, 0, 1, 0), x = Enum.TextXAlignment.Right })
	UiKit.Progress(weatherBody, { value = wet * 100, max = 100, color = C.raceBlue, size2 = UDim2.new(1, 0, 0, 6) })

	local checkBody = UiKit.Panel(right, { title = "Weekend checklist" })
	checklistItem(checkBody, myTeamId ~= nil, "Team created")
	checklistItem(checkBody, #myDrivers >= 2, string.format("Two drivers signed (%d/2)", #myDrivers))
	checklistItem(checkBody, practiceDone, "Practice completed")
	checklistItem(checkBody, savedSetup ~= nil, "Setup saved")
	checklistItem(checkBody, readyCount == #online and #online > 0, "All principals ready")
	checklistItem(checkBody, result ~= nil, "Race simulated")

	local summaryText
	if result then
		local summaryBody = UiKit.Panel(right, { title = "Race summary" })
		local rows = {
			{ "Winner", Career.driverName(bundle, result.classification[1] and result.classification[1].driverId or "") },
			{ "Pole", Career.driverName(bundle, result.poleDriverId or "") },
			{ "Fastest lap", Career.driverName(bundle, result.fastestLapDriverId or "") },
			{ "Safety cars", tostring(result.safetyCarDeployments or 0) },
			{ "VSCs", tostring(result.virtualSafetyCarPeriods or 0) },
			{ "Red flags", tostring(result.redFlags or 0) },
			{ "Incidents", tostring(#(result.incidents or {})) },
		}
		for _, pair in ipairs(rows) do
			local r = UiKit.hrow(summaryBody, 16, 4)
			UiKit.label(r, pair[1], { size = 9, color = C.gray500, size2 = UDim2.new(0.56, 0, 1, 0) })
			UiKit.label(r, pair[2], { size = 9, color = C.gray200, size2 = UDim2.new(0.44, 0, 1, 0), x = Enum.TextXAlignment.Right, truncate = Enum.TextTruncate.AtEnd })
		end
		UiKit.button(summaryBody, "Refresh data", function()
			State.refresh()
		end, { variant = "subtle", width = 0, height = 28, textSize = 10 }).Size = UDim2.new(1, 0, 0, 28)
		summaryText = nil
	elseif live then
		summaryText = "Live race in progress. The server advances one lap per beat and every principal sees the same running order. Radio your drivers from the right column — pace, tyre choice and box calls are applied on the next lap. The host can pause, change speed, skip or abort."
	else
		summaryText = "Go live to run the race in real time: radio your drivers to push, save tyres or box for fresh rubber, and watch it play out on the map. Every principal in the lobby joins the same race. Or use Quick sim for an instant deterministic result. Recorded results are processed exactly once to protect points and finances."
	end

	local note = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 110) }, right)
	UiKit.corner(note, 10)
	UiKit.stroke(note, C.carbon700, 1)
	UiKit.pad(note, 12)
	UiKit.label(note, "SIMULATION NOTE", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	UiKit.label(note, summaryText or "", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 78), wrap = true, y = Enum.TextYAlignment.Top })
end
