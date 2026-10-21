-- Career shell: sidebar navigation + header + content router.
-- Mirrors src/components/AppShell.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UiKit = require(script.Parent.UiKit)
local State = require(script.Parent.State)
local Config = require(ReplicatedStorage.F1Game.Shared.Config)
local CareerLib = require(ReplicatedStorage.F1Game.Shared.Career)
local Format = require(ReplicatedStorage.F1Game.Shared.Format)

local C = Config.Colors

local Shell = {}
Shell.section = "dashboard"

local NAV = {
	{ key = "dashboard", label = "Dashboard" },
	{ key = "team", label = "My Team" },
	{ key = "drivers", label = "Drivers" },
	{ key = "garage", label = "Car Setup" },
	{ key = "development", label = "Car Development" },
	{ key = "staff", label = "Staff" },
	{ key = "facilities", label = "Facilities" },
	{ key = "finance", label = "Finance" },
	{ key = "sponsors", label = "Sponsors" },
	{ key = "race", label = "Race Weekend" },
	{ key = "championship", label = "Championship" },
	{ key = "calendar", label = "Calendar" },
	{ key = "statistics", label = "Statistics" },
	{ key = "history", label = "Career History" },
	{ key = "settings", label = "Settings" },
	{ key = "lobby", label = "Lobby" },
}

local screenFolder = script.Parent:FindFirstChild("Screens")
local moduleByKey = {
	dashboard = "Dashboard", team = "Team", drivers = "Drivers", garage = "Garage",
	development = "Development", staff = "Staff", facilities = "Facilities", finance = "Finance",
	sponsors = "Sponsors", race = "RaceWeekend", championship = "Championship", calendar = "Calendar",
	statistics = "Statistics", history = "History", settings = "Settings", lobby = "Lobby",
}

local screens = {}
local function screen(key)
	if screens[key] then
		return screens[key]
	end
	local name = moduleByKey[key]
	local mod = name and screenFolder and screenFolder:FindFirstChild(name)
	if not mod then
		return nil
	end
	local ok, fn = pcall(require, mod)
	if not ok then
		warn("[F1Game] screen failed: " .. tostring(name) .. " " .. tostring(fn))
		return nil
	end
	screens[key] = fn
	return fn
end

function Shell.navigate(key)
	if moduleByKey[key] == nil then
		key = "dashboard"
	end
	Shell.section = key
	Shell.rebuild()
end

local root
local ctx

local function teamColor(team, key, fallback)
	local col = team and team.colors and team.colors[key]
	if type(col) == "string" then
		local ok, c = pcall(Color3.fromHex, col:gsub("^#", "#"))
		if ok then
			return c
		end
	end
	return fallback
end
Shell.teamColor = teamColor

local rebuildGui
local lastSection

local function buildSidebar(parent)
	local side = UiKit.inst("Frame", {
		Name = "Sidebar",
		BackgroundColor3 = C.carbon950,
		BorderSizePixel = 0,
		Size = UDim2.new(0, 236, 1, 0),
	}, parent)
	local sideGradient = UiKit.inst("UIGradient", { Rotation = 115 }, side)
	sideGradient.Color = ColorSequence.new(Color3.fromRGB(13, 15, 20), Color3.fromRGB(8, 9, 12))
	UiKit.inst("Frame", { BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(0, 1, 1, 0) }, side)

	local logo = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 64) }, side)
	local mark = UiKit.inst("Frame", { BackgroundColor3 = C.raceRed, BorderSizePixel = 0, Size = UDim2.new(0, 36, 0, 36) }, logo)
	UiKit.corner(mark, 9)
	mark.Position = UDim2.new(0, 16, 0.5, 0)
	mark.AnchorPoint = Vector2.new(0, 0.5)
	UiKit.label(mark, "F1", { font = UiKit.FONT_DISPLAY, size = 16, color = C.white, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
	UiKit.label(logo, "TEAM PRINCIPAL", { font = UiKit.FONT_DISPLAY, size = 13, color = C.gray200, size2 = UDim2.new(0, 140, 0, 16) }).Position = UDim2.new(0, 62, 0, 19)
	local liveDot = UiKit.inst("Frame", { BackgroundColor3 = C.raceTeal, BorderSizePixel = 0, Size = UDim2.new(0, 5, 0, 5) }, logo)
	UiKit.corner(liveDot, 3)
	liveDot.Position = UDim2.new(0, 62, 0, 40)
	UiKit.label(logo, "ONLINE", { size = 10, color = C.raceTeal, size2 = UDim2.new(0, 140, 0, 12) }).Position = UDim2.new(0, 71, 0, 35)

	local team = State.bundle and CareerLib.findTeam(State.bundle, State.myTeamId)
	local cardWrap = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 82) }, side)
	cardWrap.Position = UDim2.new(0, 0, 0, 64)
	local card = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.1, BorderSizePixel = 0, Size = UDim2.new(1, -24, 0, 66) }, cardWrap)
	card.Position = UDim2.new(0, 12, 0, 8)
	UiKit.corner(card, 10)
	UiKit.stroke(card, C.carbon700, 1)
	local sw = UiKit.inst("Frame", { BackgroundColor3 = teamColor(team, "primary", C.raceRed), BorderSizePixel = 0, Size = UDim2.new(0, 34, 0, 34) }, card)
	UiKit.corner(sw, 7)
	sw.Position = UDim2.new(0, 10, 0, 10)
	UiKit.label(sw, team and (team.abbreviation or "") or "TBD", { font = UiKit.FONT_DISPLAY, size = 11, color = C.white, size2 = UDim2.new(1, 0, 1, 0), x = Enum.TextXAlignment.Center })
	UiKit.label(card, team and (team.shortName or team.name) or "No team yet", { font = Enum.Font.GothamBold, size = 13, color = C.gray200, size2 = UDim2.new(1, -58, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 52, 0, 10)
	UiKit.label(card, State.lobby and State.lobby.name or "", { size = 11, color = C.gray500, size2 = UDim2.new(1, -58, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 52, 0, 26)
	if State.bundle then
		UiKit.label(card, "Season " .. CareerLib.seasonLabel(State.bundle), { size = 10, color = C.gray500, size2 = UDim2.new(0, 100, 0, 14) }).Position = UDim2.new(0, 12, 0, 46)
		UiKit.label(card, string.format("Rd %d/%d", State.bundle.season.currentRaceIndex + 1, #State.bundle.season.calendar), {
			size = 10, color = C.gray500, size2 = UDim2.new(0, 100, 0, 14), x = Enum.TextXAlignment.Right,
		}).Position = UDim2.new(1, -112, 0, 46)
	end

	local nav = UiKit.inst("ScrollingFrame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 1, -146),
		Position = UDim2.new(0, 0, 0, 146),
		ScrollBarThickness = 4,
		ScrollBarImageColor3 = C.carbon600,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, side)
	UiKit.list(nav, { gap = 2 })
	UiKit.pad(nav, 0, 10, 10, 10)
	for i, item in ipairs(NAV) do
		local active = Shell.section == item.key
		local b = UiKit.inst("TextButton", {
			BackgroundColor3 = active and C.carbon800 or C.carbon900,
			BackgroundTransparency = active and 0 or 1,
			Text = item.label,
			TextColor3 = active and C.white or C.gray400,
			TextSize = 14,
			Font = active and Enum.Font.GothamBold or Enum.Font.TitilliumWeb,
			TextXAlignment = Enum.TextXAlignment.Left,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 0, 34),
			LayoutOrder = i,
			AutoButtonColor = false,
		}, nav)
		UiKit.corner(b, 8)
		UiKit.pad(b, 0, 12, 0, 12)
		if active then
			UiKit.inst("Frame", { BackgroundColor3 = C.raceTeal, BorderSizePixel = 0, Size = UDim2.new(0, 3, 0, 18) }, b).Position = UDim2.new(0, -12, 0.5, -9)
		end
		b.MouseEnter:Connect(function()
			if not active then
				UiKit.tween(b, { BackgroundTransparency = 0.45, TextColor3 = C.gray200 }, 0.12)
			end
		end)
		b.MouseLeave:Connect(function()
			if not active then
				UiKit.tween(b, { BackgroundTransparency = 1, TextColor3 = C.gray400 }, 0.16)
			end
		end)
		b.MouseButton1Click:Connect(function()
			Shell.navigate(item.key)
		end)
	end

	local foot = UiKit.inst("Frame", { BackgroundColor3 = C.carbon950, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 58) }, side)
	foot.Position = UDim2.new(0, 0, 1, -58)
	UiKit.inst("Frame", { BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 1) }, foot)
	UiKit.label(foot, State.user and State.user.username or "", { size = 12, color = C.gray500, size2 = UDim2.new(1, -90, 0, 16), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 14, 0, 14)
	local outBtn = UiKit.button(foot, "Sign out", function()
		State.leaveLobby()
	end, { variant = "subtle", width = 76, height = 28, radius = 6, textSize = 12 })
	outBtn.Position = UDim2.new(1, -88, 0, 15)
end

local function buildHeader(parent)
	local head = UiKit.inst("Frame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 56),
	}, parent)
	UiKit.inst("Frame", { BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 1) }, head).Position = UDim2.new(0, 0, 1, -1)
	local b = State.bundle
	local info = "Career"
	if b then
		local count = 0
		for _, d in ipairs(b.drivers) do
			if d.teamId then
				count = count + 1
			end
		end
		info = string.format("%d rounds · %d teams · %d drivers", #b.season.calendar, #b.teams, count)
	end
	UiKit.label(head, info, { size = 13, color = C.gray500, size2 = UDim2.new(1, -240, 1, 0) }).Position = UDim2.new(0, 22, 0, 0)

	local raceBtn = UiKit.button(head, "Race Weekend", function()
		Shell.navigate("race")
	end, { variant = "ghost", width = 140, height = 32, radius = 8, textSize = 13 })
	raceBtn.Position = UDim2.new(1, -158, 0.5, 0)
	raceBtn.AnchorPoint = Vector2.new(1, 0.5)

	if b and b.career.phase == "off-season" then
		local badge = UiKit.Badge(head, "OFF-SEASON", "warn")
		badge.AnchorPoint = Vector2.new(1, 0.5)
		badge.Position = UDim2.new(1, -308, 0.5, 0)
	end

	local bell = UiKit.button(head, "!", function()
		local news = {}
		if b then
			local n = #b.news
			local i = n
			while i >= 1 and #news < 12 do
				news[#news + 1] = b.news[i]
				i = i - 1
			end
		end
		local body = UiKit.modal(Shell.screenGui, { title = "Notifications", size2 = UDim2.new(0, 460, 0, 480) })
		if #news == 0 then
			UiKit.Empty(body, { title = "No notifications yet." })
		end
		for _, n in ipairs(news) do
			local row = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, body)
			UiKit.corner(row, 8)
			UiKit.list(row, { gap = 3 })
			UiKit.pad(row, 10)
			local top = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 18) }, row)
			UiKit.label(top, n.title, { font = Enum.Font.GothamBold, size = 13, color = C.gray200, size2 = UDim2.new(1, -70, 1, 0) })
			UiKit.label(top, Format.timeAgo(n.createdAt), { size = 10, color = C.gray500, size2 = UDim2.new(0, 70, 1, 0), x = Enum.TextXAlignment.Right })
			UiKit.label(row, n.body, { size = 12, color = C.gray400, size2 = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, wrap = true })
		end
	end, { variant = "subtle", width = 46, height = 32, radius = 8, textSize = 16 })
	bell.Position = UDim2.new(1, -60, 0.5, 0)
	bell.AnchorPoint = Vector2.new(1, 0.5)
end

local function getCtx()
	return {
		state = State,
		ui = UiKit,
		C = C,
		F = Format,
		Career = CareerLib,
		Config = Config,
		navigate = Shell.navigate,
		toast = UiKit.toast,
		shell = Shell,
		section = Shell.section,
		screenGui = Shell.screenGui,
	}
end
Shell.getCtx = getCtx

function Shell.rebuild()
	if root then
		rebuildGui()
	end
end

rebuildGui = function()
	UiKit.clear(root)
	local main = UiKit.inst("Frame", { BackgroundColor3 = C.carbon950, BorderSizePixel = 0, Size = UDim2.new(1, 0, 1, 0) }, root)
	buildSidebar(main)
	local right = UiKit.inst("Frame", { BackgroundColor3 = C.carbon950, BorderSizePixel = 0, Size = UDim2.new(1, -236, 1, 0), ClipsDescendants = true }, main)
	right.Position = UDim2.new(0, 236, 0, 0)
	local bg = UiKit.inst("UIGradient", { Rotation = 125 }, right)
	bg.Color = ColorSequence.new(Color3.fromRGB(13, 16, 22), Color3.fromRGB(8, 9, 12))
	buildHeader(right)
	local content = UiKit.inst("ScrollingFrame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 1, -56),
		Position = UDim2.new(0, 0, 0, 56),
		ScrollBarThickness = 6,
		ScrollBarImageColor3 = C.carbon600,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, right)
	UiKit.list(content, { gap = 14 })
	UiKit.pad(content, 22)
	local fn = screen(Shell.section)
	local fnCtx
	fnCtx = getCtx()
	if fn then
		local ok, err = pcall(fn, fnCtx, content)
		if not ok then
			warn("[F1Game] screen render error (" .. Shell.section .. "): " .. tostring(err))
			UiKit.Empty(content, { title = "This screen hit an error.", hint = tostring(err) })
		end
	else
		UiKit.Empty(content, { title = "Screen not available.", hint = Shell.section })
	end
	if lastSection ~= Shell.section then
		lastSection = Shell.section
		UiKit.slideIn(content, 8, 0.18)
	end
end

function Shell.mount(screenGui)
	Shell.screenGui = screenGui
	if not root or not root.Parent then
		root = UiKit.inst("Frame", { Name = "Shell", BackgroundColor3 = C.carbon950, BorderSizePixel = 0, Size = UDim2.new(1, 0, 1, 0) }, screenGui)
	end
	rebuildGui()
	return root
end

function Shell.unmount()
	if root then
		root:Destroy()
		root = nil
	end
	screens = {}
end

return Shell
