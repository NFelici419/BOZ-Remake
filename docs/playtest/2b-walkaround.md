# Playtest 2b — Walk around Kino

Compare the remake (`BOZ Remake`) with the original (`Black Ops Zombies`, both
installed on the Retroid) at each spot. Note anything that differs; differences
are checked against the data before anything is changed.

**Build and install:** connect the Retroid over USB, then run
`game/tools/build-android.sh`. Select toggles the FPS/position overlay; Start quits.

## Controls

| Check | Pass? | Notes |
|---|---|---|
| Left stick moves, right stick looks, both feel smooth near the centre | | |
| South jumps, East crouches (hold), L3 sprints | | |
| No drift when the sticks are released | | |

## Look and scale (compare with the original at the same spot)

| Spot | What to compare | Pass? | Notes |
|---|---|---|---|
| Lobby, start position | Posters and "BEWARE of the 6!" graffiti read left to right (`MIRROR_X`) | | |
| Lobby | Eye height against the ticket booth and door frames (`POSITION_SCALE`) | | |
| Lobby | Overall brightness and colour of walls and floor (lightmap × vertex colour) | | |
| Alley | Sky: clouds, sun position, horizon | | |
| Alley / fences | Chain-link and grates are see-through, not solid | | |
| Theatre | Room lighting, chandelier, stage | | |
| Anywhere | Missing walls, holes, flickering or black surfaces | | |

## Movement

| Check | Pass? | Notes |
|---|---|---|
| Stairs (lobby, theatre balcony) can be climbed | | |
| You can't walk through walls, but small props may snag you (collision is from visible geometry) | | |
| Every room can be reached (doors and debris are not in the game yet, so all are open) | | |

## Performance

| Spot | FPS (overlay) | Notes |
|---|---|---|
| Lobby | | |
| Theatre, looking across the room | | |
| Alley, looking down its length | | |
