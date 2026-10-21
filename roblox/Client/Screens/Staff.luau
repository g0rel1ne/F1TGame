local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local StaffData = require(RS.Shared.Data.Staff)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local roleFilter = "all"
local query = ""

local function filteredMarket(bundle)
	local list = {}
	local q = query:lower()
	for _, s in ipairs(bundle.staffMarket) do
		local roleOk = roleFilter == "all" or s.role == roleFilter
		local nameOk = q == "" or s.name:lower():find(q, 1, true)
		if roleOk and nameOk then
			table.insert(list, s)
		end
	end
	table.sort(list, function(a, b) return a.skill > b.skill end)
	return list
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end

	local staff = {}
	local byRole = {}
	for _, s in ipairs(bundle.staff) do
		if s.teamId == myTeamId then
			table.insert(staff, s)
			byRole[s.role] = s
		end
	end
	local market = filteredMarket(bundle)
	local wageTotal, skillSum, topSkill = 0, 0, 0
	for _, s in ipairs(staff) do
		wageTotal = wageTotal + s.wage
		skillSum = skillSum + s.skill
		if s.skill > topSkill then topSkill = s.skill end
	end
	local avgSkill = #staff > 0 and skillSum / #staff or 0
	local balance = Career.balanceOf(bundle, myTeamId)

	Common.sectionHeading(parent, "Staff", "Hire specialists to improve development, strategy, pit stops and commercial performance.")

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Annual wages", value = Format.money(wageTotal, true), hint = "Paid across the season" })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Average skill", value = string.format("%.1f", avgSkill), hint = "All employed staff" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Top specialist", value = string.format("%d", math.floor(topSkill + 0.5)), hint = "Drives development modifiers" })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Budget", value = Format.money(balance, true), hint = "Cash available", accent = balance < 0 and C.raceRed or nil })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(0.5, 6, 0, 0)

	local mineBody = UiKit.Panel(left, { title = "Your staff", right = UiKit.Badge(nil, string.format("%d/%d roles filled", #staff, #StaffData.STAFF_ROLES), "info") })
	if #staff == 0 then
		UiKit.Empty(mineBody, { title = "No staff employed", hint = "Hire from the market to unlock development and strategy bonuses." })
	else
		for _, meta in ipairs(StaffData.STAFF_ROLES) do
			local member = byRole[meta.role]
			local card = inst("Frame", { BackgroundColor3 = member and C.carbon900 or nil, BackgroundTransparency = member and 0.5 or 1, Size = UDim2.new(1, 0, 0, member and 50 or 40) }, mineBody)
			UiKit.corner(card, 8)
			UiKit.stroke(card, member and C.carbon700 or C.carbon600, 1)
			if not member then
				local stroke = card:FindFirstChildOfClass("UIStroke")
				if stroke then stroke:Destroy() end
			end
			UiKit.label(card, member and member.name or "Vacant", { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -100, 0, 16) }).Position = UDim2.new(0, 10, 0, 4)
			UiKit.label(card, string.format("%s · %s", meta.label, meta.effect), { size = 9, color = C.gray500, size2 = UDim2.new(1, -100, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 10, 0, 20)
			if member then
				UiKit.label(card, string.format("%d", member.skill), { font = UiKit.FONT_MONO, size = 12, color = C.raceTeal, size2 = UDim2.new(0, 40, 0, 16), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -84, 0, 4)
				UiKit.label(card, Format.money(member.wage, true) .. "/y", { font = UiKit.FONT_MONO, size = 9, color = C.gray500, size2 = UDim2.new(0, 54, 0, 14), x = Enum.TextXAlignment.Right }).Position = UDim2.new(1, -94, 0, 20)
				local fire = UiKit.button(card, "Fire", function()
					UiKit.enable(fire, false)
					local _, err = State.applyAction({ type = "fire-staff", teamId = myTeamId, staffId = member.id })
					ctx.toast(err and "error" or "success", err or (member.name .. " released"))
					ctx.shell.rebuild()
				end, { variant = "subtle", width = 40, height = 22, textSize = 10 })
				fire.Position = UDim2.new(1, -46, 0, 4)
				fire.TextColor3 = C.raceRed
				UiKit.Progress(card, { value = member.skill, max = 100, color = C.raceTeal, size2 = UDim2.new(1, -20, 0, 4) }).Position = UDim2.new(0, 10, 0, 42)
				UiKit.label(card, string.format("Morale %d · Age %d", math.floor(member.morale + 0.5), member.age), { size = 9, color = C.gray500, size2 = UDim2.new(1, -20, 0, 12) }).Position = UDim2.new(0, 10, 0, 46)
				card.Size = UDim2.new(1, 0, 0, 60)
			else
				local vac = UiKit.Badge(card, "Vacant", "default")
				vac.AnchorPoint = Vector2.new(1, 0.5)
				vac.Position = UDim2.new(1, -10, 0.5, 0)
			end
		end
	end

	local marketBody = UiKit.Panel(right, { title = "Staff market" })
	local toolbar = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 64) }, marketBody)
	local search = UiKit.textbox(toolbar, { placeholder = "Search staff…", text = query, size2 = UDim2.new(1, 0, 0, 30), textSize = 11 })
	search.FocusLost:Connect(function()
		query = search.Text
		ctx.shell.rebuild()
	end)
	local roleNames = { "all" }
	local roleLabels = { "All roles" }
	for _, r in ipairs(StaffData.STAFF_ROLES) do
		table.insert(roleNames, r.role)
		table.insert(roleLabels, r.label)
	end
	local currentLabel = "All roles"
	for i = 1, #roleNames do
		if roleNames[i] == roleFilter then currentLabel = roleLabels[i] end
	end
	local seg = Common.segmented(toolbar, roleLabels, currentLabel, function(label)
		for i = 1, #roleLabels do
			if roleLabels[i] == label then roleFilter = roleNames[i] end
		end
		ctx.shell.rebuild()
	end, { perRow = 4 })
	seg.Position = UDim2.new(0, 0, 0, 34)
	seg.Size = UDim2.new(1, 0, 0, 32)

	if #market == 0 then
		UiKit.Empty(marketBody, { title = "No candidates", hint = "Try another role or clear the search." })
	else
		for i = 1, math.min(24, #market) do
			local s = market[i]
			local filled = byRole[s.role] ~= nil
			local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, Size = UDim2.new(1, 0, 0, 52) }, marketBody)
			UiKit.corner(card, 8)
			UiKit.label(card, s.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -120, 0, 16) }).Position = UDim2.new(0, 10, 0, 4)
			UiKit.label(card, string.format("%s · %s · age %d", s.role:gsub("%-", " "), s.nationality, s.age), { size = 9, color = C.gray500, size2 = UDim2.new(1, -120, 0, 14), truncate = Enum.TextTruncate.AtEnd }).Position = UDim2.new(0, 10, 0, 19)
			UiKit.label(card, string.format("%s/season · skill %d · potential %d", Format.money(s.wage, true), s.skill, s.potential), { size = 9, color = C.gray500, size2 = UDim2.new(1, -120, 0, 14) }).Position = UDim2.new(0, 10, 0, 33)
			local bar = UiKit.Progress(card, { value = s.skill, max = 100, color = C.raceTeal, size2 = UDim2.new(0, 90, 0, 4) })
			bar.AnchorPoint = Vector2.new(1, 0)
			bar.Position = UDim2.new(1, -60, 0, 12)
			local hire = UiKit.button(card, filled and "Filled" or "Hire", function()
				UiKit.enable(hire, false)
				local _, err = State.applyAction({ type = "hire-staff", teamId = myTeamId, staffId = s.id })
				ctx.toast(err and "error" or "success", err or (s.name .. " hired"))
				ctx.shell.rebuild()
			end, { variant = "subtle", width = 48, height = 24, textSize = 10 })
			UiKit.enable(hire, not filled)
			hire.AnchorPoint = Vector2.new(1, 1)
			hire.Position = UDim2.new(1, -8, 1, -6)
		end
	end
	UiKit.label(marketBody, "Hiring is immediate and wages are paid per race. Each role may have only one employee at a time.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })
end
