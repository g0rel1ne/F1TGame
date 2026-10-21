local UiKit = require(script.Parent.Parent.UiKit)
local State = require(script.Parent.Parent.State)
local RS = game:GetService("ReplicatedStorage").F1Game
local Career = require(RS.Shared.Career)
local Format = require(RS.Shared.Format)
local Common = require(script.Parent.Common)

local C = UiKit.C
local inst = UiKit.inst

local seasons = {}

return function(ctx, parent)
	local bundle = ctx.state.bundle
	local myTeamId = ctx.state.myTeamId
	if not bundle or not myTeamId then return end
	local team = Career.findTeam(bundle, myTeamId)
	if not team then return end

	local active = Career.activeSponsors(bundle, myTeamId)
	local activeIds = {}
	for _, a in ipairs(active) do
		activeIds[a.contract.sponsorId] = true
	end
	local available = {}
	local perRace, upfrontPotential = 0, 0
	for _, s in ipairs(bundle.sponsors) do
		if not activeIds[s.id] then
			table.insert(available, s)
			upfrontPotential = upfrontPotential + s.upfront
		end
	end
	for _, a in ipairs(active) do
		perRace = perRace + ((a.sponsor and a.sponsor.perRace) or 0)
	end
	local eligibleCount = 0
	for _, s in ipairs(available) do
		if team.reputation >= s.minReputation then eligibleCount = eligibleCount + 1 end
	end

	Common.sectionHeading(parent, "Sponsors", "Commercial partners pay an upfront fee, a per-race retainer and a season-end position bonus.")

	local stats = UiKit.hrow(parent, 78, 10)
	local s1 = UiKit.Stat(stats, { label = "Active partners", value = tostring(#active), hint = "Paying per race" })
	UiKit.splitH(s1, 4, 10, 1)
	local s2 = UiKit.Stat(stats, { label = "Income per race", value = Format.money(perRace, true), hint = "From active partners" })
	UiKit.splitH(s2, 4, 10, 2)
	local s3 = UiKit.Stat(stats, { label = "Available deals", value = tostring(eligibleCount), hint = string.format("%d locked by reputation", #available - eligibleCount) })
	UiKit.splitH(s3, 4, 10, 3)
	local s4 = UiKit.Stat(stats, { label = "Upfront on the table", value = Format.money(upfrontPotential, true), hint = "If every deal was signed" })
	UiKit.splitH(s4, 4, 10, 4)

	local cols = UiKit.hrow(parent, 0, 12)
	cols.AutomaticSize = Enum.AutomaticSize.Y
	local left = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(left, { gap = 12 })
	local right = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(0.5, -6, 0, 0), AutomaticSize = Enum.AutomaticSize.Y }, cols)
	UiKit.list(right, { gap = 12 })
	right.Position = UDim2.new(0.5, 6, 0, 0)

	local activeBody = UiKit.Panel(left, { title = "Active partners", right = UiKit.Badge(nil, string.format("Reputation %d/100", math.floor(team.reputation + 0.5)), "info") })
	if #active == 0 then
		UiKit.Empty(activeBody, { title = "No sponsors yet", hint = "Sign a partner to receive per-race income and a season bonus." })
	else
		for _, entry in ipairs(active) do
			local sponsor = entry.sponsor
			local contract = entry.contract
			local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = 0.5, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 96) }, activeBody)
			UiKit.corner(card, 8)
			UiKit.stroke(card, C.carbon700, 1)
			UiKit.pad(card, 10)
			UiKit.label(card, sponsor.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -100, 0, 16) })
			UiKit.label(card, string.format("%s · %s placement", sponsor.industry, (sponsor.placement:gsub("%-", " "))), { size = 10, color = C.gray500, size2 = UDim2.new(1, -100, 0, 14) }).Position = UDim2.new(0, 10, 0, 18)
			local badge = UiKit.Badge(card, Format.money(sponsor.perRace, true) .. "/race", "good")
			badge.AnchorPoint = Vector2.new(1, 0)
			badge.Position = UDim2.new(1, -10, 0, 0)
			local trio = UiKit.hrow(card, 30, 8)
			trio.Position = UDim2.new(0, 10, 0, 36)
			trio.Size = UDim2.new(1, -20, 0, 30)
			local function cell(label, value)
				local c = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1 / 3, -6, 1, 0) }, trio)
				UiKit.label(c, label, { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 12) })
				UiKit.label(c, value, { font = UiKit.FONT_MONO, size = 11, color = C.gray300, size2 = UDim2.new(1, 0, 0, 16) }).Position = UDim2.new(0, 0, 0, 12)
			end
			cell("Upfront paid", Format.money(sponsor.upfront, true))
			cell("Position bonus", Format.money(sponsor.positionBonus, true))
			cell("Seasons", string.format("%d (from S%d)", contract.seasons, contract.startSeason))
			UiKit.label(card, string.format("Bonus if you finish P%d or better in the constructors' championship.", sponsor.targetPosition), { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 14) }).Position = UDim2.new(0, 10, 0, 70)
		end
	end

	local marketBody = UiKit.Panel(right, { title = "Sponsorship market" })
	if #available == 0 then
		UiKit.Empty(marketBody, { title = "No further partners available", hint = "All sponsors are already contracted to your team." })
	else
		for _, s in ipairs(available) do
			local locked = team.reputation < s.minReputation
			local card = inst("Frame", { BackgroundColor3 = C.carbon900, BackgroundTransparency = locked and 0.75 or 0.5, BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 104) }, marketBody)
			UiKit.corner(card, 8)
			UiKit.stroke(card, locked and C.carbon800 or C.carbon700, 1)
			UiKit.pad(card, 10)
			UiKit.label(card, s.name, { size = 12, font = Enum.Font.GothamBold, color = C.gray100, size2 = UDim2.new(1, -110, 0, 16) })
			UiKit.label(card, string.format("%s · needs rep %d", s.industry, s.minReputation), { size = 10, color = C.gray500, size2 = UDim2.new(1, -110, 0, 14) }).Position = UDim2.new(0, 10, 0, 18)
			local badge = UiKit.Badge(card, locked and string.format("Rep %d+", s.minReputation) or "Available", locked and "bad" or "default")
			badge.AnchorPoint = Vector2.new(1, 0)
			badge.Position = UDim2.new(1, -10, 0, 0)
			local trio = UiKit.hrow(card, 28, 8)
			trio.Position = UDim2.new(0, 10, 0, 36)
			trio.Size = UDim2.new(1, -20, 0, 28)
			local function cell(label, value)
				local c = inst("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1 / 3, -6, 1, 0) }, trio)
				UiKit.label(c, label, { size = 9, color = C.gray500, size2 = UDim2.new(1, 0, 0, 12) })
				UiKit.label(c, value, { font = UiKit.FONT_MONO, size = 11, color = C.gray300, size2 = UDim2.new(1, 0, 0, 16) }).Position = UDim2.new(0, 0, 0, 12)
			end
			cell("Upfront", Format.money(s.upfront, true))
			cell("Per race", Format.money(s.perRace, true))
			cell(string.format("P%d bonus", s.targetPosition), Format.money(s.positionBonus, true))

			local currentSeasons = seasons[s.id] or 2
			local seg = Common.segmented(card, { "1", "2", "3" }, tostring(currentSeasons), function(v)
				seasons[s.id] = tonumber(v)
				ctx.shell.rebuild()
			end, { perRow = 3 })
			seg.AnchorPoint = Vector2.new(1, 1)
			seg.Position = UDim2.new(1, -96, 1, -8)
			seg.Size = UDim2.new(0, 88, 0, 26)

			local btn = UiKit.button(card, "Sign deal", function()
				UiKit.enable(btn, false)
				local _, err = State.applyAction({ type = "sign-sponsor", teamId = myTeamId, sponsorId = s.id, seasons = seasons[s.id] or 2 })
				ctx.toast(err and "error" or "success", err or "Sponsorship signed")
				ctx.shell.rebuild()
			end, { variant = "primary", width = 84, height = 26, textSize = 11 })
			UiKit.enable(btn, not locked)
			btn.AnchorPoint = Vector2.new(1, 1)
			btn.Position = UDim2.new(1, -6, 1, -8)
		end
	end
	UiKit.label(marketBody, "All sponsor brands are fictional. Position bonuses are paid at the end of the season.", { size = 10, color = C.gray500, size2 = UDim2.new(1, 0, 0, 26), wrap = true, y = Enum.TextYAlignment.Top })
end
