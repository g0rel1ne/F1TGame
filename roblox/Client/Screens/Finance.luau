local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local CATEGORY_LABEL = {
	["prize-money"] = "Prize money",
	["sponsor-upfront"] = "Sponsor upfront",
	["sponsor-per-race"] = "Sponsor per race",
	["sponsor-bonus"] = "Sponsor bonus",
	["driver-salary"] = "Driver salaries",
	["staff-wage"] = "Staff wages",
	["facility-upkeep"] = "Facility upkeep",
	research = "Research",
	manufacturing = "Facilities & manufacturing",
	repairs = "Repairs",
	travel = "Travel",
	termination = "Contract termination",
	transfer = "Transfer fees",
	investment = "Investment",
	["starting-capital"] = "Starting capital",
}

local filter = "all"

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end

	local balance = Career.balanceOf(bundle, myTeamId)
	local txns = {}
	for _, t in ipairs(bundle.transactions) do
		if t.teamId == myTeamId then table.insert(txns, t) end
	end
	local seasonTxns = {}
	local income, expenses = 0, 0
	local byCategory = {}
	for _, t in ipairs(txns) do
		if t.season == bundle.season.number then
			table.insert(seasonTxns, t)
			if t.amount > 0 then income = income + t.amount else expenses = expenses + t.amount end
			byCategory[t.category] = (byCategory[t.category] or 0) + t.amount
		end
	end

	local catList = {}
	for cat, amount in pairs(byCategory) do
		table.insert(catList, { cat = cat, amount = amount })
	end
	table.sort(catList, function(a, b) return math.abs(b.amount) > math.abs(a.amount) end)

	local shown = {}
	for _, t in ipairs(txns) do
		local ok = filter == "all" or (filter == "income" and t.amount > 0) or (filter == "expense" and t.amount < 0)
		if ok then table.insert(shown, t) end
	end
	table.sort(shown, function(a, b) return (a.createdAt or 0) > (b.createdAt or 0) end)

	Common.sectionHeading(parent, "Finance", "Cash flow, prize money, salaries and capital expenditure. Salaries, wages and upkeep are charged per race.")

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Cash balance", value = Format.money(balance, true), hint = "Available now", accent = balance < 0 and C.raceRed or C.raceGreen })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Season income", value = Format.money(income, true), hint = "Prizes and sponsors" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Season expenses", value = Format.money(math.abs(expenses), true), hint = "Salaries, staff, upkeep, R&D" })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Net this season", value = Format.money(income + expenses, true), hint = string.format("%d transactions", #seasonTxns), accent = (income + expenses) < 0 and C.raceAmber or C.raceGreen })
	UiKit.splitH(s4, 4, 10, 4)

	if balance < 0 then
		local warn = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.3, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 54) }, parent)
		UiKit.corner(warn, 8)
		UiKit.stroke(warn, C.raceRed, 1)
		UiKit.label(warn, "The team is running a negative balance. Emergency investor funding is available once while in the red.", { size = 11, color = C.gray300, size2 = UDim2.new(1, -190, 1, 0), wrap = true }).Position = UDim2.new(0, 12, 0, 0)
		local btn = UiKit.button(warn, "Secure $25M funding", function()
			UiKit.enable(btn, false)
			local _, err = State.applyAction({ type = "emergency-funding", teamId = myTeamId })
			ctx.toast(err and "error" or "success", err or "Emergency funding secured: +$25M")
			ctx.shell.rebuild()
		end, { variant = "primary", width = 160, height = 32, textSize = 12 })
		btn.AnchorPoint = Vector2.new(1, 0.5)
		btn.Position = UDim2.new(1, -12, 0.5, 0)
	end

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0, 380, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, -392, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(0, 392, 0, 0)

	local breakBody = UiKit.Panel(left, { title = "Breakdown this season" })
	if #catList == 0 then
		UiKit.Empty(breakBody, { title = "No transactions yet", hint = "Complete a race weekend to see prize money and costs." })
	else
		for _, entry in ipairs(catList) do
			local row = UiKit.hrow(breakBody, 18, 6)
			UiKit.label(row, CATEGORY_LABEL[entry.cat] or entry.cat, { size = 11, color = C.gray400, size2 = UDim2.new(1, -100, 1, 0) })
			UiKit.label(row, Format.money(entry.amount, true), { font = UiKit.FONT_MONO, size = 11, color = entry.amount >= 0 and C.raceGreen or C.raceRed, size2 = UDim2.new(0, 100, 1, 0), x = Enum.TextXAlignment.Right })
		end
	end

	local costBody = UiKit.Panel(left, { title = "Cost control" })
	UiKit.label(costBody, "• Driver salaries and staff wages are paid in equal instalments each race.\n• Facility upkeep scales with level and is charged per race.\n• Research and facility upgrades are paid up front.\n• Constructors' prize money is paid at season end.", {
		size = 11, color = C.gray400, size2 = UDim2.new(1, 0, 0, 74), wrap = true, y = Enum.TextYAlignment.Top,
	})

	local txBody = UiKit.Panel(right, { title = "Transactions" })
	local filterRow = UiKit.hrow(txBody, 26, 6)
	local labels = { "All", "Income", "Expense" }
	local keys = { "all", "income", "expense" }
	local current = "All"
	for i = 1, 3 do
		if keys[i] == filter then current = labels[i] end
	end
	local seg = Common.segmented(txBody, labels, current, function(label)
		for i = 1, 3 do
			if labels[i] == label then filter = keys[i] end
		end
		ctx.shell.rebuild()
	end, { perRow = 3 })
	seg.AnchorPoint = Vector2.new(1, 0)
	seg.Position = UDim2.new(1, 0, 0, 0)
	seg.Size = UDim2.new(0, 210, 0, 26)

	if #shown == 0 then
		UiKit.Empty(txBody, { title = "No transactions", hint = "This ledger fills up as you race, sign drivers and invest." })
	else
		local wrap, buildRow = UiKit.Table(txBody, {
			columns = { "Season / Rd", "Description", "Category", "Amount" },
			widths = { 0.17, 0.45, 0.22, 0.16 },
			rowHeight = 30,
		})
		for i = 1, math.min(80, #shown) do
			local t = shown[i]
			local rd = t.raceIndex > 90 and "End" or string.format("R%d", t.raceIndex + 1)
			local row = buildRow({
				string.format("S%d · %s", t.season, rd),
				t.description,
				CATEGORY_LABEL[t.category] or t.category,
				Format.money(t.amount),
			}, false, i)
			local amountLabel = nil
			for _, child in ipairs(row:GetChildren()) do
				if child:IsA("TextLabel") and child.LayoutOrder == 4 then
					amountLabel = child
				end
			end
			if amountLabel then
				amountLabel.TextColor3 = t.amount >= 0 and C.raceGreen or C.raceRed
				amountLabel.TextXAlignment = Enum.TextXAlignment.Right
			end
		end
	end
end
