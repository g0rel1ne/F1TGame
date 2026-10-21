local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local root = Players.LocalPlayer.PlayerScripts:WaitForChild("F1Game")
local State = require(root.State)

local function log(fmt, ...)
	print("[Seed] " .. string.format(fmt, ...))
end

task.spawn(function()
	local ok, err = pcall(function()
		State.createLobby("Visual QA", {})
		State.refresh()
		local _, e1 = State.applyAction({
			type = "create-team",
			userId = State.user.id,
			request = {
				name = "Apex Grand Prix",
				shortName = "Apex",
				abbreviation = "APX",
				nationality = "British",
				headquarters = "London, UK",
				engineSupplier = "Aurora Power",
				philosophy = "Aero-first attack",
				numberStyle = "classic",
				colors = { primary = "#e10600", secondary = "#111318", accent = "#00d2be" },
				livery = {
					frontWingStyle = "swept",
					rearWingStyle = "swept",
					sidepodStyle = "inlets",
					noseStyle = "needle",
					haloStyle = "standard",
				},
				budget = 100000000,
			},
		})
		if e1 then error("create-team: " .. e1) end
		State.refresh()
		local taken = {}
		for _, c in ipairs(State.bundle.driverContracts or {}) do
			if c.active then taken[c.driverId] = true end
		end
		local free = {}
		for _, d in ipairs(State.bundle.drivers) do
			if not taken[d.id] and not d.teamId then table.insert(free, d) end
		end
		table.sort(free, function(a, b) return (a.overall or 0) > (b.overall or 0) end)
		for i = 1, math.min(2, #free) do
			local d = free[i]
			State.applyAction({
				type = "sign-driver",
				teamId = State.myTeamId,
				driverId = d.id,
				salary = 4000000,
				signingBonus = 1000000,
				winBonus = 100000,
				podiumBonus = 50000,
				years = 2,
				performanceClausePosition = 10,
			})
		end
		State.setReady(true)
		State.refresh()
		local staff = State.bundle.staffMarket or {}
		for i = 1, math.min(3, #staff) do
			local _, e = State.applyAction({ type = "hire-staff", teamId = State.myTeamId, staffId = staff[i].id })
			if e then log("hire %s: %s", staff[i].name or staff[i].id, e) end
		end
		local _, ef = State.applyAction({ type = "upgrade-facility", teamId = State.myTeamId, kind = "factory" })
		if ef then log("facility: %s", ef) end
		local _, ep = State.applyAction({ type = "start-project", teamId = State.myTeamId, area = "floor" })
		if ep then log("project: %s", ep) end
		State.applyAction({
			type = "set-setup",
			teamId = State.myTeamId,
			setup = { frontWing = 6, rearWing = 4, rideHeight = 5, brakeBias = 56, differential = 50 },
		})
		State.applyAction({ type = "run-practice", session = 1 })
		State.applyAction({ type = "run-practice", session = 2 })
		State.refresh()
		log("seeded team=%s drivers=%d practice=%d", tostring(State.myTeamId), #(State.bundle.drivers or {}), #(State.bundle.practice or {}))
		RS.NavTarget.Value = "dashboard"
	end)
	if not ok then
		log("FAILED: %s", tostring(err))
	end
end)
