local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local function onlineCount(members)
	local n = 0
	for _, m in ipairs(members) do
		if m.online then n = n + 1 end
	end
	return n
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local user = ctx.state.user
	local lobby = ctx.state.lobby
	local isHost = ctx.state.isHost
	if not bundle or not user or not lobby then return end

	local circuit = Common.circuit(bundle.weekend.circuitId)
	local required = {}
	for _, m in ipairs(lobby.members) do
		if m.online then table.insert(required, m) end
	end
	local readyIds = {}
	for _, id in ipairs(bundle.weekend.readyUserIds or {}) do readyIds[id] = true end
	local readyCount = 0
	for _, m in ipairs(required) do
		if readyIds[m.userId] then readyCount = readyCount + 1 end
	end
	local iAmReady = readyIds[user.id] == true
	local me = nil
	for _, m in ipairs(lobby.members) do
		if m.userId == user.id then me = m end
	end

	local head = Common.sectionHeading(parent, lobby.name, string.format("%d/%d principals · %s AI · %d race season", #lobby.members, lobby.settings.maxPlayers, tostring(lobby.settings.aiDifficulty), lobby.settings.seasonLength))

	local actionRow = UiKit.hrow(parent, 32, 8)
	UiKit.Badge(actionRow, lobby.paused and "Career paused" or "Career live", lobby.paused and "warn" or "good")
	UiKit.button(actionRow, "Open dashboard", function()
		ctx.navigate("dashboard")
	end, { variant = "subtle", width = 130, height = 30, textSize = 11 })
	UiKit.button(actionRow, "Leave lobby", function()
		State.leaveLobby()
	end, { variant = "danger", width = 110, height = 30, textSize = 11 })

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -372, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 360, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(1, -360, 0, 0)

	-- Next Grand Prix ---------------------------------------------------------
	local nextBody = UiKit.Panel(left, {
		title = "Next Grand Prix",
		right = circuit and UiKit.Badge(nil, string.format("Round %d / %d", bundle.weekend.raceIndex + 1, #bundle.season.calendar), "info") or nil,
	})
	if circuit then
		local row = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 96) }, nextBody)
		UiKit.label(row, circuit.name, { font = UiKit.FONT_DISPLAY, size = 18, color = C.white, size2 = UDim2.new(1, -120, 0, 26) })
		UiKit.label(row, string.format("%s, %s · %.3f km · %d corners", circuit.location, circuit.country, circuit.lengthKm, circuit.corners), { size = 12, color = C.gray400, size2 = UDim2.new(1, -120, 0, 20) }).Position = UDim2.new(0, 0, 0, 28)
		local chips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -120, 0, 24) }, row)
		chips.Position = UDim2.new(0, 0, 0, 54)
		UiKit.list(chips, { dir = Enum.FillDirection.Horizontal, gap = 6 })
		Common.chip(chips, "Weather: " .. bundle.weekend.weather.condition)
		Common.chip(chips, string.format("Track %d°C", math.floor(bundle.weekend.weather.trackTempC + 0.5)))
		Common.chip(chips, "Session: " .. bundle.weekend.session)
		UiKit.label(row, "READY TO RACE", { size = 9, color = C.gray500, size2 = UDim2.new(0, 120, 0, 14), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -120, 0, 4)
		UiKit.label(row, string.format("%d/%d", readyCount, #required), { font = UiKit.FONT_MONO, size = 26, color = C.raceTeal, size2 = UDim2.new(0, 120, 0, 32), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -120, 0, 18)
		UiKit.button(row, "Race weekend", function()
			ctx.navigate("race")
		end, { variant = "primary", width = 112, height = 26, textSize = 10 }).Position = UDim2.new(1, -112, 0, 60)
	end

	-- Principals -------------------------------------------------------------
	local principalsBody = UiKit.Panel(left, {
		title = "Principals",
		right = UiKit.label(nil, "Online status updates automatically", { size = 10, color = C.gray500 }),
	})
	for _, m in ipairs(lobby.members) do
		local team = m.teamId and Career.findTeam(bundle, m.teamId) or nil
		local row = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 52) }, principalsBody)
		UiKit.corner(row, 8)
		UiKit.stroke(row, C.carbon700, 1)

		local status = inst("Frame", { BackgroundColor3 = m.online and C.raceGreen or C.gray600, BorderSizePixel = 0, Size = UDim2.new(0, 6, 0, 6) }, row)
		UiKit.corner(status, 3)
		status.Position = UDim2.new(0, 8, 0.5, -3)

		if team then
			Common.teamBadge(row, team, 30).Position = UDim2.new(0, 22, 0.5, -15)
		else
			local tbd = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 30, 0, 30) }, row)
			tbd.Position = UDim2.new(0, 22, 0.5, -15)
			UiKit.corner(tbd, 6)
			UiKit.stroke(tbd, C.carbon600, 1)
			UiKit.label(tbd, "TBD", { size = 8, color = C.gray500, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
		end

		local name = m.username .. (m.userId == user.id and " (you)" or "")
		UiKit.label(row, name, { font = Enum.Font.GothamBold, size = 13, color = C.gray100, size2 = UDim2.new(1, -330, 0, 16) }).Position = UDim2.new(0, 60, 0, 8)
		if m.isHost then
			UiKit.Badge(row, "HOST", "warn").Position = UDim2.new(0, 60 + math.min(180, #name * 7), 0, 9)
		end
		UiKit.label(row, team and team.name or "Team not created yet", { size = 10, color = C.gray500, size2 = UDim2.new(1, -330, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 60, 0, 27)
		if team then
			UiKit.label(row, Format.money(team.budget, true) .. " budget", { size = 10, color = C.gray500, size2 = UDim2.new(0, 120, 1, 0), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -254, 0, 0)
		end
		local badge = UiKit.Badge(row, readyIds[m.userId] and "✓ Ready" or "Not ready", readyIds[m.userId] and "good" or "default")
		badge.AnchorPoint = Vector2.new(1, 0.5)
		badge.Position = UDim2.new(1, isHost and m.userId ~= user.id and -62 or -8, 0.5, 0)

		if isHost and m.userId ~= user.id then
			UiKit.button(row, "Host", function()
				local _, err = State.transferHost(m.userId)
				ctx.toast(err and "error" or "success", err or "Host privileges transferred")
			end, { variant = "subtle", width = 48, height = 24, textSize = 9 }).Position = UDim2.new(1, -8, 0.5, -12)
			UiKit.button(row, "Kick", function()
				local _, err = State.removeMember(m.userId)
				ctx.toast(err and "error" or "success", err or "Member removed")
			end, { variant = "danger", width = 48, height = 24, textSize = 9 }).Position = UDim2.new(1, -8, 0.5, 12)
		end
	end

	local ctrlRow = UiKit.hrow(principalsBody, 32, 8)
	UiKit.button(ctrlRow, iAmReady and "Cancel ready" or "I'm ready", function()
		local _, err = State.setReady(not iAmReady)
		ctx.toast(err and "error" or "success", err or (iAmReady and "Readiness withdrawn" or "You are ready"))
	end, { variant = iAmReady and "subtle" or "primary", width = 120, height = 30, textSize = 11 })
	if isHost then
		UiKit.button(ctrlRow, lobby.paused and "Resume" or "Pause", function()
			local _, err = State.setPaused(not lobby.paused)
			ctx.toast(err and "error" or "success", err or (lobby.paused and "Career resumed" or "Career paused"))
		end, { variant = "subtle", width = 96, height = 30, textSize = 11 })
		UiKit.button(ctrlRow, "Go to race weekend", function()
			ctx.navigate("race")
		end, { variant = "subtle", width = 150, height = 30, textSize = 11 })
	end

	-- Invite -----------------------------------------------------------------
	local inviteBody = UiKit.Panel(left, {
		title = "Invite friends",
		right = UiKit.label(nil, "Share the code", { size = 10, color = C.gray500 }),
	})
	local inviteRow = UiKit.hrow(inviteBody, 42, 8)
	local code = UiKit.textbox(inviteRow, { text = lobby.inviteCode, size2 = UDim2.new(0, 160, 1, 0), textSize = 20, x = Enum.TextXAlignment.Center })
	code.Font = Enum.Font.Code
	code.TextColor3 = C.raceTeal
	UiKit.button(inviteRow, "Copy code", function()
		code:CaptureFocus()
		code.CursorPosition = #code.Text + 1
		ctx.toast("success", "Code selected — press Ctrl+C to copy")
	end, { variant = "subtle", width = 110, height = 34, textSize = 11 })
	UiKit.label(inviteBody, "Players can join from Home with this code. The host can hand over or remove principals at any time.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })

	-- Chat -------------------------------------------------------------------
	local chatBody = UiKit.Panel(right, {
		title = "Lobby chat",
		right = UiKit.label(nil, string.format("%d messages", #ctx.state.chat), { size = 10, color = C.gray500 }),
	})
	local scroll = inst("ScrollingFrame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 240),
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = C.carbon600,
		ScrollingDirection = Enum.ScrollingDirection.Y,
	}, chatBody)
	local chatList = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, scroll)
	UiKit.list(chatList, { gap = 6 })

	if #ctx.state.chat == 0 then
		UiKit.label(chatList, "No messages yet. Say hello.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 18) })
	else
		for _, msg in ipairs(ctx.state.chat) do
			local mine = msg.userId == user.id
			local bodyText = msg.body or ""
			local lines = math.max(1, math.ceil(#bodyText / 30))
			local h = 16 + lines * 14
			local bubble = inst("Frame", {
				BackgroundColor3 = mine and Color3.fromRGB(0, 90, 82) or C.carbon800,
				BackgroundTransparency = mine and 0.55 or 0,
				BorderSizePixel = 0,
				Size = UDim2.new(0.84, 0, 0, h),
			}, chatList)
			UiKit.corner(bubble, 8)
			local inner = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, 0) }, bubble)
			UiKit.list(inner, { gap = 2, pad = 8 })
			local meta = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 12) }, inner)
			UiKit.label(meta, msg.username or "?", { font = Enum.Font.GothamBold, size = 9, color = C.gray300, size2 = UDim2.new(1, -60, 1, 0), truncate = Enum.TextTruncate.AtEnd })
			UiKit.label(meta, Format.timeAgo(msg.createdAt or 0), { size = 8, color = C.gray500, size2 = UDim2.new(0, 60, 1, 0), x = Enum.TextXAlignment.Right })
			UiKit.label(inner, bodyText, { size = 11, color = C.gray100, size2 = UDim2.new(1, 0, 0, lines * 14), wrap = true, y = Enum.TextYAlignment.Top })
		end
	end

	local inputRow = UiKit.hrow(chatBody, 34, 6)
	local input = UiKit.textbox(inputRow, { placeholder = "Message the lobby…", size2 = UDim2.new(1, -54, 1, 0), textSize = 12 })
	input.ClearTextOnFocus = true
	local sendBtn = UiKit.button(inputRow, "Send", function() end, { variant = "primary", width = 48, height = 32, textSize = 10 })
	local function submit()
		local body = string.gsub(input.Text, "^%s+", "")
		body = string.gsub(body, "%s+$", "")
		if body == "" then return end
		input.Text = ""
		local _, err = State.sendChat(string.sub(body, 1, 500))
		if err then ctx.toast("error", err) end
	end
	sendBtn.MouseButton1Click:Connect(submit)
	input.FocusLost:Connect(function(enterPressed)
		if enterPressed then submit() end
	end)

	task.defer(function()
		if scroll.Parent then
			scroll.CanvasPosition = Vector2.new(0, math.max(0, chatList.AbsoluteSize.Y - scroll.AbsoluteSize.Y))
		end
	end)

	-- Settings ---------------------------------------------------------------
	local settingsBody = UiKit.Panel(right, { title = "Career settings" })
	local settings = {
		{ "AI difficulty", tostring(lobby.settings.aiDifficulty) },
		{ "Season length", string.format("%d races", lobby.settings.seasonLength) },
		{ "Race distance", string.format("%d%%", lobby.settings.raceDistancePct) },
		{ "Starting budget", Format.money(lobby.settings.startingBudget, true) },
		{ "Incidents", tostring(lobby.settings.incidentSeverity) },
		{ "Mid-season joins", lobby.settings.allowMidSeasonJoin and "Allowed" or "Closed" },
		{ "Visibility", lobby.settings.isPublic and "Public" or "Private" },
		{ "Approval", lobby.settings.requireApproval and "Host approval" or "Open" },
	}
	for i = 1, #settings, 2 do
		local row = UiKit.hrow(settingsBody, 42, 6)
		for j = 0, 1 do
			local pair = settings[i + j]
			if pair then
				local cell = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(0.5, -3, 1, 0) }, row)
				UiKit.corner(cell, 6)
				UiKit.label(cell, string.upper(pair[1]), { size = 8, color = C.gray500, size2 = UDim2.new(1, -12, 0, 12) }).Position = UDim2.new(0, 6, 0, 4)
				UiKit.label(cell, pair[2], { font = Enum.Font.GothamBold, size = 11, color = C.gray200, size2 = UDim2.new(1, -12, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 6, 0, 18)
			end
		end
	end

	local connBody = UiKit.Panel(right, { title = "Connection" })
	UiKit.label(connBody, me and me.online and "You are online. Your progress is saved automatically after every action." or "You appear offline.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 30), wrap = true, y = Enum.TextYAlignment.Top })
end
