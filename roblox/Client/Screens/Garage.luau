local ScreenGui = script.Parent.Parent.Parent
local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local Career = require(game:GetService("ReplicatedStorage"):WaitForChild("F1Game").Shared.Career)
local Car = require(game:GetService("ReplicatedStorage"):WaitForChild("F1Game").Shared.Engine.Car)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local PARTS = { "frontWing", "rearWing", "rideHeight", "brakeBias", "differential" }

local PART_META = {
	frontWing = { label = "Front wing", blurb = "Front-end aero load. Sharpens turn-in but adds drag.", low = "Trimmed", high = "Max attack", unit = "" },
	rearWing = { label = "Rear wing", blurb = "Rear grip and stability. Bigger wing costs straight-line speed.", low = "Low drag", high = "Max downforce", unit = "" },
	rideHeight = { label = "Ride height", blurb = "Lower height boosts ground effect; higher helps compliance.", low = "Low / aggressive", high = "High / compliant", unit = "" },
	brakeBias = { label = "Brake bias", blurb = "Front-to-rear braking balance.", low = "Rearward", high = "Forward", unit = "%" },
	differential = { label = "Differential", blurb = "Locking aids traction out of corners but blunts rotation.", low = "Open", high = "Fully locked", unit = "" },
}

local TONE = { good = C.raceGreen, warn = C.raceAmber, bad = C.raceRed }

local draft = nil
local styleDraft = nil

local function starterSetup(saved)
	if saved and Car.hasDetailedSetup(saved) then
		return Car.sanitizeSetup(saved)
	end
	local downforce = (saved and saved.downforce) or 3
	local balance = (saved and saved.balance) or 0
	local base = {}
	for k, v in pairs(Car.NEUTRAL_SETUP) do
		base[k] = v
	end
	local wings = Car.wingFromAxes(downforce, balance)
	base.frontWing = wings.frontWing
	base.rearWing = wings.rearWing
	base.downforce = downforce
	base.balance = balance
	return Car.sanitizeSetup(base)
end

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

local function styleFromTeam(team)
	local l = team.livery
	return {
		frontWing = l.frontWingStyle or "swept",
		rearWing = l.rearWingStyle or "swept",
		sidepod = l.sidepodStyle or "tapered",
		nose = l.noseStyle or "slender",
		halo = l.haloStyle or "standard",
	}
end

local function describeTarget(name, ideal)
	local df = ideal.downforce >= 4 and "a high-downforce" or (ideal.downforce <= 2 and "a low-downforce" or "a balanced")
	local ride = ideal.rideHeight <= 4 and "run the car low for ground effect" or (ideal.rideHeight >= 7 and "keep the ride height up for compliance" or "a mid ride height works well")
	local brake = ideal.brakeBias >= 60 and "bias the brakes forward" or (ideal.brakeBias <= 56 and "run a more rearward brake bias" or "keep the brake bias near even")
	return string.format("%s rewards %s setup. Engineer's read: %s and %s.", name, df, ride, brake)
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then
		return
	end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then
		return
	end
	local circuit = Common.circuit(bundle.weekend.circuitId)
	local savedSetup = (bundle.setups[myTeamId] and bundle.setups[myTeamId].setup) or nil
	local current = draft or starterSetup(savedSetup)
	local dirty = draft ~= nil

	local baseStyle = styleFromTeam(team)
	local currentStyle = copy(baseStyle)
	if styleDraft then
		for k, v in pairs(styleDraft) do
			currentStyle[k] = v
		end
	end

	local ideal = Car.idealSetup(circuit)
	local breakdown = Car.setupBreakdown(current, circuit)
	local aeroSeconds = breakdown.rows[1].seconds + breakdown.rows[2].seconds
	local axes = Car.deriveAxes(current.frontWing, current.rearWing)
	local penalty = Car.setupPenalty(current, circuit)
	local balanceWord = current.balance < 0 and "oversteer" or (current.balance > 0 and "understeer" or "neutral")

	local function setPart(part, value)
		local copyCur = copy(current)
		copyCur[part] = value
		draft = Car.sanitizeSetup(copyCur)
		ctx.shell.rebuild()
	end

	Common.sectionHeading(parent, "Car Setup Studio", "Tune every aero and mechanical part of the car. Changes are free and feed straight into practice, qualifying and the race.")

	local stats = UiKit.hrow(parent, 78, 10)
	local tonePenalty = penalty < 0.25 and TONE.good or (penalty < 1 and TONE.warn or TONE.bad)
	local s1 = UiKit.Stat(stats, { label = "Circuit", value = circuit.name, hint = string.format("%s · aero %d/100", circuit.location, math.floor(circuit.aeroDemand * 100 + 0.5)) })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Setup error", value = string.format("+%.2fs", penalty), hint = "Lap-time penalty vs the perfect setup", accent = tonePenalty })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Aero load", value = string.format("%d / 5", axes.downforce), hint = string.format("Target %d / 5", ideal.downforce) })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Aero balance", value = balanceWord, hint = string.format("Target %+d", ideal.balance) })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 14)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.55, -7, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 14 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.45, -7, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 14 })
	right.Position = UDim2.new(0.55, 7, 0, 0)

	local previewBody = UiKit.Panel(left, {
		title = "Chassis preview",
		right = UiKit.label(nil, "Live — reflects your setup", { size = 11, color = C.gray500 }),
	})
	local paint = paintFromTeam(team)
	local stage = inst("Frame", { BackgroundColor3 = C.carbon800, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 292) }, previewBody)
	UiKit.corner(stage, 10)
	UiKit.stroke(stage, C.carbon700, 1)
	local stageGradient = inst("UIGradient", { Rotation = 90 }, stage)
	stageGradient.Color = ColorSequence.new(Color3.fromRGB(26, 31, 41), Color3.fromRGB(13, 16, 22))
	local midLine = inst("Frame", { BackgroundColor3 = C.carbon700, BackgroundTransparency = 0.55, BorderSizePixel = 0, Size = UDim2.new(0, 1, 1, -24) }, stage)
	midLine.Position = UDim2.new(0.5, 0, 0, 12)
	local midDot = inst("Frame", { BackgroundColor3 = C.carbon700, BackgroundTransparency = 0.55, BorderSizePixel = 0, Size = UDim2.new(1, -24, 0, 1) }, stage)
	midDot.Position = UDim2.new(0, 12, 0.5, 0)
	local carHolder = Common.carPreview(stage, paint, team.abbreviation, 268)
	carHolder.Position = UDim2.new(0, 0, 0, 12)

	local miniWrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 54) }, previewBody)
	UiKit.grid(miniWrap, UDim2.new(0.25, -6, 0, 54), 8)
	local function mini(label, value)
		local cell = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.3, BorderSizePixel = 0, Size = UDim2.new(1, 0, 1, 0) }, miniWrap)
		UiKit.corner(cell, 8)
		UiKit.list(cell, { gap = 1, pad = 8 })
		UiKit.label(cell, string.upper(label), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		UiKit.label(cell, value, { font = UiKit.FONT_MONO, size = 14, color = C.gray200, size2 = UDim2.new(1, 0, 0, 18) })
		return cell
	end
	mini("Front wing", string.format("%d / 10", current.frontWing))
	mini("Rear wing", string.format("%d / 10", current.rearWing))
	mini("Ride height", string.format("%d / 10", current.rideHeight))
	mini("Brake bias", string.format("%d%% front", current.brakeBias))

	local btnRow = UiKit.hrow(previewBody, 36, 8)
	local saveBtn = UiKit.button(btnRow, "Save setup", function()
		UiKit.enable(saveBtn, false)
		State.applyAction({ type = "set-setup", teamId = myTeamId, setup = Car.sanitizeSetup(current) })
		draft = nil
		ctx.toast("success", "Car setup saved")
		ctx.shell.rebuild()
	end, { variant = "primary", width = 128, height = 36, textSize = 13 })
	UiKit.enable(saveBtn, dirty)
	UiKit.button(btnRow, "Engineer's target", function()
		draft = Car.sanitizeSetup(ideal)
		ctx.shell.rebuild()
	end, { variant = "subtle", width = 146, height = 36, textSize = 13 })
	local revert = UiKit.button(btnRow, "Revert", function()
		draft = nil
		ctx.shell.rebuild()
	end, { variant = "subtle", width = 84, height = 36, textSize = 13 })
	UiKit.enable(revert, dirty)

	UiKit.label(previewBody, dirty and string.format("Unsaved changes — currently %.2fs off ideal.", penalty) or "Setup is saved. Changes are free and take effect immediately.", {
		size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 16),
	})

	local bodyBody = UiKit.Panel(left, { title = "Bodywork" })
	UiKit.label(bodyBody, "Cosmetic only — switch the shape of each part. Performance still comes from the setup.", { size = 12, color = C.gray500, size2 = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, wrap = true, y = Enum.TextYAlignment.Top })
	local function styleRow(label, options, key)
		local holder = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, bodyBody)
		UiKit.list(holder, { gap = 6 })
		UiKit.label(holder, label, { size = 13, color = C.gray300, size2 = UDim2.new(1, 0, 0, 18) })
		Common.segmented(holder, options, currentStyle[key], function(v)
			styleDraft = styleDraft or {}
			styleDraft[key] = v
			ctx.shell.rebuild()
		end, { perRow = #options })
		return holder
	end
	styleRow("Front wing", { "swept", "straight", "multi" }, "frontWing")
	styleRow("Rear wing", { "swept", "box", "biplane" }, "rearWing")
	styleRow("Sidepods", { "tapered", "wide", "tunnel" }, "sidepod")
	styleRow("Nose", { "slender", "thumb", "blunt" }, "nose")
	styleRow("Halo", { "standard", "aero" }, "halo")

	local styleRowButtons = UiKit.hrow(bodyBody, 36, 8)
	local styleBtn = UiKit.button(styleRowButtons, "Save bodywork", function()
		UiKit.enable(styleBtn, false)
		local livery = copy(team.livery)
		livery.frontWingStyle = currentStyle.frontWing
		livery.rearWingStyle = currentStyle.rearWing
		livery.sidepodStyle = currentStyle.sidepod
		livery.noseStyle = currentStyle.nose
		livery.haloStyle = currentStyle.halo
		State.applyAction({ type = "update-team", teamId = myTeamId, patch = { livery = livery } })
		styleDraft = nil
		ctx.toast("success", "Bodywork updated")
		ctx.shell.rebuild()
	end, { variant = "primary", width = 146, height = 36, textSize = 13 })
	UiKit.enable(styleBtn, styleDraft ~= nil)
	local styleRevert = UiKit.button(styleRowButtons, "Revert", function()
		styleDraft = nil
		ctx.shell.rebuild()
	end, { variant = "subtle", width = 84, height = 36, textSize = 13 })
	UiKit.enable(styleRevert, styleDraft ~= nil)

	local timeBody = UiKit.Panel(left, { title = "Where the time is" })
	for _, r in ipairs(breakdown.rows) do
		local tone = r.seconds < 0.15 and TONE.good or (r.seconds < 0.5 and TONE.warn or TONE.bad)
		local head = UiKit.hrow(timeBody, 20, 0)
		UiKit.label(head, r.label, { size = 13, color = C.gray400, size2 = UDim2.new(0.6, 0, 1, 0) })
		UiKit.label(head, r.seconds < 0.005 and "on target" or string.format("+%.2fs", r.seconds), {
			font = UiKit.FONT_MONO, size = 12, color = tone, size2 = UDim2.new(0.4, 0, 1, 0), x = Enum.TextXAlignment.Right,
		})
		UiKit.Progress(timeBody, { value = math.min(r.seconds, 1), max = 1, color = tone, size2 = UDim2.new(1, 0, 0, 6) })
		UiKit.label(timeBody, string.format("you %s · target %s", tostring(r.value), tostring(r.ideal)), { size = 10, color = C.gray600, size2 = UDim2.new(1, 0, 0, 14) })
	end
	UiKit.divider(timeBody)
	local totalRow = UiKit.hrow(timeBody, 26, 0)
	UiKit.label(totalRow, "Total setup penalty", { size = 13, color = C.gray400, size2 = UDim2.new(0.6, 0, 1, 0) })
	UiKit.label(totalRow, string.format("+%.2fs / lap", breakdown.total), {
		font = UiKit.FONT_MONO, size = 14, color = tonePenalty, size2 = UDim2.new(0.4, 0, 1, 0), x = Enum.TextXAlignment.Right,
	})

	local ctrlBody = UiKit.Panel(right, { title = "Garage controls", gap = 16 })
	for _, part in ipairs(PARTS) do
		local meta = PART_META[part]
		local range = Car.SETUP_RANGES[part]
		local value = current[part]
		local target = ideal[part]
		local seconds = (part == "frontWing" or part == "rearWing") and aeroSeconds or 0
		if part ~= "frontWing" and part ~= "rearWing" then
			for _, r in ipairs(breakdown.rows) do
				if r.part == part then
					seconds = r.seconds
				end
			end
		end
		local off = math.abs(value - target)
		local tone = off <= 0.5 and TONE.good or (off <= 2 and TONE.warn or TONE.bad)

		local holder = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, ctrlBody)
		UiKit.list(holder, { gap = 6 })
		local head = UiKit.hrow(holder, 22, 0)
		UiKit.label(head, meta.label, { size = 14, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(0.5, 0, 1, 0) })
		UiKit.label(head, string.format("%s%s   %s", tostring(value), meta.unit, seconds < 0.005 and "on target" or string.format("+%.2fs", seconds)), {
			font = UiKit.FONT_MONO, size = 11, color = tone, size2 = UDim2.new(0.5, 0, 1, 0), x = Enum.TextXAlignment.Right,
		})

		local sliderRow = UiKit.hrow(holder, 28, 8)
		local sliderLayout = sliderRow:FindFirstChildOfClass("UIListLayout")
		if sliderLayout then
			sliderLayout.VerticalAlignment = Enum.VerticalAlignment.Center
		end
		local minus = UiKit.button(sliderRow, "−", function()
			setPart(part, math.clamp(value - range.step, range.min, range.max))
		end, { variant = "subtle", width = 28, height = 28, textSize = 16 })
		minus.LayoutOrder = 1
		local track = inst("Frame", {
			BackgroundColor3 = C.carbon700, BorderSizePixel = 0, Size = UDim2.new(1, -72, 0, 10), LayoutOrder = 2,
		}, sliderRow)
		track.Size = UDim2.new(1, -72, 0, 10)
		UiKit.corner(track, 5)
		local alpha = (value - range.min) / (range.max - range.min)
		inst("Frame", { Name = "Fill", BackgroundColor3 = C.raceTeal, BorderSizePixel = 0, Size = UDim2.new(alpha, 0, 1, 0) }, track)
		local tick = inst("Frame", { BackgroundColor3 = C.white, BorderSizePixel = 0, Size = UDim2.new(0, 2, 0, 20), AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new((target - range.min) / (range.max - range.min), 0, 0.5, 0) }, track)
		tick.ZIndex = 3
		local clickArea = inst("TextButton", {
			BackgroundTransparency = 1, Text = "", Size = UDim2.new(1, 0, 0, 28), Position = UDim2.new(0, 0, 0.5, -14), ZIndex = 4,
		}, track)
		clickArea.MouseButton1Click:Connect(function()
			local mouse = game:GetService("UserInputService"):GetMouseLocation()
			local rel = (mouse.X - track.AbsolutePosition.X) / math.max(1, track.AbsoluteSize.X)
			rel = math.clamp(rel, 0, 1)
			local raw = range.min + rel * (range.max - range.min)
			local stepped = math.floor((raw - range.min) / range.step + 0.5) * range.step + range.min
			setPart(part, math.clamp(stepped, range.min, range.max))
		end)
		local plus = UiKit.button(sliderRow, "+", function()
			setPart(part, math.clamp(value + range.step, range.min, range.max))
		end, { variant = "subtle", width = 28, height = 28, textSize = 16 })
		plus.LayoutOrder = 3

		local ends = UiKit.hrow(holder, 14, 0)
		UiKit.label(ends, meta.low, { size = 10, color = C.gray600, size2 = UDim2.new(0.3, 0, 1, 0) })
		UiKit.label(ends, meta.blurb, { size = 10, color = C.gray500, size2 = UDim2.new(0.4, 0, 1, 0), x = Enum.TextXAlignment.Center })
		UiKit.label(ends, meta.high, { size = 10, color = C.gray600, size2 = UDim2.new(0.3, 0, 1, 0), x = Enum.TextXAlignment.Right })
	end

	local notesBody = UiKit.Panel(right, { title = "Engineer notes" })
	UiKit.label(notesBody, describeTarget(circuit.name, ideal), { size = 12, color = C.gray300, size2 = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, wrap = true, y = Enum.TextYAlignment.Top })
	UiKit.label(notesBody, "• Setup error costs lap time in every session — refine it after practice, which converges the suggestion toward the ideal.\n• Wings trade downforce for straight-line speed; end-of-straight grip is worth more on aero-heavy circuits.\n• Lower ride height unlocks ground-effect downforce but rewards a smooth, compliant car.", {
		size = 12, color = C.gray400, size2 = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, wrap = true, y = Enum.TextYAlignment.Top,
	})
end
