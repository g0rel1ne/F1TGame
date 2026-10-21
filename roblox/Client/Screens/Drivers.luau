local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local DriverMarket = require(RS.Shared.Engine.DriverMarket)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local ATTRS = {
	{ key = "pace", label = "Pace" },
	{ key = "qualifying", label = "Qualifying" },
	{ key = "racecraft", label = "Racecraft" },
	{ key = "overtaking", label = "Overtaking" },
	{ key = "defending", label = "Defending" },
	{ key = "tireManagement", label = "Tyre management" },
	{ key = "wet", label = "Wet weather" },
	{ key = "consistency", label = "Consistency" },
	{ key = "concentration", label = "Concentration" },
	{ key = "aggression", label = "Aggression" },
}

local query = ""
local sort = "pace"
local busy = false

local function pressButton(parent, text, width, variant, onClick)
	return UiKit.button(parent, text, onClick, { variant = variant or "subtle", width = width, height = 26, textSize = 11 })
end

local function attrBar(parent, label, value)
	local row = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 20) }, parent)
	UiKit.label(row, label, { size = 9, color = C.gray500, size2 = UDim2.new(0.62, 0, 0, 11) })
	UiKit.label(row, tostring(value), { font = UiKit.FONT_MONO, size = 9, color = C.gray400, size2 = UDim2.new(0.38, 0, 0, 11), x = Enum.TextXAlignment.Right })
	UiKit.Progress(row, { value = value, max = 100, color = C.raceTeal, size2 = UDim2.new(1, 0, 0, 4) }).Position = UDim2.new(0, 0, 0, 12)
end

local function confirmRelease(ctx, driver)
	local body, overlay = UiKit.modal(ctx.screenGui, { title = "Release driver", size2 = UDim2.new(0, 420, 0, 190) })
	UiKit.label(body, "Release " .. driver.name .. "?", { size = 14, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, 0, 0, 22) })
	UiKit.label(body, "Termination costs may apply. The seat becomes free immediately.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 34), wrap = true, y = Enum.TextYAlignment.Top })
	local row = UiKit.hrow(body, 32, 8)
	UiKit.button(row, "Cancel", function() overlay:Destroy() end, { variant = "subtle", width = 90, height = 30 })
	UiKit.button(row, "Release", function()
		overlay:Destroy()
		busy = true
		local _, err = State.applyAction({ type = "release-driver", driverId = driver.id })
		busy = false
		if err then
			ctx.toast("error", err)
		else
			ctx.toast("success", driver.name .. " released")
		end
		ctx.shell.rebuild()
	end, { variant = "primary", width = 100, height = 30 })
end

local function openOffer(ctx, driver, team, balance)
	local expected = DriverMarket.expectedSalary(driver, team.reputation)
	local offer = {
		salary = expected,
		years = 2,
		signingBonus = 0,
		winBonus = 100000,
		podiumBonus = 50000,
		role = "second",
		performanceClausePosition = nil,
	}
	local body, overlay = UiKit.modal(ctx.screenGui, { title = "Contract offer — " .. driver.name, size2 = UDim2.new(0, 560, 0, 620) })

	local summary = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, Size = UDim2.new(1, 0, 0, 54) }, body)
	UiKit.corner(summary, 8)
	UiKit.stroke(summary, C.carbon700, 1)
	UiKit.pad(summary, 10)
	UiKit.label(summary, driver.name, { size = 13, font = Enum.Font.GothamBold, color = C.gray200, size2 = UDim2.new(0.6, 0, 0, 18) })
	UiKit.label(summary, string.format("%s · age %d · rep %d", driver.nationality, driver.age, math.floor(driver.reputation + 0.5)), { size = 10, color = C.gray500, size2 = UDim2.new(0.6, 0, 0, 18) }).Position = UDim2.new(0, 10, 0, 24)
	UiKit.label(summary, "Expected salary", { size = 10, color = C.gray500, size2 = UDim2.new(0.4, -10, 0, 16), x = Enum.TextXAlignment.Right }).Position = UDim2.new(0.6, 0, 0, 6)
	UiKit.label(summary, Format.money(expected, true), { font = UiKit.FONT_MONO, size = 14, color = C.raceTeal, size2 = UDim2.new(0.4, -10, 0, 20), x = Enum.TextXAlignment.Right }).Position = UDim2.new(0.6, 0, 0, 22)

	local refresh

	local function field(label, value, y, step)
		UiKit.label(body, label, { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
		local row = UiKit.hrow(body, 32, 6)
		local box = UiKit.textbox(row, { text = tostring(value), size2 = UDim2.new(1, -74, 0, 32), textSize = 12, x = Enum.TextXAlignment.Right })
		box.LayoutOrder = 1
		pressButton(row, "−", 30, "subtle", function()
			local n = (tonumber(box.Text) or value) - step
			box.Text = tostring(math.max(0, n))
			offer[label == "Salary / season" and "salary" or (label == "Signing bonus" and "signingBonus" or (label == "Win bonus" and "winBonus" or "podiumBonus"))] = math.max(0, n)
			refresh()
		end).LayoutOrder = 2
		pressButton(row, "+", 30, "subtle", function()
			local n = (tonumber(box.Text) or value) + step
			box.Text = tostring(math.max(0, n))
			offer[label == "Salary / season" and "salary" or (label == "Signing bonus" and "signingBonus" or (label == "Win bonus" and "winBonus" or "podiumBonus"))] = math.max(0, n)
			refresh()
		end).LayoutOrder = 3
		return box
	end

	local salaryBox = field("Salary / season", offer.salary, 0, 100000)
	salaryBox.FocusLost:Connect(function()
		offer.salary = math.max(0, tonumber(salaryBox.Text) or offer.salary)
		salaryBox.Text = tostring(offer.salary)
		refresh()
	end)
	local bonusBox = field("Signing bonus", offer.signingBonus, 0, 50000)
	bonusBox.FocusLost:Connect(function()
		offer.signingBonus = math.max(0, tonumber(bonusBox.Text) or offer.signingBonus)
		bonusBox.Text = tostring(offer.signingBonus)
		refresh()
	end)

	UiKit.label(body, "Contract years", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local yearRow = UiKit.hrow(body, 32, 6)
	local yearBtns = {}
	for _, n in ipairs({ 1, 2, 3, 4 }) do
		yearBtns[n] = UiKit.button(yearRow, tostring(n), function()
			offer.years = n
			for k = 1, 4 do
				yearBtns[k].BackgroundColor3 = k == n and C.raceTeal or C.carbon800
				yearBtns[k].TextColor3 = k == n and C.carbon950 or C.gray400
			end
			refresh()
		end, { variant = n == offer.years and "teal" or "subtle", width = 50, height = 30 })
		yearBtns[n].LayoutOrder = n
	end

	UiKit.label(body, "Role", { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	local roleRow = UiKit.hrow(body, 32, 6)
	local roleBtns = {}
	for i, pair in ipairs({ { "lead", "Team leader" }, { "second", "Second driver" }, { "development", "Development" } }) do
		roleBtns[i] = UiKit.button(roleRow, pair[2], function()
			offer.role = pair[1]
			for k = 1, 3 do
				roleBtns[k].BackgroundColor3 = k == i and C.raceTeal or C.carbon800
				roleBtns[k].TextColor3 = k == i and C.carbon950 or C.gray400
			end
			refresh()
		end, { variant = (offer.role == pair[1]) and "teal" or "subtle", width = 108, height = 30 })
		roleBtns[i].LayoutOrder = i
	end

	local chance = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.4, Size = UDim2.new(1, 0, 0, 74) }, body)
	UiKit.corner(chance, 8)
	UiKit.stroke(chance, C.carbon700, 1)
	UiKit.pad(chance, 10)
	UiKit.label(chance, "Estimated acceptance chance", { size = 10, color = C.gray400, size2 = UDim2.new(0.6, 0, 0, 16) })
	local pctLabel = UiKit.label(chance, "0%", { font = UiKit.FONT_MONO, size = 12, color = C.gray300, size2 = UDim2.new(0.4, 0, 0, 16), x = Enum.TextXAlignment.Right })
	local bar = UiKit.Progress(chance, { value = 0, max = 100, color = C.raceGreen, size2 = UDim2.new(1, 0, 0, 6) })
	bar.Position = UDim2.new(0, 10, 0, 26)
	bar.Size = UDim2.new(1, -20, 0, 6)
	local afford = UiKit.label(chance, "", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
	afford.Position = UDim2.new(0, 10, 0, 40)

	local replyBox = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, body)
	local replyLabel = UiKit.label(replyBox, "", { size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 0), wrap = true })
	replyLabel.AutomaticSize = Enum.AutomaticSize.Y

	function refresh()
		local teamRef = { reputation = team.reputation }
		local p = DriverMarket.acceptanceProbability(driver, teamRef, offer, team.objective)
		pctLabel.Text = string.format("%d%%", math.floor(p * 100 + 0.5))
		pctLabel.TextColor3 = p > 0.65 and C.raceGreen or (p > 0.35 and C.raceAmber or C.raceRed)
		bar:FindFirstChildOfClass("Frame").BackgroundColor3 = pctLabel.TextColor3
		bar:FindFirstChildOfClass("Frame").Size = UDim2.new(math.clamp(p, 0, 1), 0, 1, 0)
		afford.Text = string.format("Signing bonus affordability: %s cash · %s", Format.money(balance, true), offer.signingBonus > balance and "Over budget" or "Within budget")
	end

	local actions = UiKit.hrow(body, 34, 8)
	UiKit.button(actions, "Cancel", function() overlay:Destroy() end, { variant = "subtle", width = 100, height = 32 })
	local submit = UiKit.button(actions, "Submit offer", function()
		UiKit.enable(submit, false)
		local res, err = State.negotiate(driver.id, team.id, offer)
		UiKit.enable(submit, true)
		if err then
			replyLabel.Text = err
			replyLabel.TextColor3 = C.raceRed
			return
		end
		if res.accepted then
			local _, signErr = State.applyAction({
				type = "sign-driver",
				teamId = team.id,
				driverId = driver.id,
				salary = offer.salary,
				signingBonus = offer.signingBonus,
				winBonus = offer.winBonus,
				podiumBonus = offer.podiumBonus,
				years = offer.years,
				performanceClausePosition = offer.performanceClausePosition,
			})
			if signErr then
				replyLabel.Text = signErr
				replyLabel.TextColor3 = C.raceRed
				return
			end
			overlay:Destroy()
			ctx.toast("success", driver.name .. " has signed for the team.")
			ctx.shell.rebuild()
		else
			replyLabel.Text = res.message
			replyLabel.TextColor3 = C.raceAmber
			if res.counterOffer then
				offer = res.counterOffer
				salaryBox.Text = tostring(offer.salary)
				bonusBox.Text = tostring(offer.signingBonus)
				replyLabel.Text = res.message .. string.format("\nCounter: %s / season, %s bonus, %d years.", Format.money(offer.salary, true), Format.money(offer.signingBonus, true), offer.years)
				refresh()
			end
		end
	end, { variant = "primary", width = 120, height = 32 })
	submit.LayoutOrder = 2
	refresh()
end

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end

	local roster = Career.teamDrivers(bundle, myTeamId)
	local balance = Career.balanceOf(bundle, myTeamId)
	local incoming = {}
	local ids = {}
	for _, d in ipairs(roster) do ids[d.id] = true end
	for _, o in ipairs(bundle.transferOffers or {}) do
		if o.status == "open" and ids[o.driverId] then
			table.insert(incoming, o)
		end
	end

	local freeAgents = {}
	local q = query:lower()
	for _, d in ipairs(bundle.drivers) do
		if d.teamId == nil then
			if q == "" or d.name:lower():find(q, 1, true) or d.nationality:lower():find(q, 1, true) then
				table.insert(freeAgents, d)
			end
		end
	end
	table.sort(freeAgents, function(a, b)
		if sort == "potential" then return a.potential > b.potential end
		if sort == "age" then return a.age < b.age end
		if sort == "value" then
			local av = a.attributes.pace / math.max(1, a.salaryDemand or 1)
			local bv = b.attributes.pace / math.max(1, b.salaryDemand or 1)
			return av > bv
		end
		return a.attributes.pace > b.attributes.pace
	end)

	Common.sectionHeading(parent, "Drivers", "Your race line-up and the free-agent market. Negotiate contracts; offers are evaluated by the driver.")

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 380, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -392, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(0, 392, 0, 0)

	local lineBody = UiKit.Panel(left, { title = "Race line-up", right = UiKit.Badge(nil, string.format("%d / 2 seats", #roster), #roster >= 2 and "good" or "warn") })
	if #roster == 0 then
		UiKit.Empty(lineBody, { title = "No drivers signed", hint = "Sign at least two drivers from the market before the next race." })
	else
		for _, d in ipairs(roster) do
			local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, lineBody)
			UiKit.corner(card, 8)
			UiKit.stroke(card, C.carbon700, 1)
			UiKit.list(card, { gap = 3, pad = 10 })
			local head = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 30) }, card)
			Common.teamBadge(head, team, 30)
			UiKit.label(head, d.name, { size = 12, font = Enum.Font.GothamBold, color = C.white, size2 = UDim2.new(1, -80, 0, 16) }).Position = UDim2.new(0, 38, 0, 0)
			UiKit.label(head, string.format("%s · %d · %s", d.nationality, d.age, d.code), { size = 10, color = C.gray500, size2 = UDim2.new(1, -80, 0, 14) }).Position = UDim2.new(0, 38, 0, 15)
			if not busy then
				local rel = pressButton(head, "Release", 60, "subtle", function()
					confirmRelease(ctx, d)
				end)
				rel.Position = UDim2.new(1, -60, 0, 5)
				rel.TextColor3 = C.raceRed
			end
			local attrWrap = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, card)
			UiKit.grid(attrWrap, UDim2.new(0.5, -4, 0, 20), 4)
			for i = 1, 6 do
				local a = ATTRS[i]
				attrBar(attrWrap, a.label, d.attributes[a.key])
			end
			local contract = nil
			for _, c in ipairs(bundle.driverContracts) do
				if c.driverId == d.id and c.active then contract = c end
			end
			local chips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 24) }, card)
			UiKit.list(chips, { dir = Enum.FillDirection.Horizontal, gap = 4 })
			local ci = 0
			local function chip(text)
				ci = ci + 1
				local c = Common.chip(chips, text)
				c.LayoutOrder = ci
			end
			chip(string.format("Morale %d", math.floor(d.morale + 0.5)))
			chip(contract and string.format("Contract %s / %dy", Format.money(contract.salary, true), contract.years) or "Contract —")
			for i = 1, math.min(2, #d.traits) do
				chip((d.traits[i]:gsub("%-", " ")))
			end
		end
	end
	UiKit.label(lineBody, string.format("Budget available: %s. Signing bonuses are paid immediately; salaries are paid per race across the season.", Format.money(balance, true)), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 30), wrap = true, y = Enum.TextYAlignment.Top })

	local offersBody = UiKit.Panel(left, { title = "Incoming offers", right = UiKit.Badge(nil, tostring(#incoming), #incoming > 0 and "warn" or "default") })
	if #incoming == 0 then
		UiKit.label(offersBody, "No bids right now. Rival teams scout the grid through the season — offers for your drivers appear here when they come in.", { size = 11, color = C.gray500, size2 = UDim2.new(1, 0, 0, 46), wrap = true, y = Enum.TextYAlignment.Top })
	else
		for _, o in ipairs(incoming) do
			local driver = Career.findDriver(bundle, o.driverId)
			local bidder = Career.findTeam(bundle, o.fromTeamId)
			if driver and bidder then
				local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.6, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, offersBody)
				UiKit.corner(card, 8)
				UiKit.stroke(card, C.carbon600, 1)
				UiKit.list(card, { gap = 5, pad = 10 })
				UiKit.label(card, string.format("%s want %s", bidder.name, driver.name), { size = 12, font = Enum.Font.GothamBold, color = C.white, size2 = UDim2.new(1, 0, 0, 16) })
				UiKit.label(card, "Offer expires at season's end", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) })
				local chips = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 22) }, card)
				UiKit.list(chips, { dir = Enum.FillDirection.Horizontal, gap = 4 })
				Common.chip(chips, "Fee " .. Format.money(o.fee, true))
				Common.chip(chips, "Salary " .. Format.money(o.salary, true) .. "/y")
				Common.chip(chips, o.years .. " years")
				local row = UiKit.hrow(card, 28, 6)
				pressButton(row, "Accept transfer", 110, "primary", function()
					local _, err = State.applyAction({ type = "respond-transfer-offer", offerId = o.id, accept = true })
					ctx.toast(err and "error" or "success", err or "Transfer accepted")
					ctx.shell.rebuild()
				end)
				pressButton(row, "Reject", 70, "subtle", function()
					local _, err = State.applyAction({ type = "respond-transfer-offer", offerId = o.id, accept = false })
					ctx.toast(err and "error" or "success", err or "Offer rejected")
					ctx.shell.rebuild()
				end)
			end
		end
	end

	local note = inst("Frame", { BackgroundColor3 = C.carbon850, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 74) }, left)
	UiKit.corner(note, 10)
	UiKit.stroke(note, C.carbon700, 1)
	UiKit.pad(note, 12)
	UiKit.label(note, "Driver data", { font = Enum.Font.GothamBold, size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 16) })
	UiKit.label(note, "The default roster is fictional. Real driver names are available only in modes where a season roster permits them, and are always flagged as real people.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 42), wrap = true, y = Enum.TextYAlignment.Top })

	local agentsBody = UiKit.Panel(right, { title = "Free agents" })
	local toolbar = UiKit.hrow(agentsBody, 32, 6)
	local search = UiKit.textbox(toolbar, { placeholder = "Search name or nationality…", text = query, size2 = UDim2.new(1, -302, 0, 32), textSize = 11 })

	search.LayoutOrder = 1
	search.FocusLost:Connect(function()
		query = search.Text
		ctx.shell.rebuild()
	end)
	local sortNames = { "Pace", "Potential", "Youngest", "Value" }
	local sortKeys = { "pace", "potential", "age", "value" }
	local currentSortName = "Pace"
	for i = 1, 4 do
		if sortKeys[i] == sort then currentSortName = sortNames[i] end
	end
	local sortSeg = Common.segmented(toolbar, sortNames, currentSortName, function(name)
		for i = 1, 4 do
			if sortNames[i] == name then sort = sortKeys[i] end
		end
		ctx.shell.rebuild()
	end, { perRow = 4 })
	sortSeg.LayoutOrder = 2
	sortSeg.Position = UDim2.new(1, -290, 0, 0)
	sortSeg.Size = UDim2.new(0, 290, 0, 32)


	if #freeAgents == 0 then
		UiKit.Empty(agentsBody, { title = "No free agents available", hint = "All drivers are under contract. Check back next season." })
	else
		local tableWrap, buildRow = UiKit.Table(agentsBody, {
			columns = { "Driver", "Age", "PAC", "POT", "REP", "DEMAND", "MOR", "" },
			widths = { 0.5, 0.05, 0.06, 0.06, 0.06, 0.09, 0.05, 0.13 },
			rowHeight = 34,
		})
		for i = 1, math.min(40, #freeAgents) do
			local d = freeAgents[i]
			local row = buildRow({
				d.name,
				tostring(d.age),
				tostring(d.attributes.pace),
				tostring(math.floor(d.potential + 0.5)),
				tostring(math.floor(d.reputation + 0.5)),
				Format.money(DriverMarket.expectedSalary(d, team.reputation), true),
				tostring(math.floor(d.morale + 0.5)),
				"",
			}, false, i)
			local btn = pressButton(row, "Offer", 62, "subtle", function()
				openOffer(ctx, d, team, balance)
			end)
			btn.AnchorPoint = Vector2.new(1, 0.5)
			btn.Position = UDim2.new(1, -8, 0.5, 0)
		end
	end
end
