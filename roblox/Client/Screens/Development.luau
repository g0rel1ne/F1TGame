local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Development = require(RS.Shared.Engine.Development)
local Season = require(RS.Shared.Engine.Season)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local AREAS = { "front-wing", "rear-wing", "floor", "sidepods", "suspension", "chassis", "brakes", "cooling", "engine", "gearbox", "reliability" }
local CATEGORY_COLORS = { aero = Color3.fromRGB(56, 189, 248), mechanical = Color3.fromRGB(167, 139, 250), power = Color3.fromRGB(251, 146, 60), reliability = Color3.fromRGB(52, 211, 153) }

local function categoryColor(cat)
	return CATEGORY_COLORS[cat] or C.gray400
end

local function projectCard(parent, project, category)
	local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
	UiKit.corner(card, 8)
	UiKit.stroke(card, C.carbon700, 1)
	UiKit.list(card, { gap = 4, pad = 10 })
	local head = UiKit.hrow(card, 18, 6)
	UiKit.label(head, project.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -70, 1, 0), truncate = Enum.TextTruncate.AtEnd })
	local badge = UiKit.Badge(head, string.format("%d tick%s left", project.ticksRemaining, project.ticksRemaining == 1 and "" or "s"), "info")
	badge.AnchorPoint = Vector2.new(1, 0.5)
	badge.Position = UDim2.new(1, 0, 0.5, 0)
	UiKit.label(card, string.format("%s · quality %d · est. +%.1f pts", category, math.floor(project.quality + 0.5), project.nominalGain), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local pct = ((project.durationTicks - project.ticksRemaining) / project.durationTicks) * 100
	UiKit.Progress(card, { value = pct, color = categoryColor(category), size2 = UDim2.new(1, 0, 0, 6) })
	return card
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end
	local car = nil
	for _, c in ipairs(bundle.cars) do
		if c.teamId == myTeamId then car = c end
	end
	if not car then return end

	local mods = Season.teamDevelopmentModifiers(bundle, myTeamId)
	local active, completed, installed = {}, {}, {}
	for _, u in ipairs(bundle.upgrades) do
		if u.teamId == myTeamId then
			if not u.completed then
				table.insert(active, u)
			elseif not u.installed then
				table.insert(completed, u)
			else
				table.insert(installed, u)
			end
		end
	end
	local balance = Career.balanceOf(bundle, myTeamId)
	local facilities = {}
	for _, f in ipairs(bundle.facilities) do
		if f.teamId == myTeamId then table.insert(facilities, f) end
	end
	local atCapacity = #active >= mods.maxConcurrent

	Common.sectionHeading(parent, "Car Development", "Research upgrades, then install completed components onto the car. Each race weekend advances active projects by one tick.")

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Research speed", value = string.format("%.2f×", mods.speed), hint = "Facilities + staff" })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Quality multiplier", value = string.format("%.2f×", mods.quality), hint = "Affects upgrade gain" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Active projects", value = string.format("%d/%d", #active, mods.maxConcurrent), hint = "One tick per race weekend" })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Budget", value = Format.money(balance, true), hint = "Research is charged up front", accent = balance < 0 and C.raceRed or nil })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -372, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 360, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(1, -360, 0, 0)

	local activeBody = UiKit.Panel(left, { title = "Active research" })
	if #active == 0 then
		UiKit.Empty(activeBody, { title = "No projects in development", hint = "Pick an area below to start researching an upgrade." })
	else
		for _, u in ipairs(active) do
			local meta = Development.UPGRADE_META[u.area]
			projectCard(activeBody, u, meta and meta.category or "aero")
		end
	end

	if #completed > 0 then
		local readyBody = UiKit.Panel(left, { title = "Ready to install", right = UiKit.Badge(nil, string.format("%d complete", #completed), "good") })
		for _, u in ipairs(completed) do
			local row = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(1, 0, 0, 46) }, readyBody)
			UiKit.corner(row, 8)
			UiKit.stroke(row, C.carbon600, 1)
			UiKit.label(row, u.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -110, 0, 16) }).Position = UDim2.new(0, 10, 0, 6)
			UiKit.label(row, string.format("+%.1f performance points", u.nominalGain), { size = 10, color = C.gray500, size2 = UDim2.new(1, -110, 0, 14) }).Position = UDim2.new(0, 10, 0, 22)
			local btn = UiKit.button(row, "Install", function()
				UiKit.enable(btn, false)
				local _, err = State.applyAction({ type = "install-project", teamId = myTeamId, projectId = u.id })
				ctx.toast(err and "error" or "success", err or (u.name .. " installed"))
				ctx.shell.rebuild()
			end, { variant = "primary", width = 80, height = 26, textSize = 11 })
			btn.AnchorPoint = Vector2.new(1, 0.5)
			btn.Position = UDim2.new(1, -10, 0.5, 0)
		end
	end

	local startBody = UiKit.Panel(left, { title = "Start a project" })
	UiKit.label(startBody, "Costs are estimates based on your facilities. Higher quality rolls yield larger performance gains on installation.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 28), wrap = true, y = Enum.TextYAlignment.Top })
	local rows = math.ceil(#AREAS / 3)
	local gridWrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, rows * 78 + (rows - 1) * 8) }, startBody)
	UiKit.grid(gridWrap, UDim2.new(1 / 3, -6, 0, 78), 8)
	for _, area in ipairs(AREAS) do
		local meta = Development.UPGRADE_META[area]
		local cost = math.floor(meta.baseCost * 1.02 + 0.5)
		local ticks = math.max(1, math.floor(meta.baseTicks / mods.speed + 0.5))
		local card = inst("TextButton", {
			BackgroundColor3 = C.carbon900,
			BackgroundTransparency = 0.5,
			Text = "",
			AutoButtonColor = false,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 1, 0),
		}, gridWrap)
		UiKit.corner(card, 8)
		UiKit.stroke(card, C.carbon700, 1)
		UiKit.pad(card, 9)
		local dot = inst("Frame", { BackgroundColor3 = categoryColor(meta.category), BorderSizePixel = 0, Size = UDim2.new(0, 8, 0, 8) }, card)
		UiKit.corner(dot, 4)
		dot.AnchorPoint = Vector2.new(1, 0)
		dot.Position = UDim2.new(1, 0, 0, 2)
		UiKit.label(card, meta.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -12, 0, 16), truncate = Enum.TextTruncate.AtEnd })
		UiKit.label(card, Format.money(cost, true), { font = UiKit.FONT_MONO, size = 11, color = C.gray400, size2 = UDim2.new(0.5, 0, 0, 16) }).Position = UDim2.new(0, 0, 0, 20)
		UiKit.label(card, string.format("%d tick%s", ticks, ticks == 1 and "" or "s"), { font = UiKit.FONT_MONO, size = 11, color = C.gray500, size2 = UDim2.new(0.5, 0, 0, 16), x = Enum.TextXAlignment.Right }).Position = UDim2.new(0.5, 0, 0, 20)
		UiKit.label(card, string.format("+%.1f nominal points · %s", meta.nominalGain, meta.category), { size = 9, color = C.gray600, size2 = UDim2.new(1, 0, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 0, 0, 38)
		if atCapacity then
			card.AutoButtonColor = false
			card.BackgroundTransparency = 0.75
		else
			card.MouseButton1Click:Connect(function()
				if atCapacity then return end
				card.AutoButtonColor = false
				local _, err = State.applyAction({ type = "start-project", teamId = myTeamId, area = area })
				ctx.toast(err and "error" or "success", err or (meta.name .. " research started"))
				ctx.shell.rebuild()
			end)
			card.MouseEnter:Connect(function() card.BackgroundTransparency = 0.2 end)
			card.MouseLeave:Connect(function() card.BackgroundTransparency = 0.5 end)
		end
	end
	if atCapacity then
		UiKit.label(startBody, "Research capacity reached. Install or wait for a project to finish, or upgrade the wind tunnel/design office.", { size = 10, color = C.raceAmber, size2 = UDim2.new(1, 0, 0, 16) })
	end

	if #installed > 0 then
		local instBody = UiKit.Panel(left, { title = "Installed upgrades" })
		for _, u in ipairs(installed) do
			local row = UiKit.hrow(instBody, 20, 0)
			UiKit.label(row, u.name, { size = 11, color = C.gray300, size2 = UDim2.new(1, -60, 1, 0) })
			UiKit.label(row, string.format("+%.1f", u.nominalGain), { font = UiKit.FONT_MONO, size = 11, color = C.raceGreen, size2 = UDim2.new(0, 60, 1, 0), x = Enum.TextXAlignment.Right })
		end
	end

	local carBody = UiKit.Panel(right, { title = "Current car" })
	local specList = {
		{ "Aero efficiency", car.aeroEfficiency },
		{ "Downforce", car.downforce },
		{ "Cornering", car.cornering },
		{ "Straight-line", car.straightLine },
		{ "Reliability", car.reliability },
		{ "Mechanical grip", car.mechanicalGrip },
	}
	for _, pair in ipairs(specList) do
		local holder = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 22) }, carBody)
		UiKit.label(holder, pair[1], { size = 10, color = C.gray400, size2 = UDim2.new(0.7, 0, 0, 11) })
		UiKit.label(holder, string.format("%d", math.floor(pair[2] + 0.5)), { font = UiKit.FONT_MONO, size = 10, color = C.gray300, size2 = UDim2.new(0.3, 0, 0, 11), x = Enum.TextXAlignment.Right })
		UiKit.Progress(holder, { value = pair[2], max = 100, color = C.raceTeal, size2 = UDim2.new(1, 0, 0, 5) }).Position = UDim2.new(0, 0, 0, 14)
	end
	UiKit.label(carBody, "Installed points add directly to race performance. Upgrades carry into the next season.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })

	local facBody = UiKit.Panel(right, { title = "Development facilities" })
	local kinds = { "design-office", "wind-tunnel", "simulator", "reliability-lab", "pit-crew" }
	for _, kind in ipairs(kinds) do
		local meta = Development.FACILITY_META[kind]
		local level = Development.facilityLevel(facilities, kind)
		local row = UiKit.hrow(facBody, 16, 6)
		UiKit.label(row, meta and meta.name or kind, { size = 11, color = C.gray300, size2 = UDim2.new(1, -70, 1, 0) })
		local pips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 66, 0, 10) }, row)
		pips.Position = UDim2.new(1, -66, 0.5, -5)
		for l = 1, 5 do
			local pip = inst("Frame", { BackgroundColor3 = l <= level and C.raceTeal or C.carbon700, BorderSizePixel = 0, Size = UDim2.new(0, 9, 0, 9) }, pips)
			UiKit.corner(pip, 2)
			pip.Position = UDim2.new(0, (l - 1) * 13, 0, 0)
		end
	end

	local howBody = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 92) }, right)
	UiKit.corner(howBody, 10)
	UiKit.stroke(howBody, C.carbon700, 1)
	UiKit.pad(howBody, 12)
	UiKit.label(howBody, "HOW TICKS WORK", { font = Enum.Font.GothamBold, size = 10, color = C.gray400, size2 = UDim2.new(1, 0, 0, 14) })
	UiKit.label(howBody, "Each completed race weekend counts as one development tick. Projects started late in a season may finish in the next one — install them before the season reset to keep the gains.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 60), wrap = true, y = Enum.TextYAlignment.Top })
end
