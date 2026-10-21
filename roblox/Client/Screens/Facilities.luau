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

local KINDS = { "factory", "design-office", "wind-tunnel", "simulator", "driver-academy", "pit-crew", "commercial", "reliability-lab", "hospitality" }
local MAX_LEVEL = 5

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end

	local facilities = {}
	local upkeep = 0
	for _, f in ipairs(bundle.facilities) do
		if f.teamId == myTeamId then
			table.insert(facilities, f)
			upkeep = upkeep + 2000000 * (1 + f.level * 0.5)
		end
	end
	local balance = Career.balanceOf(bundle, myTeamId)
	local mods = Season.teamDevelopmentModifiers(bundle, myTeamId)

	Common.sectionHeading(parent, "Facilities", "Invest in your factory to speed up development, improve pit stops and support the team.")

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Development speed", value = string.format("%.2f×", mods.speed), hint = "Design office, wind tunnel, staff" })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Max concurrent projects", value = tostring(mods.maxConcurrent), hint = "Research capacity" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Pit stop bonus", value = string.format("%d%%", math.floor(mods.pitStopBonus * 100 + 0.5)), hint = "Pit crew training" })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Season upkeep", value = Format.money(upkeep, true), hint = Format.money(balance, true) .. " available" })
	UiKit.splitH(s4, 4, 10, 4)

	local rows = math.ceil(#KINDS / 3)
	local gridWrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, rows * 178 + (rows - 1) * 10) }, parent)
	UiKit.grid(gridWrap, UDim2.new(1 / 3, -8, 0, 178), 10)

	for _, kind in ipairs(KINDS) do
		local meta = Development.FACILITY_META[kind]
		local level = Development.facilityLevel(facilities, kind)
		local maxed = level >= MAX_LEVEL
		local cost = Development.facilityUpgradeCost(kind, level)
		local card = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 1, 0) }, gridWrap)
		UiKit.corner(card, 10)
		UiKit.stroke(card, C.carbon700, 1)
		UiKit.pad(card, 12)

		UiKit.label(card, meta and meta.name or kind, { font = UiKit.FONT_DISPLAY, size = 12, color = C.gray300, size2 = UDim2.new(1, 0, 0, 16) })
		local pips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 100, 0, 10) }, card)
		pips.Position = UDim2.new(0, 0, 0, 24)
		for l = 1, MAX_LEVEL do
			local pip = inst("Frame", { BackgroundColor3 = l <= level and C.raceTeal or C.carbon700, BorderSizePixel = 0, Size = UDim2.new(0, 16, 0, 10) }, pips)
			UiKit.corner(pip, 2)
			pip.Position = UDim2.new(0, (l - 1) * 19, 0, 0)
		end
		UiKit.label(card, string.format("Level %d / %d", level, MAX_LEVEL), { size = 10, color = C.gray400, size2 = UDim2.new(1, 0, 0, 14) }).Position = UDim2.new(0, 0, 0, 36)
		local badge = UiKit.Badge(card, maxed and "Max" or Format.money(cost, true), maxed and "good" or "default")
		badge.AnchorPoint = Vector2.new(1, 0)
		badge.Position = UDim2.new(1, 0, 0, 0)
		UiKit.label(card, meta and meta.effect or "", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 34), wrap = true, y = Enum.TextYAlignment.Top }).Position = UDim2.new(0, 0, 0, 56)
		local btn = UiKit.button(card, maxed and "Fully upgraded" or "Upgrade", function()
			UiKit.enable(btn, false)
			local _, err = State.applyAction({ type = "upgrade-facility", teamId = myTeamId, kind = kind })
			ctx.toast(err and "error" or "success", err or ((meta and meta.name or kind) .. " upgraded"))
			ctx.shell.rebuild()
		end, { variant = "primary", width = 0, height = 28, textSize = 11 })
		UiKit.enable(btn, not maxed)
		btn.AnchorPoint = Vector2.new(0, 1)
		btn.Position = UDim2.new(0, 0, 1, 0)
		btn.Size = UDim2.new(1, 0, 0, 28)
	end

	local note = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 46) }, parent)
	UiKit.corner(note, 10)
	UiKit.stroke(note, C.carbon700, 1)
	UiKit.pad(note, 12)
	UiKit.label(note, "Facility upgrades are charged immediately and increase season upkeep. They are permanent and carry across seasons. Development projects tick once per completed race weekend.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 22), wrap = true, y = Enum.TextYAlignment.Top })
end
