-- Client UI kit: theme + reusable primitives mirroring src/components/ui.tsx.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Config = require(ReplicatedStorage.F1Game.Shared.Config)
local Format = require(ReplicatedStorage.F1Game.Shared.Format)

local UiKit = {}

UiKit.C = Config.Colors
UiKit.F = Format

UiKit.FONT_DISPLAY = Enum.Font.GothamBold
UiKit.FONT = Enum.Font.TitilliumWeb
UiKit.FONT_MONO = Enum.Font.RobotoMono

-- ---- animation -------------------------------------------------------------

function UiKit.tween(o, props, time, style)
	local info = TweenInfo.new(time or 0.18, style or Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	local t = TweenService:Create(o, info, props)
	t:Play()
	return t
end

function UiKit.reveal(o, delay)
	local scale = o:FindFirstChild("RevealScale")
	if not scale then
		scale = Instance.new("UIScale")
		scale.Name = "RevealScale"
		scale.Parent = o
	end
	scale.Scale = 0.985
	task.delay(delay or 0, function()
		if o.Parent then
			UiKit.tween(scale, { Scale = 1 }, 0.16)
		end
	end)
	return o
end

function UiKit.slideIn(o, fromY, time)
	local target = o.Position
	o.Position = UDim2.new(target.X.Scale, target.X.Offset, target.Y.Scale, target.Y.Offset + (fromY or 10))
	UiKit.tween(o, { Position = target }, time or 0.2)
end

-- ---- low level -------------------------------------------------------------

function UiKit.inst(className, props, parent)
	local o = Instance.new(className)
	if props then
		for k, v in pairs(props) do
			o[k] = v
		end
	end
	if parent then
		o.Parent = parent
	end
	return o
end

local inst = UiKit.inst

function UiKit.corner(o, r)
	inst("UICorner", { CornerRadius = UDim.new(0, r or 8) }, o)
	return o
end

function UiKit.stroke(o, color, thickness)
	inst("UIStroke", { Color = color or Config.Colors.carbon700, Thickness = thickness or 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, o)
	return o
end

function UiKit.pad(o, t, r, b, l)
	inst("UIPadding", {
		PaddingTop = UDim.new(0, t),
		PaddingRight = UDim.new(0, r or t),
		PaddingBottom = UDim.new(0, b or t),
		PaddingLeft = UDim.new(0, l or r or t),
	}, o)
	return o
end

function UiKit.list(parent, opts)
	opts = opts or {}
	inst("UIListLayout", {
		FillDirection = opts.dir or Enum.FillDirection.Vertical,
		Padding = UDim.new(0, opts.gap or 8),
		SortOrder = opts.sort or Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = opts.halign or Enum.HorizontalAlignment.Left,
		VerticalAlignment = opts.valign or Enum.VerticalAlignment.Top,
	}, parent)
	return parent
end

function UiKit.grid(parent, cell, gap)
	inst("UIGridLayout", {
		CellSize = cell,
		CellPadding = UDim2.new(0, gap or 8, 0, gap or 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, parent)
	return parent
end

function UiKit.clear(frame)
	for _, c in ipairs(frame:GetChildren()) do
		if not c:IsA("UILayout") and not c:IsA("UIPadding") and not c:IsA("UICorner") and not c:IsA("UIStroke") then
			c:Destroy()
		end
	end
end

function UiKit.frame(parent, props)
	return inst("Frame", props, parent)
end

function UiKit.label(parent, text, props)
	props = props or {}
	local size = math.max(11, props.size or 14)
	local base = {
		BackgroundTransparency = 1,
		Text = text,
		TextColor3 = props.color or Config.Colors.gray300,
		TextSize = size,
		Font = props.font or Enum.Font.TitilliumWeb,
		TextXAlignment = props.x or Enum.TextXAlignment.Left,
		TextYAlignment = props.y or Enum.TextYAlignment.Center,
		TextWrapped = props.wrap or false,
		TextTruncate = props.truncate or Enum.TextTruncate.None,
		RichText = props.rich or false,
		Size = props.size2 or UDim2.new(1, 0, 0, props.height or size + 6),
	}
	return inst("TextLabel", base, parent)
end

function UiKit.button(parent, text, onClick, props)
	props = props or {}
	local variant = props.variant or "ghost"
	local bg, fg, bc
	if variant == "primary" then
		bg, fg, bc = Config.Colors.raceRed, Config.Colors.white, nil
	elseif variant == "teal" then
		bg, fg, bc = Config.Colors.raceTeal, Config.Colors.carbon950, nil
	elseif variant == "subtle" then
		bg, fg, bc = Config.Colors.carbon800, Config.Colors.gray200, Config.Colors.carbon600
	elseif variant == "danger" then
		bg, fg, bc = Config.Colors.carbon900, Config.Colors.raceRed, Config.Colors.raceRed
	else
		bg, fg, bc = Config.Colors.carbon900, Config.Colors.gray300, Config.Colors.carbon600
	end
	local size = props.size2 or UDim2.new(0, props.width or 130, 0, props.height or 36)
	local b = inst("TextButton", {
		BackgroundColor3 = bg,
		BackgroundTransparency = props.transparency or 0,
		Text = text,
		TextColor3 = fg,
		TextSize = math.max(12, props.textSize or 14),
		Font = props.font or UiKit.FONT_DISPLAY,
		AutoButtonColor = false,
		BorderSizePixel = 0,
		Size = size,
		TextTruncate = Enum.TextTruncate.AtEnd,
	}, parent)
	UiKit.corner(b, props.radius or 8)
	if bc then
		UiKit.stroke(b, bc, 1)
	end
	local scale = inst("UIScale", { Name = "PressScale" }, b)
	local hover = bg:Lerp(Color3.new(1, 1, 1), 0.10)
	local idle = bg
	b.MouseEnter:Connect(function()
		if b.Active then
			UiKit.tween(b, { BackgroundColor3 = hover }, 0.12)
			UiKit.tween(scale, { Scale = 1.02 }, 0.12)
		end
	end)
	b.MouseLeave:Connect(function()
		UiKit.tween(b, { BackgroundColor3 = idle }, 0.14)
		UiKit.tween(scale, { Scale = 1 }, 0.14)
	end)
	b.MouseButton1Down:Connect(function()
		if b.Active then
			UiKit.tween(scale, { Scale = 0.96 }, 0.08)
		end
	end)
	b.MouseButton1Up:Connect(function()
		if b.Active then
			UiKit.tween(scale, { Scale = 1.02 }, 0.1)
		end
	end)
	if props.enabled == false then
		b.Active = false
		b.TextColor3 = Config.Colors.gray600
		b.BackgroundTransparency = 0.4
	end
	if onClick then
		b.MouseButton1Click:Connect(function()
			if b.Active then
				onClick()
			end
		end)
	end
	return b
end

function UiKit.enable(b, on)
	b.Active = on and true or false
	b.Selectable = on and true or false
	b.TextTransparency = on and 0 or 0.45
	if on then
		b.BackgroundTransparency = 0
	else
		b.BackgroundTransparency = 0.4
	end
end

function UiKit.textbox(parent, props)
	props = props or {}
	local t = inst("TextBox", {
		BackgroundColor3 = Config.Colors.carbon900,
		BackgroundTransparency = 0.2,
		Text = props.text or "",
		PlaceholderText = props.placeholder or "",
		PlaceholderColor3 = Config.Colors.gray600,
		TextColor3 = Config.Colors.gray200,
		TextSize = props.textSize or 14,
		Font = Enum.Font.TitilliumWeb,
		ClearTextOnFocus = false,
		TextXAlignment = props.x or Enum.TextXAlignment.Left,
		BorderSizePixel = 0,
		Size = props.size2 or UDim2.new(1, 0, 0, 36),
	}, parent)
	UiKit.corner(t, 8)
	UiKit.stroke(t, Config.Colors.carbon600, 1)
	UiKit.pad(t, 0, 12, 0, 12)
	return t
end

function UiKit.divider(parent)
	return inst("Frame", {
		BackgroundColor3 = Config.Colors.carbon700,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 1),
	}, parent)
end

-- ---- components ------------------------------------------------------------

function UiKit.Panel(parent, opts)
	opts = opts or {}
	local outer = inst("Frame", {
		Name = opts.name or "Panel",
		BackgroundColor3 = Config.Colors.carbon850,
		BackgroundTransparency = 0.06,
		BorderSizePixel = 0,
		Size = opts.height and UDim2.new(1, 0, 0, opts.height) or UDim2.new(1, 0, 0, 0),
	}, parent)
	if not opts.height then
		outer.AutomaticSize = Enum.AutomaticSize.Y
	end
	UiKit.corner(outer, 12)
	UiKit.stroke(outer, Config.Colors.carbon700, 1)
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 0),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, outer)

	if opts.title or opts.right then
		local head = inst("Frame", {
			BackgroundTransparency = 1,
			Size = UDim2.new(1, 0, 0, 46),
			LayoutOrder = 0,
		}, outer)
		UiKit.pad(head, 0, 16, 0, 16)
		UiKit.label(head, string.upper(opts.title or ""), {
			font = UiKit.FONT_DISPLAY,
			size = 14,
			color = Config.Colors.gray100,
			size2 = UDim2.new(1, -20, 1, 0),
		})
		if opts.right then
			opts.right.Parent = head
			opts.right.AnchorPoint = Vector2.new(1, 0.5)
			opts.right.Position = UDim2.new(1, 0, 0.5, 0)
		end
		local div = inst("Frame", {
			BackgroundColor3 = Config.Colors.carbon700,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 0, 1),
			LayoutOrder = 1,
		}, outer)
		div.Position = UDim2.new(0, 0, 1, -1)
	end

	local headH = (opts.title or opts.right) and 47 or 0
	local body
	if opts.height then
		body = inst("ScrollingFrame", {
			BackgroundTransparency = 1,
			Size = UDim2.new(1, 0, 1, -headH),
			Position = UDim2.new(0, 0, 0, headH),
			BorderSizePixel = 0,
			ScrollBarThickness = 4,
			ScrollBarImageColor3 = Config.Colors.carbon600,
			CanvasSize = UDim2.new(0, 0, 0, 0),
			AutomaticCanvasSize = Enum.AutomaticSize.Y,
			LayoutOrder = 2,
		}, outer)
	else
		body = inst("Frame", {
			BackgroundTransparency = 1,
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			LayoutOrder = 2,
		}, outer)
	end
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, opts.gap or 10),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, body)
	UiKit.pad(body, opts.pad or 16)
	UiKit.reveal(outer)
	return body, outer
end

function UiKit.Stat(parent, opts)
	local card = inst("Frame", {
		BackgroundColor3 = Config.Colors.carbon900,
		BackgroundTransparency = 0.25,
		BorderSizePixel = 0,
		Size = opts.size2 or UDim2.new(1, 0, 0, 82),
	}, parent)
	UiKit.corner(card, 10)
	UiKit.stroke(card, Config.Colors.carbon700, 1)
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 2),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}, card)
	UiKit.pad(card, 12)
	UiKit.label(card, string.upper(opts.label or ""), {
		font = Enum.Font.TitilliumWeb,
		size = 11,
		color = Config.Colors.gray400,
		size2 = UDim2.new(1, 0, 0, 14),
		LayoutOrder = 0,
	})
	UiKit.label(card, tostring(opts.value), {
		font = UiKit.FONT_MONO,
		size = opts.valueSize or 22,
		color = opts.accent or Config.Colors.white,
		size2 = UDim2.new(1, 0, 0, 26),
		LayoutOrder = 1,
		truncate = Enum.TextTruncate.AtEnd,
	})
	if opts.hint then
		UiKit.label(card, opts.hint, {
			size = 11,
			color = Config.Colors.gray500,
			size2 = UDim2.new(1, 0, 0, 14),
			LayoutOrder = 2,
			truncate = Enum.TextTruncate.AtEnd,
		})
	end
	return card
end

UiKit.TONES = {
	default = { bg = Config.Colors.carbon800, fg = Config.Colors.gray300, bc = Config.Colors.carbon600 },
	good = { bg = Config.Colors.carbon900, fg = Config.Colors.raceGreen, bc = Config.Colors.raceGreen },
	warn = { bg = Config.Colors.carbon900, fg = Config.Colors.raceAmber, bc = Config.Colors.raceAmber },
	bad = { bg = Config.Colors.carbon900, fg = Config.Colors.raceRed, bc = Config.Colors.raceRed },
	info = { bg = Config.Colors.carbon900, fg = Config.Colors.raceBlue, bc = Config.Colors.raceBlue },
	teal = { bg = Config.Colors.carbon900, fg = Config.Colors.raceTeal, bc = Config.Colors.raceTeal },
}

function UiKit.Badge(parent, text, tone, props)
	props = props or {}
	local t = UiKit.TONES[tone or "default"]
	local b = inst("TextLabel", {
		BackgroundColor3 = t.bg,
		BackgroundTransparency = 0.2,
		Text = tostring(text),
		TextColor3 = t.fg,
		TextSize = 11,
		Font = Enum.Font.GothamBold,
		BorderSizePixel = 0,
		AutomaticSize = Enum.AutomaticSize.X,
		Size = UDim2.new(0, 0, 0, props.height or 20),
	}, parent)
	UiKit.corner(b, 10)
	UiKit.stroke(b, t.bc, 1)
	UiKit.pad(b, 0, 9, 0, 9)
	return b
end

function UiKit.Progress(parent, opts)
	local track = inst("Frame", {
		BackgroundColor3 = Config.Colors.carbon700,
		BorderSizePixel = 0,
		Size = opts.size2 or UDim2.new(1, 0, 0, 7),
	}, parent)
	UiKit.corner(track, 4)
	local max = opts.max or 100
	local pct = math.clamp((opts.value or 0) / max, 0, 1)
	local fill = inst("Frame", {
		BackgroundColor3 = opts.color or Config.Colors.raceTeal,
		BorderSizePixel = 0,
		Size = UDim2.new(0, 0, 1, 0),
	}, track)
	UiKit.corner(fill, 4)
	UiKit.tween(fill, { Size = UDim2.new(pct, 0, 1, 0) }, 0.55, Enum.EasingStyle.Quint)
	return track
end

function UiKit.SectionHeading(parent, opts)
	local box = inst("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, opts.subtitle and 52 or 36),
	}, parent)
	local row = inst("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 1, 0),
	}, box)
	inst("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }, row)
	UiKit.label(row, string.upper(opts.title), {
		font = UiKit.FONT_DISPLAY,
		size = 24,
		color = Config.Colors.white,
		size2 = UDim2.new(1, 0, 0, 30),
		LayoutOrder = 0,
	})
	if opts.subtitle then
		UiKit.label(row, opts.subtitle, { size = 13, color = Config.Colors.gray400, size2 = UDim2.new(1, 0, 0, 18), LayoutOrder = 1 })
	end
	if opts.right then
		opts.right.Parent = box
		opts.right.AnchorPoint = Vector2.new(1, 0)
		opts.right.Position = UDim2.new(1, 0, 0, 2)
	end
	UiKit.slideIn(box, 8, 0.2)
	return box
end

function UiKit.Empty(parent, opts)
	local f = inst("Frame", {
		BackgroundColor3 = Config.Colors.carbon900,
		BackgroundTransparency = 0.6,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 96),
	}, parent)
	UiKit.stroke(f, Config.Colors.carbon600, 1)
	UiKit.corner(f, 10)
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 4),
		SortOrder = Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
	}, f)
	UiKit.label(f, opts.title, { font = Enum.Font.GothamBold, size = 15, color = Config.Colors.gray200, size2 = UDim2.new(1, -20, 0, 20), x = Enum.TextXAlignment.Center, LayoutOrder = 0 })
	if opts.hint then
		UiKit.label(f, opts.hint, { size = 13, color = Config.Colors.gray500, size2 = UDim2.new(1, -20, 0, 17), x = Enum.TextXAlignment.Center, LayoutOrder = 1 })
	end
	return f
end

-- Row helpers -----------------------------------------------------------------

function UiKit.hrow(parent, height, gap)
	local f = inst("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, height),
	}, parent)
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		Padding = UDim.new(0, gap or 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
		VerticalAlignment = Enum.VerticalAlignment.Top,
	}, f)
	return f
end

function UiKit.splitH(child, count, gap, index)
	local w = 1 / count
	local px = (gap or 8) * (count - 1) / count
	child.Size = UDim2.new(w, -px, 1, 0)
	if index then
		child.LayoutOrder = index
	end
	return child
end

function UiKit.Table(parent, opts)
	opts = opts or {}
	local wrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, parent)
	inst("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, Padding = UDim.new(0, 0), SortOrder = Enum.SortOrder.LayoutOrder }, wrap)
	local columns = opts.columns or {}
	local widths = opts.widths or {}
	local function buildRow(cells, isHeader, layoutOrder)
		local row = inst("Frame", {
			BackgroundColor3 = isHeader and Config.Colors.carbon900 or Config.Colors.carbon800,
			BackgroundTransparency = isHeader and 0.35 or 0.92,
			BorderSizePixel = 0,
			Size = UDim2.new(1, 0, 0, isHeader and 36 or (opts.rowHeight or 34)),
			LayoutOrder = layoutOrder,
		}, wrap)
		UiKit.pad(row, 0, 12, 0, 12)
		if not isHeader then
			row.MouseEnter:Connect(function()
				UiKit.tween(row, { BackgroundTransparency = 0.55 }, 0.12)
			end)
			row.MouseLeave:Connect(function()
				UiKit.tween(row, { BackgroundTransparency = 0.92 }, 0.16)
			end)
		end
		inst("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, row)
		local total = 0
		for _, w in ipairs(widths) do
			total = total + w
		end
		for i, cell in ipairs(cells) do
			local w = widths[i] or ((1 - total) / math.max(1, #cells - #widths))
			local isScale = w <= 1
			UiKit.label(row, tostring(cell), {
				size = isHeader and 11 or 13,
				font = isHeader and Enum.Font.GothamBold or Enum.Font.TitilliumWeb,
				color = isHeader and Config.Colors.gray500 or Config.Colors.gray300,
				size2 = isScale and UDim2.new(w, 0, 1, 0) or UDim2.new(0, w, 1, 0),
				truncate = Enum.TextTruncate.AtEnd,
				LayoutOrder = i,
			})
		end
		return row
	end
	buildRow(columns, true, 0)
	return wrap, buildRow
end

-- Toast host -----------------------------------------------------------------

local toastHost
function UiKit.toastHost(screenGui)
	if toastHost and toastHost.Parent then
		return toastHost
	end
	toastHost = inst("Frame", {
		Name = "Toasts",
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -16, 1, -16),
		Size = UDim2.new(0, 320, 1, -32),
	}, screenGui)
	inst("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		Padding = UDim.new(0, 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
		VerticalAlignment = Enum.VerticalAlignment.Bottom,
	}, toastHost)
	return toastHost
end

function UiKit.toast(kind, message)
	if not toastHost then
		return
	end
	local tone = kind == "error" and "bad" or kind == "success" and "good" or "info"
	local t = UiKit.TONES[tone]
	local card = inst("CanvasGroup", {
		BackgroundColor3 = Config.Colors.carbon850,
		GroupTransparency = 1,
		Size = UDim2.new(1, 0, 0, 46),
	}, toastHost)
	UiKit.corner(card, 9)
	UiKit.stroke(card, t.bc, 1)
	UiKit.pad(card, 6, 12, 6, 12)
	UiKit.label(card, message, { size = 13, color = t.fg, size2 = UDim2.new(1, 0, 1, 0), wrap = true })
	local scale = inst("UIScale", { Scale = 0.96 }, card)
	UiKit.tween(card, { GroupTransparency = 0 }, 0.2)
	UiKit.tween(scale, { Scale = 1 }, 0.22, Enum.EasingStyle.Back)
	task.delay(4.0, function()
		if card and card.Parent then
			UiKit.tween(card, { GroupTransparency = 1 }, 0.2)
			task.wait(0.22)
			if card and card.Parent then
				card:Destroy()
			end
		end
	end)
end

-- Modal ----------------------------------------------------------------------

function UiKit.modal(screenGui, opts)
	opts = opts or {}
	local overlay = inst("Frame", {
		Name = "Modal",
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 1, 0),
		ZIndex = 50,
	}, screenGui)
	local panel = inst("Frame", {
		BackgroundColor3 = Config.Colors.carbon850,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.5, 0),
		Size = opts.size2 or UDim2.new(0, 560, 0, 520),
		ZIndex = 51,
	}, overlay)
	UiKit.corner(panel, 12)
	UiKit.stroke(panel, Config.Colors.carbon700, 1)
	local pscale = inst("UIScale", { Scale = 0.95 }, panel)
	inst("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, Padding = UDim.new(0, 0), SortOrder = Enum.SortOrder.LayoutOrder }, panel)
	UiKit.tween(overlay, { BackgroundTransparency = 0.45 }, 0.18)
	UiKit.tween(pscale, { Scale = 1 }, 0.2, Enum.EasingStyle.Back)
	local head = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 50), LayoutOrder = 0 }, panel)
	UiKit.label(head, string.upper(opts.title or ""), { font = UiKit.FONT_DISPLAY, size = 16, color = Config.Colors.white, size2 = UDim2.new(1, -60, 1, 0) }).Position = UDim2.new(0, 16, 0, 0)
	UiKit.divider(head).Position = UDim2.new(0, 0, 1, -1)
	local body = inst("ScrollingFrame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 1, -50),
		Position = UDim2.new(0, 0, 0, 50),
		BorderSizePixel = 0,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 5,
		ScrollBarImageColor3 = Config.Colors.carbon600,
		LayoutOrder = 1,
	}, panel)
	inst("UIListLayout", { FillDirection = Enum.FillDirection.Vertical, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, body)
	UiKit.pad(body, 16)
	local close = UiKit.button(head, "X", nil, { variant = "subtle", width = 32, height = 32, radius = 8 })
	close.AnchorPoint = Vector2.new(1, 0.5)
	close.Position = UDim2.new(1, -12, 0.5, 0)
	local dismissed = false
	local function dismiss()
		if dismissed then return end
		dismissed = true
		UiKit.tween(overlay, { BackgroundTransparency = 1 }, 0.15)
		UiKit.tween(pscale, { Scale = 0.96 }, 0.14)
		task.delay(0.16, function()
			if overlay.Parent then overlay:Destroy() end
		end)
		if opts.onClose then
			opts.onClose()
		end
	end
	close.MouseButton1Click:Connect(dismiss)
	overlay.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			dismiss()
		end
	end)
	return body, overlay
end

return UiKit
