-- Team creation wizard. Mirrors src/pages/TeamWizard.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UiKit = require(script.Parent.Parent.UiKit)
local Common = require(script.Parent.Common)
local Config = require(ReplicatedStorage.F1Game.Shared.Config)

local C = UiKit.C
local TeamWizard = {}

local NATIONS = { "British", "Italian", "German", "French", "Spanish", "Dutch", "American", "Japanese", "Brazilian", "Australian", "Canadian", "Swiss", "Austrian", "Belgian", "Mexican" }
local ENGINES = { "Aurora Power", "Mercedes", "Ferrari", "Honda", "Renault", "Audi", "RB Powertrains" }
local PHILOSOPHIES = { "Aero-first attack", "Balanced development", "Mechanical grip & traction", "Power and efficiency", "Reliability above all", "Youth academy project" }
local HEADQUARTERS = { "London, UK", "Maranello, Italy", "Stuttgart, Germany", "Woking, UK", "Milton Keynes, UK", "Enstone, UK", "Hinwil, Switzerland", "Silverstone, UK" }
local NUMBER_STYLES = { "classic", "italic", "block", "outline" }

local DEFAULT_PAINT = {
	primary = "#e10600", secondary = "#111318", accent = "#00d2be",
	nose = "#e10600", frontWing = "#111318", sidepod = "#e10600",
	engineCover = "#e10600", rearWing = "#111318", accentStripe = "#00d2be", halo = "#111318",
}

local SECTIONS = {
	{ key = "primary", label = "Primary" },
	{ key = "secondary", label = "Secondary" },
	{ key = "accent", label = "Accent" },
	{ key = "nose", label = "Nose" },
	{ key = "frontWing", label = "Front wing" },
	{ key = "sidepod", label = "Sidepod" },
	{ key = "engineCover", label = "Engine cover" },
	{ key = "rearWing", label = "Rear wing" },
	{ key = "accentStripe", label = "Accent stripe" },
	{ key = "halo", label = "Halo" },
}

local PRESETS = {
	{ name = "Crimson", primary = "#e10600", accent = "#ffd700" },
	{ name = "Teal", primary = "#00a19b", accent = "#c0c0c0" },
	{ name = "Papaya", primary = "#ff8000", accent = "#00d2be" },
	{ name = "Midnight", primary = "#1e2a78", accent = "#f5c518" },
	{ name = "Forest", primary = "#00594f", accent = "#d4ff00" },
}

local PALETTE = { "#e10600", "#ff8000", "#f5c518", "#d4ff00", "#10b981", "#00594f", "#00d2be", "#3b82f6", "#1e2a78", "#ffffff", "#c0c0c0", "#6b7484", "#111318", "#0a0b0e" }

local W = { step = 1 }

local function reset()
	W.step = 1
	W.name = "Apex Grand Prix"
	W.shortName = "Apex"
	W.abbreviation = "APX"
	W.nationality = "British"
	W.headquarters = HEADQUARTERS[1]
	W.engineSupplier = ENGINES[1]
	W.philosophy = PHILOSOPHIES[1]
	W.numberStyle = NUMBER_STYLES[1]
	W.paint = {}
	for k, v in pairs(DEFAULT_PAINT) do
		W.paint[k] = v
	end
	W.paintSection = "primary"
end
reset()
TeamWizard.reset = reset

local function validIdentity()
	return #W.name >= 3 and #W.abbreviation == 3 and #W.shortName >= 2
end

function TeamWizard.render(ctx, parent)
	local function draw()
		UiKit.clear(parent)
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
		UiKit.list(content, { gap = 14 })
		UiKit.pad(content, 24, 0, 40, 0)

		UiKit.SectionHeading(content, { title = "Create your team", subtitle = "Build the identity, livery and engineering philosophy that will define your career." })

		local steps = { "Identity", "Livery", "Engineering", "Review" }
		local bar = UiKit.hrow(content, 26, 8)
		for i, s in ipairs(steps) do
			local active = i <= W.step
			local b = UiKit.button(bar, string.format("%d. %s", i, s), nil, {
				variant = i == W.step and "primary" or (active and "subtle" or "ghost"),
				height = 26, textSize = 12,
			})
			b.Size = UDim2.new(1 / 4, -6, 1, 0)
			b.LayoutOrder = i
		end

		local body = UiKit.Panel(content, {})
		local step = W.step
		if step == 1 then
			UiKit.label(body, "Team name", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
			UiKit.textbox(body, { text = W.name, size2 = UDim2.new(1, 0, 0, 34) }).FocusLost:Connect(function(enter, text)
				W.name = text
			end)
			local r = UiKit.hrow(body, 34, 8)
			local function field(lbl, value, onSet, order)
				local col = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -4, 1, 0), LayoutOrder = order }, r)
				UiKit.label(col, lbl, { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
				UiKit.textbox(col, { text = value, size2 = UDim2.new(1, 0, 0, 34) }).FocusLost:Connect(function(_, text)
					onSet(text)
				end)
			end
			r.Size = UDim2.new(1, 0, 0, 52)
			field("Short name", W.shortName, function(t)
				W.shortName = t
			end, 1)
			field("Abbreviation", W.abbreviation, function(t)
				W.abbreviation = string.upper(string.sub(string.gsub(t, "[^%a]", ""), 1, 3))
				draw()
			end, 2)
			Common.segmented(body, NATIONS, W.nationality, function(v)
				W.nationality = v
				draw()
			end, { label = "Nationality" })
			Common.segmented(body, NUMBER_STYLES, W.numberStyle, function(v)
				W.numberStyle = v
				draw()
			end, { label = "Race number style" })
		elseif step == 2 then
			UiKit.label(body, "Paint each section independently.", { size = 12, color = C.gray400, size2 = UDim2.new(1, 0, 0, 16) })
			Common.carPreview(body, W.paint, W.abbreviation, 170)
			local presetRow = UiKit.hrow(body, 34, 6)
			for i, p in ipairs(PRESETS) do
				local b = UiKit.button(presetRow, p.name, function()
					W.paint.primary = p.primary
					W.paint.accent = p.accent
					W.paint.accentStripe = p.accent
					W.paint.nose = p.primary
					W.paint.sidepod = p.primary
					W.paint.engineCover = p.primary
					W.paint.frontWing = "#111318"
					W.paint.rearWing = "#111318"
					W.paint.halo = "#111318"
					W.paint.secondary = "#111318"
					draw()
				end, { variant = "subtle", height = 32, textSize = 12 })
				b.Size = UDim2.new(1 / #PRESETS, -6, 1, 0)
				b.LayoutOrder = i
			end
			Common.segmented(body, (function()
				local labels = {}
				for _, s in ipairs(SECTIONS) do
					labels[#labels + 1] = s.label
				end
				return labels
			end)(), (function()
				for _, s in ipairs(SECTIONS) do
					if s.key == W.paintSection then
						return s.label
					end
				end
				return "Primary"
			end)(), function(label)
				for _, s in ipairs(SECTIONS) do
					if s.label == label then
						W.paintSection = s.key
					end
				end
				draw()
			end, { label = "Section to paint" })
			local pal = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, body)
			UiKit.grid(pal, UDim2.new(0, 40, 0, 32), 6)
			for _, hex in ipairs(PALETTE) do
				local b = UiKit.inst("TextButton", { BackgroundColor3 = Common.hexcolor(hex, C.carbon800), Text = "", BorderSizePixel = 0, AutoButtonColor = true }, pal)
				UiKit.corner(b, 6)
				UiKit.stroke(b, C.carbon600, 1)
				b.MouseButton1Click:Connect(function()
					W.paint[W.paintSection] = hex
					draw()
				end)
			end
		elseif step == 3 then
			Common.segmented(body, ENGINES, W.engineSupplier, function(v)
				W.engineSupplier = v
				draw()
			end, { label = "Engine supplier" })
			UiKit.label(body, "Engine choice affects power, reliability and development focus.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16) })
			local ph = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, body)
			UiKit.grid(ph, UDim2.new(0.5, -4, 0, 40), 6)
			for _, p in ipairs(PHILOSOPHIES) do
				local active = W.philosophy == p
				UiKit.button(ph, p, function()
					W.philosophy = p
					draw()
				end, { variant = active and "teal" or "subtle", height = 40, textSize = 12 })
			end
		else
			local card = UiKit.inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, body)
			UiKit.corner(card, 8)
			UiKit.list(card, { gap = 8 })
			UiKit.pad(card, 14)
			local top = UiKit.hrow(card, 52, 12)
			local badge = Common.teamBadge(top, { abbreviation = W.abbreviation, colors = { primary = W.paint.primary, accent = W.paint.accent } }, 48)
			UiKit.label(top, W.name, { font = UiKit.FONT_DISPLAY, size = 18, color = C.white, size2 = UDim2.new(1, -60, 0, 24) }).Position = UDim2.new(0, 60, 0, 4)
			UiKit.label(top, string.format("%s · %s · %s", W.shortName, W.nationality, W.headquarters), { size = 12, color = C.gray400, size2 = UDim2.new(1, -60, 0, 18) }).Position = UDim2.new(0, 60, 0, 28)
			Common.kvGrid(card, {
				{ "Engine", W.engineSupplier },
				{ "Philosophy", W.philosophy },
				{ "Number style", W.numberStyle },
				{ "Grid status", "New entrant" },
			}, 2)
		end

		local nav = UiKit.inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 36) }, content)
		local back = UiKit.button(nav, "< Back", function()
			W.step = math.max(1, W.step - 1)
			draw()
		end, { variant = "ghost", width = 100, height = 36 })
		back.Position = UDim2.new(0, 0, 0, 0)
		if W.step < 4 then
			local nxt = UiKit.button(nav, "Continue >", function()
				if W.step == 1 and not validIdentity() then
					ctx.toast("error", "Enter a name, short name and 3-letter abbreviation.")
					return
				end
				W.step = math.min(4, W.step + 1)
				draw()
			end, { variant = "primary", width = 130, height = 36 })
			nxt.AnchorPoint = Vector2.new(1, 0)
			nxt.Position = UDim2.new(1, 0, 0, 0)
		else
			local create = UiKit.button(nav, "Create team", function()
				if not validIdentity() then
					ctx.toast("error", "Enter a name, short name and 3-letter abbreviation.")
					return
				end
				local p = W.paint
				local extra, err = ctx.state.applyAction({
					type = "create-team",
					userId = ctx.state.user.id,
					request = {
						name = W.name,
						shortName = W.shortName,
						abbreviation = W.abbreviation,
						nationality = W.nationality,
						headquarters = W.headquarters,
						engineSupplier = W.engineSupplier,
						philosophy = W.philosophy,
						numberStyle = W.numberStyle,
						colors = { primary = p.primary, secondary = p.secondary, accent = p.accent },
						livery = {
							nose = p.nose, frontWing = p.frontWing, sidepod = p.sidepod,
							engineCover = p.engineCover, rearWing = p.rearWing,
							accentStripe = p.accentStripe, halo = p.halo,
						},
						logo = { symbol = "bolt", background = p.secondary },
					},
				})
				if err then
					ctx.toast("error", err)
					return
				end
				ctx.toast("success", "Team created. Welcome to the grid.")
				reset()
			end, { variant = "primary", width = 140, height = 36 })
			create.AnchorPoint = Vector2.new(1, 0)
			create.Position = UDim2.new(1, 0, 0, 0)
		end

		local aside = UiKit.Panel(content, { title = "Live livery preview" })
		Common.carPreview(aside, W.paint, W.abbreviation, 180)
		UiKit.label(aside, "Team names and abbreviations must be unique within the lobby.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16), wrap = true })
	end
	draw()
end

return TeamWizard
