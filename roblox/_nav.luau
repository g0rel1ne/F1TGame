local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local root = Players.LocalPlayer.PlayerScripts:WaitForChild("F1Game")
local Shell = require(root.Shell)

local target = RS:WaitForChild("NavTarget")
target.Changed:Connect(function(value)
	if value and value ~= "" then
		print("[Nav] " .. value)
		Shell.navigate(value)
	end
end)
