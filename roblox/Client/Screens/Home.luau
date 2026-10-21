-- Home screen: lobby list, create/join. Mirrors src/pages/Home.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UiKit = require(script.Parent.Parent.UiKit)
local Common = require(script.Parent.Common)
local Config = require(ReplicatedStorage.F1Game.Shared.Config)
local Format = require(ReplicatedStorage.F1Game.Shared.Format)

local C = UiKit.C

local Home = {}

local function lobbyCard(parent, ctx, lobby, onOpen)
	local card = UiKit.inst("TextButton", {
		BackgroundColor3 = C.carbon850,
		BorderSizePixel = 0,
		Text = "",
		AutoButtonColor = false,
		Size = UDim2.new(1, 0, 0, 96),
	}, parent)
	UiKit.corner(card, 10)
	UiKit.stroke(card, C.carbon700, 1)
	UiKit.label(card, lobby.name, { font = UiKit.FONT_DISPLAY, size = 16, color = C.white, size2 = UDim2.new(1, -130, 0, 22) }).Position = UDim2.new(0, 14, 0, 12)
	local meta = string.format("%d/%d principals · %d races", #lobby.members, lobby.settings.maxPlayers, lobby.settings.seasonLength)
	UiKit.label(card, meta, { size = 12, color = C.gray400, size2 = UDim2.new(1, -140, 0, 18) }).Position = UDim2.new(0, 14, 0, 36)
	local code = UiKit.inst("TextLabel", {
		BackgroundColor3 = C.carbon900, Text = lobby.inviteCode, TextColor3 = C.raceTeal,
		TextSize = 11, Font = UiKit.FONT_MONO, BorderSizePixel = 0,
		AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -14, 0, 12), Size = UDim2.new(0, 84, 0, 22),
	}, card)
	UiKit.corner(code, 6)
	local hostLine = (lobby.hostUserId == (ctx.state.user and ctx.state.user.id)) and "You are host" or "Member"
	UiKit.label(card, hostLine .. " · created " .. Format.timeAgo(lobby.createdAt), { size = 11, color = C.gray500, size2 = UDim2.new(1, -28, 0, 16) }).Position = UDim2.new(0, 14, 0, 64)
	if lobby.paused then
		local b = UiKit.Badge(card, "PAUSED", "warn")
		b.Position = UDim2.new(0, 160, 0, 34)
	end
	if lobby.settings.isPublic then
		local b = UiKit.Badge(card, "PUBLIC", "info")
		b.Position = UDim2.new(0, 236, 0, 34)
	end
	card.MouseButton1Click:Connect(function()
		onOpen(lobby)
	end)
	return card
end

local function openCreateModal(ctx)
	local parent = ctx.screenGui
	local settings = Config.mergeLobbySettings({})
	local name = "My F1 Career"
	local overlay = UiKit.modal(parent, { title = "Create a career lobby", size2 = UDim2.new(0, 520, 0, 620) })
	local nameBox = UiKit.textbox(overlay, { text = name })
	Common.segmented(overlay, { 2, 4, 6, 8, 10 }, settings.maxPlayers, function(v)
		settings.maxPlayers = v
	end, { label = "Max principals" })
	Common.segmented(overlay, { 6, 8, 12, 16, 21 }, settings.seasonLength, function(v)
		settings.seasonLength = v
	end, { label = "Season length" })
	Common.segmented(overlay, { "beginner", "normal", "expert", "elite" }, settings.aiDifficulty, function(v)
		settings.aiDifficulty = v
	end, { label = "AI difficulty" })
	Common.segmented(overlay, { 25, 50, 100 }, settings.raceDistancePct, function(v)
		settings.raceDistancePct = v
	end, { label = "Race distance %" })
	Common.segmented(overlay, { 75000000, 100000000, 125000000, 150000000 }, settings.startingBudget, function(v)
		settings.startingBudget = v
	end, { label = "Starting budget" })
	Common.segmented(overlay, { "lenient", "realistic", "strict" }, settings.incidentSeverity, function(v)
		settings.incidentSeverity = v
	end, { label = "Incident severity" })
	Common.toggle(overlay, "Public lobby", settings.isPublic, function(v)
		settings.isPublic = v
	end)
	Common.toggle(overlay, "Allow mid-season joins", settings.allowMidSeasonJoin, function(v)
		settings.allowMidSeasonJoin = v
	end)
	local create = UiKit.button(overlay, "Create lobby", function()
		local finalName = nameBox.Text ~= "" and nameBox.Text or "My F1 Career"
		local lobby, err = ctx.state.createLobby(finalName, settings)
		if err then
			ctx.toast("error", err)
			return
		end
		overlay:Destroy()
		ctx.toast("success", "Career created")
		if ctx.reroute then
			ctx.reroute()
		end
	end, { variant = "primary", height = 38 })
	create.Size = UDim2.new(1, 0, 0, 38)
end

function Home.render(ctx, parent)
	local user = ctx.state.user
	local scroll = UiKit.inst("ScrollingFrame", {
		BackgroundColor3 = C.carbon950,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 1, 0),
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		ScrollBarImageColor3 = C.carbon600,
	}, parent)
	local content = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -48, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, scroll)
	content.Position = UDim2.new(0, 24, 0, 0)
	UiKit.list(content, { gap = 18 })
	UiKit.pad(content, 24, 0, 40, 0)

	local head = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 56) }, content)
	local mark = UiKit.inst("Frame", { BackgroundColor3 = C.raceRed, BorderSizePixel = 0, Size = UDim2.new(0, 44, 0, 44) }, head)
	UiKit.corner(mark, 10)
	mark.Position = UDim2.new(0, 0, 0.5, 0)
	mark.AnchorPoint = Vector2.new(0, 0.5)
	UiKit.label(mark, "F1", { font = UiKit.FONT_DISPLAY, size = 18, color = C.white, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
	UiKit.label(head, "F1 TEAM PRINCIPAL ONLINE", { font = UiKit.FONT_DISPLAY, size = 20, color = C.white, size2 = UDim2.new(1, -260, 0, 24) }).Position = UDim2.new(0, 60, 0, 8)
	UiKit.label(head, "Signed in as " .. (user and user.username or ""), { size = 13, color = C.gray400, size2 = UDim2.new(1, -260, 0, 18) }).Position = UDim2.new(0, 60, 0, 32)
	local refresh = UiKit.button(head, "Refresh", function()
		if ctx.reroute then
			ctx.reroute()
		end
	end, { variant = "ghost", width = 100, height = 32 })
	refresh.Position = UDim2.new(1, -100, 0.5, 0)
	refresh.AnchorPoint = Vector2.new(1, 0.5)

	local mine, err = ctx.state.listMyLobbies()
	if err then
		UiKit.label(content, err, { size = 12, color = C.raceRed, size2 = UDim2.new(1, 0, 0, 18) })
	end

	local headingRow = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 34) }, content)
	UiKit.label(headingRow, string.upper("Your careers"), { font = UiKit.FONT_DISPLAY, size = 18, color = C.white, size2 = UDim2.new(1, -180, 1, 0) })
	local createBtn = UiKit.button(headingRow, "+ Create career", function()
		openCreateModal(ctx)
	end, { variant = "primary", width = 150, height = 32 })
	createBtn.Position = UDim2.new(1, -150, 0.5, 0)
	createBtn.AnchorPoint = Vector2.new(1, 0.5)

	if #mine == 0 then
		UiKit.Empty(content, { title = "No careers yet", hint = "Create a lobby and invite friends with a code." })
	else
		local list = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, content)
		UiKit.list(list, { gap = 10 })
		for _, lobby in ipairs(mine) do
			lobbyCard(list, ctx, lobby, function(l)
				ctx.state.openLobby(l.id)
			end)
		end
	end

	local joinPanel = UiKit.inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, content)
	UiKit.corner(joinPanel, 10)
	UiKit.stroke(joinPanel, C.carbon700, 1)
	UiKit.list(joinPanel, { gap = 8 })
	UiKit.pad(joinPanel, 16)
	UiKit.label(joinPanel, "Join with a code", { font = UiKit.FONT_DISPLAY, size = 15, color = C.white, size2 = UDim2.new(1, 0, 0, 22) })
	local joinRow = UiKit.hrow(joinPanel, 36, 8)
	local codeBox = UiKit.textbox(joinRow, { placeholder = "ABC12345", size2 = UDim2.new(1, -110, 1, 0) })
	codeBox.TextSize = 16
	local joinBtn = UiKit.button(joinRow, "Join", function()
		local code = string.upper(string.gsub(codeBox.Text, "%s", ""))
		if #code < 4 then
			ctx.toast("error", "Enter an invitation code.")
			return
		end
		local lobby, jerr = ctx.state.joinLobby(code)
		if jerr then
			ctx.toast("error", jerr)
		else
			ctx.toast("success", "Joined the lobby")
		end
	end, { variant = "primary", width = 100, height = 36 })
	joinBtn.Size = UDim2.new(0, 100, 1, 0)
	UiKit.label(joinPanel, "Ask the host for the invite code shown on their lobby screen.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })

	local publicList = ctx.state.listPublicLobbies()
	if #publicList > 0 then
		UiKit.label(content, string.upper("Public lobbies"), { font = UiKit.FONT_DISPLAY, size = 16, color = C.white, size2 = UDim2.new(1, 0, 0, 24) })
		for _, lobby in ipairs(publicList) do
			local row = UiKit.inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 56) }, content)
			UiKit.corner(row, 8)
			UiKit.stroke(row, C.carbon700, 1)
			UiKit.label(row, lobby.name, { font = Enum.Font.GothamBold, size = 14, color = C.gray300, size2 = UDim2.new(1, -120, 0, 18) }).Position = UDim2.new(0, 12, 0, 10)
			UiKit.label(row, string.format("%d/%d principals · %s AI · %d races", #lobby.members, lobby.settings.maxPlayers, lobby.settings.aiDifficulty, lobby.settings.seasonLength), {
				size = 11, color = C.gray500, size2 = UDim2.new(1, -120, 0, 16),
			}).Position = UDim2.new(0, 12, 0, 30)
			local jb = UiKit.button(row, "Join", function()
				local l, jerr = ctx.state.joinLobby(lobby.inviteCode)
				if jerr then
					ctx.toast("error", jerr)
				end
			end, { variant = "ghost", width = 80, height = 32 })
			jb.Position = UDim2.new(1, -92, 0.5, 0)
			jb.AnchorPoint = Vector2.new(1, 0.5)
		end
	end

	local how = UiKit.inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, content)
	UiKit.corner(how, 10)
	UiKit.stroke(how, C.carbon700, 1)
	UiKit.list(how, { gap = 4 })
	UiKit.pad(how, 16)
	UiKit.label(how, "How it works", { font = UiKit.FONT_DISPLAY, size = 15, color = C.white, size2 = UDim2.new(1, 0, 0, 22) })
	for _, line in ipairs({
		"1. Create or join a lobby.",
		"2. Build your team in the wizard.",
		"3. Hire drivers and develop the car.",
		"4. Ready up, then the host runs the race.",
		"5. Progress through persistent seasons.",
	}) do
		UiKit.label(how, line, { size = 13, color = C.gray400, size2 = UDim2.new(1, 0, 0, 18) })
	end
end

return Home
