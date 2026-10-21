local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Development = require(RS.Shared.Engine.Development)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local SPECS = {
	{ key = "aeroEfficiency", label = "Aero efficiency" },
	{ key = "downforce", label = "Downforce" },
	{ key = "cornering", label = "Cornering" },
	{ key = "straightLine", label = "Straight-line speed" },
	{ key = "braking", label = "Braking" },
	{ key = "mechanicalGrip", label = "Mechanical grip" },
	{ key = "tireFriendliness", label = "Tyre friendliness" },
	{ key = "reliability", label = "Reliability" },
	{ key = "wetPerformance", label = "Wet performance" },
	{ key = "cooling", label = "Cooling" },
}

local SECTIONS = {
	{ key = "nose", label = "Nose" },
	{ key = "frontWing", label = "Front wing" },
	{ key = "sidepod", label = "Sidepod" },
	{ key = "engineCover", label = "Engine cover" },
	{ key = "rearWing", label = "Rear wing" },
	{ key = "accentStripe", label = "Accent stripe" },
	{ key = "halo", label = "Halo / cockpit" },
	{ key = "primary", label = "Body" },
	{ key = "secondary", label = "Secondary" },
	{ key = "accent", label = "Accent" },
}

local PALETTE = {
	"#e10600", "#ff8000", "#ffd700", "#d4ff00", "#00a19b", "#00d2be",
	"#1e2a78", "#3b82f6", "#7c3aed", "#e11d48", "#10b981", "#f5f5f5",
	"#c0c0c0", "#94a3b8", "#1f2530", "#0f1115",
}

local PRESETS = {
	{ name = "Crimson", primary = "#e10600", secondary = "#0f1115", accent = "#ffd700", nose = "#e10600", frontWing = "#0f1115", sidepod = "#e10600", engineCover = "#e10600", rearWing = "#0f1115", accentStripe = "#ffd700", halo = "#0f1115" },
	{ name = "Teal", primary = "#00a19b", secondary = "#0b0f14", accent = "#c0c0c0", nose = "#00a19b", frontWing = "#0b0f14", sidepod = "#00a19b", engineCover = "#00a19b", rearWing = "#0b0f14", accentStripe = "#c0c0c0", halo = "#0b0f14" },
	{ name = "Papaya", primary = "#ff8000", secondary = "#10131c", accent = "#00d2be", nose = "#ff8000", frontWing = "#10131c", sidepod = "#ff8000", engineCover = "#ff8000", rearWing = "#10131c", accentStripe = "#00d2be", halo = "#10131c" },
	{ name = "Midnight", primary = "#1e2a78", secondary = "#0a0b10", accent = "#f5c518", nose = "#1e2a78", frontWing = "#0a0b10", sidepod = "#1e2a78", engineCover = "#1e2a78", rearWing = "#0a0b10", accentStripe = "#f5c518", halo = "#0a0b10" },
	{ name = "Forest", primary = "#00594f", secondary = "#101210", accent = "#d4ff00", nose = "#00594f", frontWing = "#101210", sidepod = "#00594f", engineCover = "#00594f", rearWing = "#101210", accentStripe = "#d4ff00", halo = "#101210" },
}

local paintDraft = nil
local activeSection = "nose"

local function paintFromTeam(team)
	return {
		primary = team.colors.primary,
		secondary = team.colors.secondary,
		accent = team.colors.accent,
		nose = team.livery.nose,
		frontWing = team.livery.frontWing,
		sidepod = team.livery.sidepod,
		engineCover = team.livery.engineCover,
		rearWing = team.livery.rearWing,
		accentStripe = team.livery.accentStripe,
		halo = team.livery.halo,
	}
end

local function copy(t)
	local o = {}
	for k, v in pairs(t) do
		o[k] = v
	end
	return o
end

local function swatch(parent, color, size, selected)
	local f = inst("Frame", { BackgroundColor3 = Common.hexcolor(color, C.carbon700), BorderSizePixel = 0, Size = UDim2.new(0, size, 0, size) }, parent)
	UiKit.corner(f, 4)
	UiKit.stroke(f, selected and C.white or C.carbon600, selected and 2 or 1)
	return f
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	local car = nil
	for _, c in ipairs(bundle.cars) do
		if c.teamId == myTeamId then car = c end
	end
	if not team or not car then return end

	local drivers = Career.teamDrivers(bundle, myTeamId)
	local row = Career.constructorRow(bundle, myTeamId)
	local basePaint = paintFromTeam(team)
	local current = paintDraft or basePaint
	local dirty = paintDraft ~= nil

	Common.sectionHeading(parent, "My Team", "Identity, livery and technical overview of your constructor.")

	local stats = UiKit.hrow(parent, 78, 10)
	local repHint = team.reputation >= 75 and "Paddock heavyweight" or (team.reputation >= 55 and "Respected midfield" or "Building credibility")
	local s1 = UiKit.Stat(stats, { label = "Reputation", value = string.format("%d/100", math.floor(team.reputation + 0.5)), hint = repHint })
	UiKit.splitH(s1, 4, 10, 1)
	local posText = row and Format.ordinal(row.position) or "—"
	local s2 = UiKit.Stat(stats, { label = "Constructors", value = posText, hint = row and string.format("%d pts", row.points) or "Awaiting first race" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Budget", value = Format.money(Career.balanceOf(bundle, myTeamId), true), hint = "Cash available" })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Home", value = (team.headquarters:gsub(",.*$", "")), hint = team.headquarters })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -392, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 380, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(1, -380, 0, 0)

	local liveryBody = UiKit.Panel(left, { title = "Livery studio" })
	local inner = UiKit.hrow(liveryBody, 0, 12)
	inner.AutomaticSize = Enum.AutomaticSize.Y
	local previewCol = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, Size = UDim2.new(0.45, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, inner)
	UiKit.corner(previewCol, 8)
	UiKit.list(previewCol, { pad = 10, gap = 4 })
	Common.carPreview(previewCol, current, team.abbreviation, 300)
	UiKit.label(previewCol, team.name, { font = UiKit.FONT_DISPLAY, size = 13, color = C.gray200, size2 = UDim2.new(1, 0, 0, 18) })
	UiKit.label(previewCol, team.engineSupplier, { font = UiKit.FONT_MONO, size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })

	local editCol = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.55, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, inner)
	UiKit.list(editCol, { gap = 8 })
	editCol.Position = UDim2.new(0.45, 6, 0, 0)
	UiKit.label(editCol, "Paint sections independently, then save. Colour changes are free and take effect immediately.", { size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 28), y = Enum.TextYAlignment.Top })

	UiKit.label(editCol, "PRESETS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local presetRow = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, editCol)
	UiKit.list(presetRow, { dir = Enum.FillDirection.Horizontal, gap = 6 })
	for _, p in ipairs(PRESETS) do
		local b = UiKit.button(presetRow, p.name, function()
			local np = copy(current)
			for _, s in ipairs(SECTIONS) do
				np[s.key] = p[s.key]
			end
			paintDraft = np
			ctx.shell.rebuild()
		end, { variant = "subtle", width = 78, height = 28, textSize = 11 })
		b.LayoutOrder = 1
	end

	UiKit.label(editCol, "SECTION", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local sectionNames = {}
	for _, s in ipairs(SECTIONS) do
		table.insert(sectionNames, s.label)
	end
	local currentLabel = "Nose"
	for _, s in ipairs(SECTIONS) do
		if s.key == activeSection then currentLabel = s.label end
	end
	Common.segmented(editCol, sectionNames, currentLabel, function(label)
		for _, s in ipairs(SECTIONS) do
			if s.label == label then activeSection = s.key end
		end
		ctx.shell.rebuild()
	end, { perRow = 5 })

	UiKit.label(editCol, "COLOUR", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local paletteRow = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, editCol)
	UiKit.list(paletteRow, { dir = Enum.FillDirection.Horizontal, gap = 5 })
	local idx = 0
	for _, hex in ipairs(PALETTE) do
		idx = idx + 1
		local btn = inst("TextButton", { BackgroundTransparency = 1, Text = "", Size = UDim2.new(0, 26, 0, 26) }, paletteRow)
		btn.LayoutOrder = idx
		local sw = swatch(btn, hex, 26, current[activeSection] == hex)
		sw.Size = UDim2.new(1, 0, 1, 0)
		btn.MouseButton1Click:Connect(function()
			local np = copy(current)
			np[activeSection] = hex
			paintDraft = np
			ctx.shell.rebuild()
		end)
	end

	local saveRow = UiKit.hrow(editCol, 32, 8)
	saveRow.LayoutOrder = 50
	UiKit.label(saveRow, dirty and "Unsaved livery changes" or "Livery is up to date", { size = 11, color = C.gray500, size2 = UDim2.new(1, -190, 1, 0) })
	local resetBtn = UiKit.button(saveRow, "Reset", function()
		paintDraft = nil
		ctx.shell.rebuild()
	end, { variant = "subtle", width = 70, height = 30 })
	UiKit.enable(resetBtn, dirty)
	resetBtn.LayoutOrder = 2
	resetBtn.Position = UDim2.new(1, -180, 0, 1)
	local saveBtn = UiKit.button(saveRow, "Save livery", function()
		UiKit.enable(saveBtn, false)
		local livery = copy(team.livery)
		for _, s in ipairs(SECTIONS) do
			livery[s.key] = current[s.key]
		end
		State.applyAction({
			type = "update-team",
			teamId = team.id,
			patch = {
				colors = { primary = current.primary, secondary = current.secondary, accent = current.accent },
				livery = livery,
			},
		})
		paintDraft = nil
		ctx.toast("success", "Livery saved")
		ctx.shell.rebuild()
	end, { variant = "primary", width = 110, height = 30, textSize = 12 })
	UiKit.enable(saveBtn, dirty)
	saveBtn.LayoutOrder = 3
	saveBtn.Position = UDim2.new(1, -110, 0, 1)

	local perfBody = UiKit.Panel(left, { title = "Car performance", right = UiKit.label(nil, "Baseline + installed upgrades", { size = 11, color = C.gray500 }) })
	local specWrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 270) }, perfBody)
	UiKit.grid(specWrap, UDim2.new(0.5, -6, 0, 40), 6)
	local function specBar(label, value, suffix)
		local cell = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, 0) }, specWrap)
		UiKit.list(cell, { gap = 4, pad = 2 })
		local head = UiKit.hrow(cell, 14, 0)
		UiKit.label(head, label, { size = 11, color = C.gray400, size2 = UDim2.new(0.7, 0, 1, 0) })
		UiKit.label(head, string.format("%d%s", math.floor(value + 0.5), suffix or ""), { font = UiKit.FONT_MONO, size = 11, color = C.gray300, size2 = UDim2.new(0.3, 0, 1, 0), x = Enum.TextXAlignment.Right })
		local tone = value >= 85 and C.raceGreen or (value >= 75 and C.raceTeal or C.raceAmber)
		UiKit.Progress(cell, { value = value, max = 100, color = tone, size2 = UDim2.new(1, 0, 0, 5) })
	end
	for _, s in ipairs(SPECS) do
		specBar(s.label, tonumber(car[s.key]) or 0)
	end
	specBar("Weight", math.max(0, 900 - (tonumber(car.weight) or 0)), " kg")

	UiKit.divider(perfBody)
	UiKit.label(perfBody, "INSTALLED UPGRADE POINTS", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local anyInstalled = false
	local chipRow = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, perfBody)
	UiKit.list(chipRow, { dir = Enum.FillDirection.Horizontal, gap = 6 })
	local n = 0
	for area, pts in pairs(car.installed) do
		if pts > 0 then
			anyInstalled = true
			n = n + 1
			local meta = Development.UPGRADE_META[area]
			Common.chip(chipRow, string.format("%s +%.1f", meta and meta.name or area, pts)).LayoutOrder = n
		end
	end
	if not anyInstalled then
		UiKit.label(perfBody, "No upgrades installed yet. Start developing on the Car Development page.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
	end

	local idBody = UiKit.Panel(right, { title = "Identity" })
	local idHead = UiKit.hrow(idBody, 48, 10)
	Common.teamBadge(idHead, team, 48)
	local idText = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -58, 1, 0) }, idHead)
	idText.Position = UDim2.new(0, 58, 0, 0)
	UiKit.label(idText, team.name, { font = UiKit.FONT_DISPLAY, size = 16, color = C.white, size2 = UDim2.new(1, 0, 0, 22) })
	UiKit.label(idText, string.format("%s · %s · %s", team.shortName, team.abbreviation, team.nationality), { size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 16) })
	local identity = {
		{ "Headquarters", team.headquarters },
		{ "Engine", team.engineSupplier },
		{ "Philosophy", team.philosophy },
		{ "Number style", team.numberStyle },
		{ "Season objective", string.format("P%d or better", team.objective) },
	}
	for _, kv in ipairs(identity) do
		local r = UiKit.hrow(idBody, 20, 8)
		UiKit.label(r, kv[1], { size = 11, color = C.gray500, size2 = UDim2.new(0.42, 0, 1, 0) })
		UiKit.label(r, tostring(kv[2]), { size = 11, color = C.gray200, size2 = UDim2.new(0.58, 0, 1, 0), x = Enum.TextXAlignment.Right, truncate = Enum.TextTruncate.AtEnd })
	end

	local lineBody = UiKit.Panel(right, { title = "Race line-up" })
	if #drivers == 0 then
		UiKit.label(lineBody, "No drivers contracted. Sign two drivers before racing.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
	else
		for _, d in ipairs(drivers) do
			local r = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, Size = UDim2.new(1, 0, 0, 38) }, lineBody)
			UiKit.corner(r, 6)
			local code = inst("TextLabel", { BackgroundColor3 = C.carbon800, Text = d.code, TextColor3 = C.gray400, TextSize = 10, Font = UiKit.FONT_MONO, Size = UDim2.new(0, 30, 0, 30) }, r)
			UiKit.corner(code, 15)
			code.Position = UDim2.new(0, 4, 0, 4)
			UiKit.label(r, d.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -90, 0, 16) }).Position = UDim2.new(0, 40, 0, 3)
			UiKit.label(r, string.format("%s · age %d · %d starts", d.nationality, d.age, d.starts), { size = 10, color = C.gray500, size2 = UDim2.new(1, -90, 0, 14) }).Position = UDim2.new(0, 40, 0, 18)
			UiKit.label(r, tostring(math.floor(d.morale + 0.5)), { font = UiKit.FONT_MONO, size = 11, color = C.gray400, size2 = UDim2.new(0, 30, 0, 30), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -34, 0, 4)
		end
	end

	local facBody = UiKit.Panel(right, { title = "Facilities snapshot" })
	local count = 0
	for _, f in ipairs(bundle.facilities) do
		if f.teamId == myTeamId and count < 6 then
			count = count + 1
			local r = UiKit.hrow(facBody, 16, 6)
			UiKit.label(r, (f.kind:gsub("%-", " ")), { size = 11, color = C.gray300, size2 = UDim2.new(1, -80, 1, 0) })
			local pips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 66, 0, 10) }, r)
			pips.Position = UDim2.new(1, -66, 0.5, -5)
			for l = 1, 5 do
				local pip = inst("Frame", { BackgroundColor3 = l <= f.level and C.raceTeal or C.carbon700, BorderSizePixel = 0, Size = UDim2.new(0, 9, 0, 9) }, pips)
				UiKit.corner(pip, 2)
				pip.Position = UDim2.new(0, (l - 1) * 13, 0, 0)
			end
		end
	end

	local notes = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 86) }, right)
	UiKit.corner(notes, 10)
	UiKit.stroke(notes, C.carbon700, 1)
	UiKit.pad(notes, 12)
	UiKit.label(notes, "Team notes", { font = Enum.Font.GothamBold, size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 16) })
	UiKit.label(notes, "Identity is fixed for the season; colours can be changed any time. Car performance is driven by baseline specs plus installed upgrade points.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 36), y = Enum.TextYAlignment.Top, wrap = true })
	UiKit.label(notes, string.format("Grid P%d objective", team.objective), { size = 10, color = C.gray400, size2 = UDim2.new(1, 0, 0, 14) })
end
