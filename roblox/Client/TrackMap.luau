-- Client track map: fitted, continuous circuit outline with live markers.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Config = require(ReplicatedStorage.F1Game.Shared.Config)
local TrackGeometry = require(ReplicatedStorage.F1Game.Shared.Engine.TrackGeometry)

local C = Config.Colors
local TrackMap = {}

local states = setmetatable({}, { __mode = "k" })

local function hexcolor(s, fallback)
	if type(s) == "string" then
		local ok, c = pcall(Color3.fromHex, "#" .. s:gsub("^#", ""))
		if ok then
			return c
		end
	end
	return fallback
end
TrackMap.hexcolor = hexcolor

local function segment(canvas, p, q, thickness, color, transparency, z)
	local dx, dy = q.x - p.x, q.y - p.y
	local len = math.sqrt(dx * dx + dy * dy)
	if len < 0.5 then
		return
	end
	local f = Instance.new("Frame")
	f.BackgroundColor3 = color
	f.BackgroundTransparency = transparency or 0
	f.BorderSizePixel = 0
	f.AnchorPoint = Vector2.new(0.5, 0.5)
	f.Size = UDim2.new(0, len + 0.8, 0, thickness)
	f.Position = UDim2.new(0, (p.x + q.x) / 2, 0, (p.y + q.y) / 2)
	f.Rotation = math.deg(math.atan2(dy, dx))
	f.ZIndex = z or 2
	f.Parent = canvas
	local rc = Instance.new("UICorner")
	rc.CornerRadius = UDim.new(0.5, 0)
	rc.Parent = f
	return f
end

local function dot(parent, x, y, size, color, z, transparency)
	local d = Instance.new("Frame")
	d.BackgroundColor3 = color
	d.BackgroundTransparency = transparency or 0
	d.BorderSizePixel = 0
	d.AnchorPoint = Vector2.new(0.5, 0.5)
	d.Size = UDim2.new(0, size, 0, size)
	d.Position = UDim2.new(0, x, 0, y)
	d.ZIndex = z or 4
	d.Parent = parent
	local rc = Instance.new("UICorner")
	rc.CornerRadius = UDim.new(0.5, 0)
	rc.Parent = d
	return d
end

local function drawRoad(state, abs)
	local canvas = state.canvas
	for _, ch in ipairs(canvas:GetChildren()) do
		ch:Destroy()
	end
	local circuit = state.circuit
	if not circuit or abs.X < 40 or abs.Y < 40 then
		return
	end

	local roadW = math.clamp(12 + abs.Y * 0.012, 13, 17)
	local ok, geo = pcall(TrackGeometry.getTrack, circuit, abs.X, abs.Y, 20, roadW)
	if not ok or not geo then
		return
	end
	state.geo = geo

	local points = geo.dense
	local n = #points
	local target = math.clamp(math.floor(geo.totalLength / 5), 120, 300)
	local step = math.max(1, math.floor(n / target))
	local function at(i)
		return points[((i - 1) % n) + 1]
	end

	for i = 1, n, step do
		local p = at(i)
		local q = at(i + step)
		segment(canvas, { x = p.x, y = p.y + 3 }, { x = q.x, y = q.y + 3 }, roadW + 8, Color3.new(0, 0, 0), 0.55, 1)
	end
	for i = 1, n, step do
		local p = at(i)
		local q = at(i + step)
		segment(canvas, p, q, roadW + 2.2, C.gray300, 0.86, 2)
	end
	for i = 1, n, step do
		local p = at(i)
		local q = at(i + step)
		segment(canvas, p, q, roadW, C.carbon500, 0, 3)
	end
	-- Dashed centre line.
	for i = 1, n, step do
		if math.floor(i / step) % 6 < 3 then
			local p = at(i)
			local q = at(i + step)
			segment(canvas, p, q, 1.2, C.gray400, 0.55, 4)
		end
	end

	if circuit.sectors then
		for _, s in ipairs(circuit.sectors) do
			local pt = geo.pointAt(s["end"])
			dot(canvas, pt.x, pt.y, 5, C.raceAmber, 5, 0.15)
		end
	end

	-- Checkered start/finish line, rotated with the track.
	local start = geo.start
	local ang = math.deg(geo.startAngle or 0)
	local bar = Instance.new("Frame")
	bar.BackgroundColor3 = Color3.new(1, 1, 1)
	bar.BorderSizePixel = 0
	bar.AnchorPoint = Vector2.new(0.5, 0.5)
	bar.Size = UDim2.new(0, roadW + 3, 0, 6)
	bar.Position = UDim2.new(0, start.x, 0, start.y)
	bar.Rotation = ang
	bar.ZIndex = 6
	bar.Parent = canvas
	local barCorner = Instance.new("UICorner")
	barCorner.CornerRadius = UDim.new(0, 1)
	barCorner.Parent = bar
	for i = 0, 3 do
		if i % 2 == 0 then
			local sq = Instance.new("Frame")
			sq.BackgroundColor3 = C.carbon950
			sq.BorderSizePixel = 0
			sq.AnchorPoint = Vector2.new(0.5, 0.5)
			sq.Size = UDim2.new(0, (roadW + 3) / 4, 0, 3)
			sq.Position = UDim2.new(0, (i - 1.5) * (roadW + 3) / 4, 0, -1.5)
			sq.ZIndex = 7
			sq.Parent = bar
		end
	end

	state.markers = Instance.new("Folder")
	state.markers.Name = "Markers"
	state.markers.Parent = canvas
end

local function drawMarkers(state, opts)
	local geo = state.geo
	if not geo or not state.markers or not state.markers.Parent then
		return
	end
	for _, ch in ipairs(state.markers:GetChildren()) do
		ch:Destroy()
	end
	local markers = opts.markers or {}
	for i, m in ipairs(markers) do
		local pt = geo.pointAt(m.progress)
		local color = hexcolor(m.color, C.white)
		local size = m.highlight and 9 or 6.5
		if m.highlight then
			local ring = dot(state.markers, pt.x, pt.y, 22, color, 8, 0.82)
			TweenService:Create(ring, TweenInfo.new(1.2, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true), {
				BackgroundTransparency = 0.55,
			}):Play()
		end
		local d = dot(state.markers, pt.x, pt.y, size, color, 9)
		local stroke = Instance.new("UIStroke")
		stroke.Color = C.carbon950
		stroke.Thickness = 1.6
		stroke.Parent = d
		if m.label then
			local label = Instance.new("TextLabel")
			label.BackgroundTransparency = 1
			label.Text = tostring(m.label)
			label.TextColor3 = C.gray200
			label.TextSize = 10
			label.Font = Enum.Font.GothamBold
			label.TextStrokeColor3 = C.carbon950
			label.TextStrokeTransparency = 0.25
			label.AnchorPoint = Vector2.new(0, 0.5)
			label.Position = UDim2.new(0, 7, 0.5, -7)
			label.Size = UDim2.new(0, 40, 0, 12)
			label.ZIndex = 10
			label.Parent = d
		end
	end
end

function TrackMap.render(parent, circuit, opts)
	opts = opts or {}
	local height = opts.height or 200
	local container = Instance.new("Frame")
	container.Name = "TrackMap"
	container.BackgroundColor3 = C.carbon950
	container.BackgroundTransparency = 0.35
	container.BorderSizePixel = 0
	container.Size = opts.size2 or UDim2.new(1, 0, 0, height)
	container.ClipsDescendants = true
	container.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = container
	local stroke = Instance.new("UIStroke")
	stroke.Color = C.carbon700
	stroke.Thickness = 1
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = container

	local tint = Instance.new("Frame")
	tint.BackgroundColor3 = C.carbon900
	tint.BackgroundTransparency = 0.55
	tint.BorderSizePixel = 0
	tint.Size = UDim2.new(1, 0, 1, 0)
	tint.Parent = container
	local tintCorner = Instance.new("UICorner")
	tintCorner.CornerRadius = UDim.new(0, 10)
	tintCorner.Parent = tint
	local grad = Instance.new("UIGradient")
	grad.Rotation = 35
	grad.Color = ColorSequence.new(C.carbon900, C.carbon950)
	grad.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.35),
		NumberSequenceKeypoint.new(1, 0.9),
	})
	grad.Parent = tint

	local canvas = Instance.new("Frame")
	canvas.Name = "Canvas"
	canvas.BackgroundTransparency = 1
	canvas.Size = UDim2.new(1, 0, 1, 0)
	canvas.ClipsDescendants = true
	canvas.Parent = container

	local state = {
		circuit = circuit,
		canvas = canvas,
		geo = nil,
		markers = nil,
		opts = opts,
	}
	states[container] = state

	local queued = false
	local function redraw()
		if queued then
			return
		end
		queued = true
		task.defer(function()
			queued = false
			if not container.Parent then
				return
			end
			drawRoad(state, container.AbsoluteSize)
			drawMarkers(state, opts)
		end)
	end

	container:GetPropertyChangedSignal("AbsoluteSize"):Connect(redraw)
	container.AncestryChanged:Connect(function()
		if not container.Parent then
			states[container] = nil
		end
	end)
	task.defer(function()
		task.wait(0.03)
		redraw()
	end)
	return container
end

function TrackMap.update(container, opts)
	local state = states[container]
	if not state then
		return
	end
	state.opts = opts or state.opts
	drawMarkers(state, state.opts or {})
end

return TrackMap
