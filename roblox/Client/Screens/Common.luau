-- Shared screen helpers.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UiKit = require(script.Parent.Parent.UiKit)
local DataCircuits = require(ReplicatedStorage.F1Game.Shared.Data.Circuits)

local C = UiKit.C
local Common = {}

function Common.circuit(id)
	return DataCircuits.get(id)
end

function Common.hexcolor(s, fallback)
	if type(s) == "string" then
		local ok, c = pcall(Color3.fromHex, s)
		if ok then
			return c
		end
	end
	return fallback
end

function Common.teamBadge(parent, team, size, props)
	size = size or 32
	props = props or {}
	local abbreviation = props.text or (team and team.abbreviation) or "?"
	local primary = team and team.colors and Common.hexcolor(team.colors.primary, C.raceRed) or C.raceRed
	local accent = team and team.colors and Common.hexcolor(team.colors.accent, C.gray500) or C.gray500
	local f = UiKit.inst("Frame", {
		BackgroundColor3 = primary,
		BorderSizePixel = 0,
		Size = UDim2.new(0, size, 0, size),
	}, parent)
	UiKit.corner(f, math.max(4, size * 0.18))
	UiKit.stroke(f, accent, 1)
	UiKit.label(f, abbreviation, {
		font = UiKit.FONT_DISPLAY,
		size = math.max(8, math.floor(size * 0.36)),
		color = C.white,
		size2 = UDim2.new(1, 0, 1, 0),
		x = Enum.TextXAlignment.Center,
	})
	return f
end

function Common.statRow(parent, stats, cols)
	cols = math.max(1, cols or #stats)
	local rows = math.ceil(#stats / cols)
	for r = 1, rows do
		local sub = {}
		for i = 1, cols do
			local idx = (r - 1) * cols + i
			if stats[idx] then
				sub[#sub + 1] = stats[idx]
			end
		end
		if #sub > 0 then
			local row = UiKit.hrow(parent, 74, 8)
			for _, st in ipairs(sub) do
				UiKit.Stat(row, {
					label = st.label,
					value = st.value,
					hint = st.hint,
					accent = st.accent,
					size2 = UDim2.new(1 / #sub, -8 * (#sub - 1) / #sub, 0, 74),
				})
			end
		end
	end
end

function Common.kvGrid(parent, pairs, cols)
	cols = cols or 2
	local grid = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
	UiKit.grid(grid, UDim2.new(1 / cols, -6, 0, 52), 6)
	for _, pair in ipairs(pairs) do
		local box = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, BorderSizePixel = 0 }, grid)
		UiKit.corner(box, 6)
		UiKit.list(box, { gap = 2, valign = Enum.VerticalAlignment.Center })
		UiKit.pad(box, 8)
		UiKit.label(box, string.upper(tostring(pair[1])), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		UiKit.label(box, tostring(pair[2]), { font = Enum.Font.GothamBold, size = 13, color = C.gray300, size2 = UDim2.new(1, 0, 0, 18), truncate = Enum.TextTruncate.AtEnd })
	end
	return grid
end

function Common.chip(parent, text)
	local b = UiKit.inst("TextLabel", {
		BackgroundColor3 = C.carbon900,
		BackgroundTransparency = 0.3,
		Text = text,
		TextColor3 = C.gray400,
		TextSize = 11,
		Font = Enum.Font.Gotham,
		BorderSizePixel = 0,
		AutomaticSize = Enum.AutomaticSize.X,
		Size = UDim2.new(0, 0, 0, 22),
	}, parent)
	UiKit.corner(b, 11)
	UiKit.stroke(b, C.carbon600, 1)
	UiKit.pad(b, 0, 10, 0, 10)
	return b
end

function Common.sectionHeading(parent, title, subtitle)
	return UiKit.SectionHeading(parent, { title = title, subtitle = subtitle })
end

function Common.segmented(parent, options, current, onSelect, opts)
	opts = opts or {}
	local wrap = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
	UiKit.list(wrap, { gap = 8 })
	if opts.label then
		UiKit.label(wrap, string.upper(opts.label), { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
	end
	local count = #options
	local perRow = opts.perRow or 6
	local placed = 0
	while placed < count do
		local chunk = math.min(perRow, count - placed)
		local r = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 36), LayoutOrder = placed }, wrap)
		UiKit.list(r, { dir = Enum.FillDirection.Horizontal, gap = 6 })
		for j = 1, chunk do
			local opt = options[placed + j]
			local active = current == opt or tostring(current) == tostring(opt)
			local b = UiKit.button(r, tostring(opt), function()
				onSelect(opt)
			end, { variant = active and "teal" or "subtle", height = 36, textSize = 13 })
			b.Size = UDim2.new(1 / chunk, -6 * (chunk - 1) / chunk, 0, 36)
			b.LayoutOrder = j
		end
		placed = placed + chunk
	end
	return wrap
end

function Common.toggle(parent, label, value, onToggle)
	local row = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 32) }, parent)
	UiKit.label(row, label, { size = 13, color = C.gray300, size2 = UDim2.new(1, -90, 1, 0) })
	local b = UiKit.button(row, value and "On" or "Off", function()
		onToggle(not value)
	end, { variant = value and "teal" or "subtle", width = 70, height = 28, radius = 14, textSize = 12 })
	b.Position = UDim2.new(1, -70, 0, 2)
	return row
end

function Common.carPreview(parent, paint, number, height)
	height = height or 180
	local holder = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, height) }, parent)
	local carW = math.min(height * 0.60, 260)
	local carH = height - 18
	local car = UiKit.inst("Frame", {
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.5, 0),
		Size = UDim2.new(0, carW, 0, carH),
	}, holder)
	local function col(hex, fb)
		return Common.hexcolor(hex, fb or C.gray500)
	end
	local function part(y, h, wf, color, xf, radius, transparency)
		local f = UiKit.inst("Frame", {
			BackgroundColor3 = color,
			BackgroundTransparency = transparency or 0,
			BorderSizePixel = 0,
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.new(xf or 0.5, 0, y, 0),
			Size = UDim2.new(wf, 0, h, 0),
		}, car)
		UiKit.corner(f, radius or 3)
		return f
	end

	-- Floor shadow and plank.
	part(0.015, 0.97, 1.04, Color3.new(0, 0, 0), 0.5, 18, 0.55)
	part(0.10, 0.82, 0.62, C.carbon800, 0.5, 10)

	-- Wheels.
	for _, wy in ipairs({ 0.20, 0.66 }) do
		for _, wx in ipairs({ 0.04, 0.96 }) do
			local wheel = part(wy, 0.15, 0.17, Color3.fromRGB(16, 17, 21), wx, 8)
			part(wy + 0.025, 0.10, 0.10, Color3.fromRGB(45, 48, 56), wx, 6)
			UiKit.stroke(wheel, C.carbon600, 1)
		end
	end

	-- Front wing, endplates and nose.
	part(0.015, 0.075, 1.0, col(paint.frontWing, C.carbon800), 0.5, 3)
	part(0.005, 0.10, 0.06, col(paint.secondary, C.carbon700), 0.015, 2)
	part(0.005, 0.10, 0.06, col(paint.secondary, C.carbon700), 0.985, 2)
	part(0.065, 0.27, 0.17, col(paint.nose, C.raceRed), 0.5, 3)
	part(0.075, 0.03, 0.20, col(paint.accentStripe, C.raceTeal), 0.5, 1)

	-- Chassis and sidepods.
	part(0.28, 0.44, 0.34, col(paint.primary, C.raceRed), 0.5, 7)
	part(0.34, 0.24, 0.24, col(paint.sidepod, C.raceRed), 0.235, 5)
	part(0.34, 0.24, 0.24, col(paint.sidepod, C.raceRed), 0.765, 5)
	part(0.40, 0.10, 0.05, col(paint.accentStripe, C.raceTeal), 0.235, 1)
	part(0.40, 0.10, 0.05, col(paint.accentStripe, C.raceTeal), 0.765, 1)

	-- Engine cover and rear wing.
	part(0.62, 0.24, 0.28, col(paint.engineCover, C.raceRed), 0.5, 6)
	part(0.63, 0.22, 0.05, col(paint.accentStripe, C.raceTeal), 0.5, 1)
	part(0.875, 0.075, 0.88, col(paint.rearWing, C.carbon800), 0.5, 3)
	part(0.86, 0.10, 0.05, col(paint.secondary, C.carbon700), 0.045, 2)
	part(0.86, 0.10, 0.05, col(paint.secondary, C.carbon700), 0.955, 2)
	part(0.905, 0.03, 0.44, col(paint.accentStripe, C.raceTeal), 0.5, 1)

	-- Halo and cockpit.
	local halo = part(0.335, 0.16, 0.23, C.carbon700, 0.5, 18, 0.15)
	UiKit.stroke(halo, C.carbon600, 1)
	local cockpit = part(0.365, 0.095, 0.145, Color3.fromRGB(12, 13, 17), 0.5, 12)
	cockpit.ZIndex = 3

	local num = UiKit.inst("TextLabel", {
		BackgroundTransparency = 1,
		Text = tostring(number or ""),
		TextColor3 = C.white,
		TextSize = math.clamp(math.floor(height * 0.075), 14, 30),
		Font = UiKit.FONT_DISPLAY,
		TextStrokeColor3 = C.carbon950,
		TextStrokeTransparency = 0.55,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.73, 0),
		Size = UDim2.new(0.3, 0, 0.12, 0),
		ZIndex = 4,
	}, car)
	num.Text = tostring(number or "")

	UiKit.reveal(holder)
	return holder
end

function Common.run(ctx, action, okMessage, after)
	local extra, err = ctx.state.applyAction(action)
	if err then
		ctx.toast("error", err)
		return nil
	end
	if okMessage then
		ctx.toast("success", okMessage)
	end
	if after then
		after(extra)
	end
	return extra
end

return Common
