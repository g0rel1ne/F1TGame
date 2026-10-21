-- Server bootstrap: requiring GameServer wires up the remotes and lifecycle.
local GameServer = require(script.Parent.GameServer)

print("[F1Game] server ready")

return GameServer
