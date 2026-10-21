local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local nameDraft, shortDraft, styleDraft = nil, nil, nil

local NUMBER_STYLES = { "classic", "italic", "block", "outline" }

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local lobby = ctx.state.lobby
	local user = ctx.state.user
	if not bundle or not lobby or not user then return end
	local team = Career.findTeam(bundle, ctx.state.myTeamId)

	local currentName = nameDraft or (team and team.name) or ""
	local currentShort = shortDraft or (team and team.shortName) or ""
	local currentStyle = styleDraft or (team and team.numberStyle) or "classic"

	Common.sectionHeading(parent, "Settings", "Account, team identity and career configuration.")

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(0.5, 6, 0, 0)

	local accBody = UiKit.Panel(left, { title = "Account" })
	local accountRows = {
		{ "Username", user.username },
		{ "User ID", tostring(user.id) },
		{ "Backend", "Roblox DataStore (online)" },
		{ "Lobby", lobby.name },
		{ "Invite code", lobby.inviteCode },
	}
	for _, pair in ipairs(accountRows) do
		local r = UiKit.hrow(accBody, 22, 8)
		UiKit.label(r, pair[1], { size = 11, color = C.gray500, size2 = UDim2.new(0.4, 0, 1, 0) })
		UiKit.label(r, tostring(pair[2]), { size = 11, color = C.gray200, size2 = UDim2.new(0.6, 0, 1, 0), x = Enum.TextXAlignment.Right, truncate = Enum.TextTruncate.AtEnd })
	end
	local actions = UiKit.hrow(accBody, 32, 8)
	UiKit.button(actions, "Leave lobby", function()
		State.leaveLobby()
		ctx.toast("success", "Left the lobby")
		ctx.shell.rebuild()
	end, { variant = "subtle", width = 110, height = 30, textSize = 11 }).TextColor3 = C.raceRed
	if not ctx.state.isHost then
		UiKit.label(accBody, "Only the host can remove members or transfer host.", { size = 9, color = C.gray600, size2 = UDim2.new(1, 0, 0, 14) })
	end

	local idBody = UiKit.Panel(left, { title = "Team identity" })
	if not team then
		UiKit.label(idBody, "No team created yet.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
	else
		UiKit.label(idBody, "TEAM NAME", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		local nameBox = UiKit.textbox(idBody, { text = currentName, size2 = UDim2.new(1, 0, 0, 30), textSize = 12 })
		nameBox:GetPropertyChangedSignal("Text"):Connect(function()
			nameDraft = nameBox.Text
		end)
		UiKit.label(idBody, "SHORT NAME", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		local shortBox = UiKit.textbox(idBody, { text = currentShort, size2 = UDim2.new(1, 0, 0, 30), textSize = 12 })
		shortBox:GetPropertyChangedSignal("Text"):Connect(function()
			shortDraft = shortBox.Text
		end)
		UiKit.label(idBody, "NUMBER STYLE", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		Common.segmented(idBody, NUMBER_STYLES, currentStyle, function(v)
			styleDraft = v
			ctx.shell.rebuild()
		end, { perRow = 4 })

		local saveRow = UiKit.hrow(idBody, 32, 8)
		UiKit.label(saveRow, "Abbreviation, nationality and engine are fixed for the season.", { size = 9, color = C.gray500, size2 = UDim2.new(1, -90, 1, 0), truncate = Enum.TextTruncate.AtEnd })
		local saveBtn = UiKit.button(saveRow, "Save", function()
			local trimmed = currentName:gsub("^%s+", ""):gsub("%s+$", "")
			for _, t in ipairs(bundle.teams) do
				if t.id ~= team.id and t.name:lower() == trimmed:lower() then
					ctx.toast("error", "Another team already uses that name.")
					return
				end
			end
			UiKit.enable(saveBtn, false)
			local _, err = State.applyAction({
				type = "update-team",
				teamId = team.id,
				patch = {
					name = trimmed,
					shortName = currentShort:gsub("^%s+", ""):gsub("%s+$", ""),
					numberStyle = currentStyle,
				},
			})
			if err then
				UiKit.enable(saveBtn, true)
				ctx.toast("error", err)
				return
			end
			nameDraft, shortDraft, styleDraft = nil, nil, nil
			ctx.toast("success", "Team identity updated")
			ctx.shell.rebuild()
		end, { variant = "primary", width = 74, height = 30, textSize = 11 })
		saveBtn.AnchorPoint = Vector2.new(1, 0.5)
		saveBtn.Position = UDim2.new(1, 0, 0.5, 0)
	end

	local cfgBody = UiKit.Panel(right, { title = "Career configuration" })
	local cfg = {
		{ "AI difficulty", bundle.settings.aiDifficulty },
		{ "Season length", string.format("%d races", bundle.settings.seasonLength) },
		{ "Race distance", string.format("%d%%", bundle.settings.raceDistancePct) },
		{ "Incident severity", bundle.settings.incidentSeverity },
		{ "Starting season", tostring(bundle.settings.startingSeason) },
		{ "Simulation speed", string.format("%s/10", tostring(bundle.settings.simSpeed)) },
		{ "Max principals", tostring(lobby.settings.maxPlayers) },
		{ "Visibility", lobby.settings.isPublic and "Public" or "Private" },
	}
	local cfgGrid = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 132) }, cfgBody)
	UiKit.grid(cfgGrid, UDim2.new(0.5, -4, 0, 62), 8)
	for _, pair in ipairs(cfg) do
		local cell = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, BorderSizePixel = 0, Size = UDim2.new(1, 0, 1, 0) }, cfgGrid)
		UiKit.corner(cell, 6)
		UiKit.label(cell, string.upper(pair[1]), { size = 8, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) }).Position = UDim2.new(0, 8, 0, 8)
		UiKit.label(cell, tostring(pair[2]), { size = 11, font = Enum.Font.GothamBold, color = C.gray200, size2 = UDim2.new(1, -16, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 8, 0, 26)
	end
	UiKit.label(cfgBody, "Career settings are locked once the lobby exists so every principal competes under the same rules.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })

	local invBody = UiKit.Panel(right, { title = "Invitation" })
	local code = inst("TextLabel", {
		BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.2, Text = lobby.inviteCode,
		TextColor3 = C.raceTeal, TextSize = 16, Font = UiKit.FONT_MONO, BorderSizePixel = 0,
		Size = UDim2.new(0, 200, 0, 38),
	}, invBody)
	UiKit.corner(code, 8)
	UiKit.stroke(code, C.carbon600, 1)
	local copyBtn = UiKit.button(invBody, "Copy", function()
		if setclipboard then
			setclipboard(lobby.inviteCode)
			ctx.toast("success", "Code copied")
		else
			ctx.toast("info", lobby.inviteCode)
		end
	end, { variant = "subtle", width = 70, height = 30, textSize = 11 })
	copyBtn.AnchorPoint = Vector2.new(1, 0)
	copyBtn.Position = UDim2.new(1, 0, 0, 0)

	local lic = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 128) }, right)
	UiKit.corner(lic, 10)
	UiKit.stroke(lic, C.carbon700, 1)
	UiKit.pad(lic, 12)
	UiKit.label(lic, "DATA, LICENSING & ASSUMPTIONS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	UiKit.label(lic, "Circuit names, locations, lap lengths and corner counts are drawn from widely published sports data. Track outlines trace the real layouts using the open-source f1-circuits GeoJSON set (MIT licence); the car artwork is an original illustration. AI teams use real constructor names to identify competitors but no official logos or liveries. The default driver roster is fictional; any real person's name is flagged in data and only used where a season roster permits. Sponsor brands are fictional.", {
		size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 92), wrap = true, y = Enum.TextYAlignment.Top,
	})
end
